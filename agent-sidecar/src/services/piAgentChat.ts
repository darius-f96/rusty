import { getPiResourceLoader } from "./piMcp";

export interface PiChatTool {
  name: string;
  description: string;
  inputSchema?: any;
  execute: (args: any) => Promise<any>;
}

interface RunPiAgentChatOptions {
  model: string;
  workspaceRoot: string;
  systemPrompt: string;
  conversationHistory: Array<{ role: string; content: string }>;
  message: string;
  tools: PiChatTool[];
  customProvider?: {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiType: string;
    models: Array<{ id: string; name: string }>;
  } | null;
  sendLog: (message: string) => void;
  sendToken: (token: string) => void;
  sendTodoUpdate: (tasks: any[]) => void;
}

function supportsPiRuntime(): boolean {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 19);
}

function textFromAssistantMessage(message: any): string {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return "";
  return message.content
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("");
}

/**
 * Runs Agent Tab through Pi so extension tools such as Agent/get_subagent_result
 * are first-class model tools rather than hand-written adapters.
 */
export async function runPiAgentChat(options: RunPiAgentChatOptions): Promise<string | undefined> {
  if (!supportsPiRuntime()) {
    options.sendLog("Pi delegation requires Node 22.19+; using the compatibility agent runtime.");
    return undefined;
  }

  const [provider, ...modelParts] = options.model.split("/");
  const modelId = modelParts.join("/");
  if (!provider || !modelId) {
    options.sendLog("Pi delegation could not resolve the selected model; using the compatibility agent runtime.");
    return undefined;
  }

  const { AuthStorage, ModelRegistry, createAgentSession } = await import("@earendil-works/pi-coding-agent");
  const { getModel } = await import("@earendil-works/pi-ai");
  let modelRegistry: any;
  let selectedModel: any;
  if (options.customProvider) {
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(options.customProvider.id, options.customProvider.apiKey);
    modelRegistry = ModelRegistry.inMemory(authStorage);
    modelRegistry.registerProvider(options.customProvider.id, {
      name: options.customProvider.name,
      baseUrl: options.customProvider.baseUrl,
      apiKey: options.customProvider.apiKey,
      api: options.customProvider.apiType || "openai-completions",
      models: options.customProvider.models.map((model) => ({
        id: model.id.includes("/") ? model.id.split("/").slice(1).join("/") : model.id,
        name: model.name,
        api: options.customProvider!.apiType || "openai-completions",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 16_384
      }))
    });
    selectedModel = modelRegistry.find(provider, modelId);
  } else {
    selectedModel = getModel(provider as any, modelId);
  }
  if (!selectedModel) {
    options.sendLog(`Pi could not resolve ${options.model}; using the compatibility agent runtime.`);
    return undefined;
  }

  const history = options.conversationHistory
    .slice(-12)
    .map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`)
    .join("\n\n");
  const resourceLoader = await getPiResourceLoader(options.workspaceRoot, [
    options.systemPrompt,
    history ? `Previous Agent Tab conversation:\n${history}` : ""
  ].filter(Boolean));

  if (!resourceLoader) {
    options.sendLog("Pi extensions could not be loaded; using the compatibility agent runtime.");
    return undefined;
  }

  const loadedExtensions = resourceLoader.getExtensions().extensions;
  const hasWebAccessExtension = loadedExtensions.some((extension: any) =>
    typeof extension.path === "string" && extension.path.includes("pi-web-access")
  );
  const hasSubagentsExtension = loadedExtensions.some((extension: any) =>
    typeof extension.path === "string" && extension.path.includes("pi-subagents")
  );
  if (!hasWebAccessExtension) {
    options.sendLog("Pi web extension is unavailable with this Pi version; using Agent Tab's compatible web-search tool.");
  }
  if (!hasSubagentsExtension) {
    options.sendLog("Pi subagent extension did not load; using the compatibility agent runtime.");
    return undefined;
  }

  // Avoid duplicate registration only when Pi's native web extension loaded.
  const customTools = hasWebAccessExtension
    ? options.tools.filter((tool) => tool.name !== "web_search")
    : options.tools;
  const toolNames = Array.from(new Set([
    ...customTools.map((tool) => tool.name),
    "web_search",
    "fetch_content",
    "get_search_content",
    "todo",
    "Agent",
    "get_subagent_result",
    "steer_subagent"
  ]));

  options.sendLog("Starting Pi agent session with web access and subagent delegation.");
  const { session } = await createAgentSession({
    cwd: options.workspaceRoot,
    model: selectedModel,
    modelRegistry,
    tools: toolNames,
    customTools: customTools as any,
    resourceLoader
  });

  let latestText = "";
  const unsubscribe = session.subscribe((event: any) => {
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      latestText += event.assistantMessageEvent.delta;
      options.sendToken(event.assistantMessageEvent.delta);
    }
    if (event.type === "tool_execution_start") {
      const label = event.toolName === "Agent"
        ? "Delegating work to a subagent."
        : `Running ${event.toolName}.`;
      options.sendLog(label);
    }
    if (event.type === "tool_execution_end") {
      if (event.toolName === "todo" && Array.isArray(event.result?.details?.tasks)) {
        options.sendTodoUpdate(event.result.details.tasks);
      }
      options.sendLog(event.isError ? `${event.toolName} failed.` : `${event.toolName} completed.`);
    }
  });

  try {
    await session.prompt(options.message);
    const lastAssistant = [...session.messages].reverse().find((entry: any) => entry?.role === "assistant");
    return textFromAssistantMessage(lastAssistant) || latestText || "Agent complete.";
  } finally {
    unsubscribe();
    session.dispose();
  }
}
