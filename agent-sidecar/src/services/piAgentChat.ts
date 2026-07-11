import * as fs from "node:fs/promises";
import { getPiResourceLoader } from "./piMcp";
import { importEsm } from "./esmImport";

export interface PiChatTool {
  name: string;
  description: string;
  inputSchema?: any;
  execute: (args: any) => Promise<any>;
}

export interface SubagentUpdate {
  id: string;
  previousId?: string;
  agentId?: string;
  displayName?: string;
  description: string;
  subagentType?: string;
  isAggregation?: boolean;
  status: "queued" | "running" | "background" | "completed" | "steered" | "aborted" | "stopped" | "error";
  activity?: string;
  result?: string;
  error?: string;
  outputFile?: string;
  toolUses?: number;
  tokens?: string;
  turnCount?: number;
  maxTurns?: number;
  durationMs?: number;
  appendLog?: string;
  logs?: string[];
  updatedAt: string;
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
  sendSubagentUpdate: (subagent: SubagentUpdate) => void;
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

function toolEventKey(event: any): string | undefined {
  return event?.toolCallId || event?.toolUseId || event?.toolExecutionId || event?.executionId || event?.id || event?.toolCall?.id;
}

function textFromToolResult(result: any): string | undefined {
  if (!result) return undefined;
  if (typeof result === "string") return result;
  if (typeof result.text === "string") return result.text;
  if (typeof result.content === "string") return result.content;
  if (Array.isArray(result.content)) {
    return result.content
      .filter((part: any) => part?.type === "text" && typeof part.text === "string")
      .map((part: any) => part.text)
      .join("\n")
      .trim() || undefined;
  }
  return undefined;
}

function outputFileFromText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = text.match(/^Output file:\s*(.+)$/m);
  return match?.[1]?.trim();
}

function compactLogText(text: string | undefined, maxLength = 180): string | undefined {
  const normalized = text?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

function textFromMessageContent(content: any): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  return content
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("\n")
    .trim() || undefined;
}

function toolNamesFromMessageContent(content: any): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((part: any) => part?.type === "tool_use" && typeof part.name === "string")
    .map((part: any) => part.name);
}

function summarizeTranscriptEntry(entry: any): string | undefined {
  const message = entry?.message;
  if (entry?.type === "user") return "Subagent prompt recorded.";

  if (entry?.type === "assistant") {
    const tools = toolNamesFromMessageContent(message?.content);
    if (tools.length > 0) return `Assistant requested tool${tools.length === 1 ? "" : "s"}: ${tools.join(", ")}.`;
    const text = compactLogText(textFromMessageContent(message?.content));
    return text ? `Assistant: ${text}` : "Assistant response updated.";
  }

  if (entry?.type === "toolResult") {
    const text = compactLogText(textFromMessageContent(message?.content) || textFromToolResult(message));
    return text ? `Tool result: ${text}` : "Tool result received.";
  }

  return undefined;
}

function subagentDescription(args: any, fallback = "Subagent"): string {
  return args?.description || args?.prompt?.split("\n")[0]?.slice(0, 120) || fallback;
}

function normalizeSubagentStatus(status: any, isError?: boolean): SubagentUpdate["status"] {
  if (isError) return "error";
  if (status === "queued" || status === "running" || status === "background" || status === "completed" ||
      status === "steered" || status === "aborted" || status === "stopped" || status === "error") {
    return status;
  }
  return "completed";
}

/**
 * Runs Agent Tab through Pi so extension tools such as Agent/get_subagent_result
 * are first-class model tools rather than hand-written adapters.
 */
export async function runPiAgentChat(options: RunPiAgentChatOptions): Promise<string | undefined> {
  if (!supportsPiRuntime()) {
    options.sendLog(`Pi delegation requires Node 22.19+; current runtime is Node ${process.versions.node} at ${process.execPath}. Using the compatibility agent runtime.`);
    return undefined;
  }

  const [provider, ...modelParts] = options.model.split("/");
  const modelId = modelParts.join("/");
  if (!provider || !modelId) {
    options.sendLog("Pi delegation could not resolve the selected model; using the compatibility agent runtime.");
    return undefined;
  }

  const { AuthStorage, ModelRegistry, createAgentSession } = await importEsm("@earendil-works/pi-coding-agent");
  const { getModel } = await importEsm("@earendil-works/pi-ai");
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
  let syntheticSubagentCounter = 0;
  const pendingSubagentIds = new Map<string, string>();
  const subagentDescriptions = new Map<string, string>();
  const lastActivityLog = new Map<string, { activity: string; at: number }>();
  const transcriptWatchers = new Map<string, NodeJS.Timeout>();
  const transcriptLineCounts = new Map<string, number>();
  let activeSubagentToolCalls = 0;
  let hasSubagentResultForAggregation = false;
  let aggregationStarted = false;
  let aggregationWritingLogged = false;
  const aggregationId = "main-agent-aggregation";

  const rememberDescription = (id: string, description: string | undefined) => {
    if (description) subagentDescriptions.set(id, description);
  };

  const descriptionFor = (id: string, fallback: string) => subagentDescriptions.get(id) || fallback;

  const appendActivityLog = (id: string, activity: string | undefined): string | undefined => {
    if (!activity) return undefined;
    const now = Date.now();
    const last = lastActivityLog.get(id);
    if (last?.activity === activity) return undefined;
    if (last && now - last.at < 2500) return undefined;
    lastActivityLog.set(id, { activity, at: now });
    return activity.startsWith("Agent ") || activity.endsWith(".") ? activity : `Activity: ${activity}`;
  };

  const sendAggregationUpdate = (
    status: SubagentUpdate["status"],
    activity: string,
    appendLog?: string
  ) => {
    options.sendSubagentUpdate({
      id: aggregationId,
      displayName: "Aggregation",
      description: "Main agent synthesis",
      subagentType: "Main agent",
      isAggregation: true,
      status,
      activity,
      appendLog,
      updatedAt: new Date().toISOString()
    });
  };

  const maybeStartAggregation = (reason: string) => {
    if (!hasSubagentResultForAggregation || activeSubagentToolCalls > 0 || aggregationStarted) return;
    aggregationStarted = true;
    aggregationWritingLogged = false;
    sendAggregationUpdate(
      "running",
      "Synthesizing subagent results.",
      reason
    );
    options.sendLog("Aggregating subagent results.");
  };

  const stopTranscriptWatcher = (id: string) => {
    const timer = transcriptWatchers.get(id);
    if (timer) clearInterval(timer);
    transcriptWatchers.delete(id);
    transcriptLineCounts.delete(id);
  };

  const startTranscriptWatcher = (id: string, outputFile: string | undefined) => {
    if (!outputFile || transcriptWatchers.has(id)) return;
    const poll = async () => {
      try {
        const raw = await fs.readFile(outputFile, "utf-8");
        const lines = raw.split("\n").filter((line) => line.trim().length > 0);
        const seen = transcriptLineCounts.get(id) ?? 0;
        if (lines.length <= seen) return;

        const logs = lines
          .slice(seen)
          .map((line) => {
            try {
              return summarizeTranscriptEntry(JSON.parse(line));
            } catch {
              return undefined;
            }
          })
          .filter((line): line is string => Boolean(line));

        transcriptLineCounts.set(id, lines.length);
        if (logs.length === 0) return;
        if (!transcriptWatchers.has(id)) return;

        options.sendSubagentUpdate({
          id,
          description: descriptionFor(id, `Agent ${id}`),
          status: "background",
          activity: "Transcript updated.",
          logs,
          outputFile,
          updatedAt: new Date().toISOString()
        });
      } catch {
        // The transcript appears asynchronously; ignore read misses.
      }
    };

    transcriptWatchers.set(id, setInterval(poll, 1500));
    void poll();
  };

  const unsubscribe = session.subscribe((event: any) => {
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      latestText += event.assistantMessageEvent.delta;
      options.sendToken(event.assistantMessageEvent.delta);
      if (aggregationStarted && !aggregationWritingLogged) {
        aggregationWritingLogged = true;
        sendAggregationUpdate("running", "Writing the final synthesized response.", "Writing final response from aggregated results.");
      }
    }
    if (event.type === "tool_execution_start") {
      if (event.toolName === "Agent") {
        activeSubagentToolCalls++;
        const key = toolEventKey(event) || `agent_start_${++syntheticSubagentCounter}`;
        const id = `pending-${key}`;
        pendingSubagentIds.set(key, id);
        const description = subagentDescription(event.args);
        const subagentType = event.args?.subagent_type;
        rememberDescription(id, description);
        options.sendSubagentUpdate({
          id,
          displayName: subagentType || "Agent",
          description,
          subagentType,
          status: event.args?.run_in_background ? "background" : "running",
          activity: "Delegated; waiting for result.",
          appendLog: `Delegated ${subagentType || "Agent"} subagent.`,
          updatedAt: new Date().toISOString()
        });
      } else if (event.toolName === "get_subagent_result" && event.args?.agent_id) {
        activeSubagentToolCalls++;
        options.sendSubagentUpdate({
          id: event.args.agent_id,
          description: descriptionFor(event.args.agent_id, `Agent ${event.args.agent_id}`),
          status: "running",
          activity: event.args?.wait ? "Waiting for background result." : "Fetching background result.",
          appendLog: event.args?.wait ? "Waiting for background result." : "Fetching background result.",
          updatedAt: new Date().toISOString()
        });
      }

      const label = event.toolName === "Agent"
        ? `Delegating subagent${typeof event.args?.description === "string" ? `: ${event.args.description}` : ""}.`
        : `Running ${event.toolName}.`;
      options.sendLog(label);
    }
    if (event.type === "tool_execution_update" && event.toolName === "Agent") {
      const key = toolEventKey(event);
      const pendingId = key ? pendingSubagentIds.get(key) : undefined;
      const details = event.partialResult?.details || {};
      const id = details.agentId || pendingId || `agent-${++syntheticSubagentCounter}`;
      const description = details.description || (pendingId ? descriptionFor(pendingId, subagentDescription(event.args)) : subagentDescription(event.args));
      rememberDescription(id, description);
      if (pendingId) rememberDescription(pendingId, description);

      const activity = details.activity || textFromToolResult(event.partialResult);
      options.sendSubagentUpdate({
        id,
        previousId: details.agentId && pendingId && details.agentId !== pendingId ? pendingId : undefined,
        agentId: details.agentId,
        displayName: details.displayName,
        description,
        subagentType: details.subagentType || event.args?.subagent_type,
        status: normalizeSubagentStatus(details.status || "running", false),
        activity,
        appendLog: appendActivityLog(id, activity),
        toolUses: details.toolUses,
        tokens: details.tokens,
        turnCount: details.turnCount,
        maxTurns: details.maxTurns,
        durationMs: details.durationMs,
        updatedAt: new Date().toISOString()
      });
    }
    if (event.type === "tool_execution_end") {
      if (event.toolName === "Agent") {
        activeSubagentToolCalls = Math.max(0, activeSubagentToolCalls - 1);
        const key = toolEventKey(event);
        const pendingId = key ? pendingSubagentIds.get(key) : undefined;
        if (key) pendingSubagentIds.delete(key);
        const details = event.result?.details || {};
        const resultText = textFromToolResult(event.result);
        const id = details.agentId || pendingId || `agent-${++syntheticSubagentCounter}`;
        const status = normalizeSubagentStatus(details.status, event.isError);
        const description = details.description || subagentDescription(event.args);
        const outputFile = outputFileFromText(resultText);
        rememberDescription(id, description);
        options.sendSubagentUpdate({
          id,
          previousId: details.agentId && pendingId ? pendingId : undefined,
          agentId: details.agentId,
          displayName: details.displayName,
          description,
          subagentType: details.subagentType || event.args?.subagent_type,
          status,
          activity: details.activity,
          result: resultText,
          error: details.error || (event.isError ? resultText : undefined),
          outputFile,
          toolUses: details.toolUses,
          tokens: details.tokens,
          turnCount: details.turnCount,
          maxTurns: details.maxTurns,
          durationMs: details.durationMs,
          appendLog: event.isError
            ? `Subagent failed${details.error ? `: ${details.error}` : "."}`
            : status === "background"
              ? "Background subagent started."
              : `Subagent completed${details.toolUses ? ` after ${details.toolUses} tool use${details.toolUses === 1 ? "" : "s"}` : ""}.`,
          updatedAt: new Date().toISOString()
        });
        if (status === "background") {
          startTranscriptWatcher(id, outputFile);
        } else {
          stopTranscriptWatcher(id);
        }
        if (status !== "background" && status !== "queued" && status !== "running") {
          hasSubagentResultForAggregation = true;
          maybeStartAggregation(`Subagent result incorporated: ${description}`);
        }
      } else if (event.toolName === "get_subagent_result" && event.args?.agent_id) {
        activeSubagentToolCalls = Math.max(0, activeSubagentToolCalls - 1);
        const details = event.result?.details || {};
        const resultText = textFromToolResult(event.result);
        const status = normalizeSubagentStatus(details.status, event.isError);
        const description = details.description || descriptionFor(event.args.agent_id, `Agent ${event.args.agent_id}`);
        const outputFile = outputFileFromText(resultText);
        rememberDescription(event.args.agent_id, description);
        options.sendSubagentUpdate({
          id: event.args.agent_id,
          agentId: event.args.agent_id,
          displayName: details.displayName,
          description,
          subagentType: details.subagentType,
          status,
          activity: details.activity,
          result: resultText,
          error: details.error || (event.isError ? resultText : undefined),
          outputFile,
          toolUses: details.toolUses,
          tokens: details.tokens,
          turnCount: details.turnCount,
          maxTurns: details.maxTurns,
          durationMs: details.durationMs,
          appendLog: event.isError
            ? "Failed to retrieve subagent result."
            : status === "running" || status === "background" || status === "queued"
              ? "Subagent result checked; still running."
              : "Subagent result retrieved.",
          updatedAt: new Date().toISOString()
        });
        if (status !== "background" && status !== "queued" && status !== "running") {
          stopTranscriptWatcher(event.args.agent_id);
          hasSubagentResultForAggregation = true;
          maybeStartAggregation(`Subagent result incorporated: ${description}`);
        }
      }
      options.sendLog(event.isError ? `${event.toolName} failed.` : `${event.toolName} completed.`);
    }
  });

  try {
    await session.prompt(options.message);
    if (aggregationStarted) {
      sendAggregationUpdate("completed", "Final synthesized response is ready.", "Aggregation complete.");
    }
    const lastAssistant = [...session.messages].reverse().find((entry: any) => entry?.role === "assistant");
    return textFromAssistantMessage(lastAssistant) || latestText || "Agent complete.";
  } finally {
    for (const id of transcriptWatchers.keys()) stopTranscriptWatcher(id);
    unsubscribe();
    session.dispose();
  }
}
