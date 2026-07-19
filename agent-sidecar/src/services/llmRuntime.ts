import { importEsm } from "./esmImport";
import {
  getProviderDefaults,
  LlmProviderConfig,
  normalizeApiType,
  ProviderModelConfig,
  remoteModelId,
  resolveProviderApiKey,
} from "./llmProviders";

export interface ResolvedLlmRuntime {
  providerId: string;
  modelId: string;
  apiKey: string;
  model: any;
  headers?: Record<string, string>;
}

export class EmptyLlmResponseError extends Error {
  readonly stopReason: string;
  readonly contentTypes: string[];
  readonly outputTokens?: number;

  constructor(message: any) {
    const stopReason = typeof message?.stopReason === "string" ? message.stopReason : "unknown";
    const contentTypes = Array.isArray(message?.content)
      ? message.content
        .map((part: any) => typeof part?.type === "string" ? part.type : "unknown")
        .filter((type: string, index: number, types: string[]) => types.indexOf(type) === index)
      : [];
    const outputTokens = typeof message?.usage?.output === "number" ? message.usage.output : undefined;
    const reason = stopReason === "length"
      ? "The selected model exhausted its output token budget before returning text."
      : "The selected model returned no text.";
    const diagnostics = [
      `stop reason: ${stopReason}`,
      contentTypes.length ? `response parts: ${contentTypes.join(", ")}` : "response parts: none",
      outputTokens !== undefined ? `output tokens: ${outputTokens}` : "",
    ].filter(Boolean).join("; ");
    super(`${reason} (${diagnostics})`);
    this.name = "EmptyLlmResponseError";
    this.stopReason = stopReason;
    this.contentTypes = contentTypes;
    this.outputTokens = outputTokens;
  }
}

function providerIdFromReference(modelReference: string): string {
  const separator = modelReference.indexOf("/");
  return separator === -1 ? "" : modelReference.slice(0, separator);
}

function selectedProviderModel(provider: LlmProviderConfig, modelReference: string): ProviderModelConfig | undefined {
  const target = remoteModelId(modelReference, provider.id);
  return provider.models?.find((model) => (model.remoteId || remoteModelId(model.id, provider.id)) === target);
}

function syntheticModel(provider: LlmProviderConfig, configuredModel: ProviderModelConfig | undefined, modelId: string): any {
  const defaults = getProviderDefaults(provider.id);
  const api = normalizeApiType(configuredModel?.apiType || provider.apiType || defaults?.apiType);
  const baseUrl = (configuredModel?.baseUrl || provider.baseUrl || defaults?.baseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error(`No base URL is configured for ${provider.name}.`);
  return {
    id: modelId,
    name: configuredModel?.name || modelId,
    api,
    provider: provider.id,
    baseUrl,
    reasoning: configuredModel?.reasoning ?? false,
    input: configuredModel?.input || ["text"],
    cost: configuredModel?.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: configuredModel?.contextWindow || 200_000,
    maxTokens: configuredModel?.maxTokens || 16_384,
    compat: configuredModel?.compat,
    headers: configuredModel?.headers,
  };
}

function runtimeHeaders(
  provider: LlmProviderConfig | null | undefined,
  model: any,
  apiKey: string,
  authType?: LlmProviderConfig["authType"]
): Record<string, string> | undefined {
  if (!provider) return undefined;
  const headers: Record<string, string> = { ...(model.headers || {}) };
  if (provider.id === "github-models" || provider.id === "github-copilot") {
    headers.Accept = "application/vnd.github+json";
    headers["X-GitHub-Api-Version"] = "2026-03-10";
  }
  // Anthropic-compatible gateways such as OpenCode can expose the Messages
  // protocol while retaining bearer authentication.
  if (model.api === "anthropic-messages" && authType === "bearer" && apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return Object.keys(headers).length ? headers : undefined;
}

export async function resolveLlmRuntime(
  modelReference: string,
  customProvider?: LlmProviderConfig | null
): Promise<ResolvedLlmRuntime> {
  const providerId = customProvider?.id || providerIdFromReference(modelReference);
  if (!providerId) throw new Error("The selected model does not identify an LLM provider.");

  const configuredModel = customProvider ? selectedProviderModel(customProvider, modelReference) : undefined;
  const fallbackModel = customProvider?.models?.[0];
  const modelId = remoteModelId(
    modelReference || fallbackModel?.remoteId || fallbackModel?.id || "",
    providerId
  );
  if (!modelId) throw new Error("No model is selected for this provider.");

  let model: any;
  if (customProvider) {
    model = syntheticModel(customProvider, configuredModel || fallbackModel, modelId);
  } else {
    try {
      const { getModel } = await importEsm<any>("@earendil-works/pi-ai");
      model = getModel(providerId as any, modelId as any);
    } catch (error: any) {
      throw new Error(`Pi does not recognize ${providerId}/${modelId}: ${error?.message || String(error)}`);
    }
  }

  const authType = customProvider?.authType
    || getProviderDefaults(providerId)?.authType
    || (customProvider?.apiKey ? "bearer" : "none");
  const apiKey = customProvider
    ? resolveProviderApiKey(customProvider) || (authType === "none" ? "not-needed" : "")
    : "";
  if (!apiKey && customProvider) throw new Error(`No API key is configured for ${customProvider.name}.`);

  return { providerId, modelId, apiKey, model, headers: runtimeHeaders(customProvider, model, apiKey, authType) };
}

export function textFromPiMessage(message: any): string {
  return Array.isArray(message?.content)
    ? message.content
      .filter((part: any) => part?.type === "text" && typeof part.text === "string")
      .map((part: any) => part.text)
      .join("")
    : "";
}

export async function completeLlmText(options: {
  modelReference: string;
  customProvider?: LlmProviderConfig | null;
  systemPrompt: string;
  userMessage: string;
  history?: Array<{ role: string; content: string }>;
  maxTokens?: number;
  reasoning?: "minimal" | "low" | "medium" | "high" | "xhigh";
  signal?: AbortSignal;
}): Promise<string> {
  const runtime = await resolveLlmRuntime(options.modelReference, options.customProvider);
  const { completeSimple } = await importEsm<any>("@earendil-works/pi-ai");
  const history = (options.history || [])
    .filter((entry) => entry?.role === "user" || entry?.role === "assistant")
    .slice(-12)
    .map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`)
    .join("\n\n");
  const content = history
    ? `Previous conversation:\n${history}\n\nCurrent request:\n${options.userMessage}`
    : options.userMessage;
  const modelMaxTokens = Number(runtime.model?.maxTokens);
  const maxTokens = options.maxTokens && Number.isFinite(modelMaxTokens) && modelMaxTokens > 0
    ? Math.min(options.maxTokens, modelMaxTokens)
    : options.maxTokens;
  const result = await completeSimple(runtime.model, {
    systemPrompt: options.systemPrompt,
    messages: [{ role: "user", content: [{ type: "text", text: content }], timestamp: Date.now() }],
  }, {
    apiKey: runtime.apiKey || undefined,
    headers: runtime.headers,
    maxTokens,
    reasoning: options.reasoning,
    signal: options.signal,
  });
  if (result?.stopReason === "error" || result?.stopReason === "aborted") {
    throw new Error(result?.errorMessage || "The model request failed.");
  }
  const text = textFromPiMessage(result);
  if (!text.trim()) throw new EmptyLlmResponseError(result);
  return text;
}

export async function callLlmWithToolsPiStreaming(options: {
  modelReference: string;
  customProvider?: LlmProviderConfig | null;
  systemPrompt: string;
  userMessage: string;
  tools: Array<{ name: string; description: string; inputSchema?: any; execute: (args: any) => Promise<any> }>;
  sendLog: (message: string) => void;
  sendToken: (token: string) => void;
  history?: Array<{ role: string; content: string }>;
  maxRounds?: number;
  shouldAbort?: () => boolean;
}): Promise<string> {
  const runtime = await resolveLlmRuntime(options.modelReference, options.customProvider);
  const { streamSimple } = await importEsm<any>("@earendil-works/pi-ai");
  const history = (options.history || [])
    .filter((entry) => entry?.role === "user" || entry?.role === "assistant")
    .slice(-12)
    .map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`)
    .join("\n\n");
  const firstMessage = history
    ? `Previous conversation:\n${history}\n\nCurrent request:\n${options.userMessage}`
    : options.userMessage;
  const messages: any[] = [{ role: "user", content: [{ type: "text", text: firstMessage }], timestamp: Date.now() }];
  const piTools = options.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema || { type: "object", properties: {}, required: [] },
  }));
  const maxRounds = options.maxRounds || 30;
  const shouldAbort = options.shouldAbort || (() => false);

  options.sendLog(`Calling ${runtime.providerId}/${runtime.modelId}.`);
  for (let round = 1; round <= maxRounds; round++) {
    if (shouldAbort()) throw new Error("Client disconnected");
    options.sendLog(`Planning step ${round}: reviewing context and available tools.`);
    const controller = new AbortController();
    const stream = streamSimple(runtime.model, {
      systemPrompt: options.systemPrompt,
      messages,
      tools: piTools,
    }, {
      apiKey: runtime.apiKey || undefined,
      headers: runtime.headers,
      signal: controller.signal,
    });

    let result: any;
    for await (const event of stream) {
      if (shouldAbort()) {
        controller.abort();
        throw new Error("Client disconnected");
      }
      if (event.type === "text_delta") options.sendToken(event.delta);
      if (event.type === "error") throw new Error(event.error?.errorMessage || "The model request failed.");
      if (event.type === "done") result = event.message;
    }
    result ||= await stream.result();
    messages.push(result);
    const toolCalls = (result?.content || []).filter((part: any) => part?.type === "toolCall");
    if (toolCalls.length === 0) {
      const text = textFromPiMessage(result);
      if (!text.trim()) throw new EmptyLlmResponseError(result);
      return text;
    }

    options.sendLog(`Running ${toolCalls.length} requested action${toolCalls.length === 1 ? "" : "s"}.`);
    const toolResults = await Promise.all(toolCalls.map(async (toolCall: any) => {
      const tool = options.tools.find((candidate) => candidate.name === toolCall.name);
      if (!tool) {
        return { toolCall, text: `Tool ${toolCall.name} is not available.`, isError: true };
      }
      try {
        const value = await tool.execute(toolCall.arguments || {});
        const text = typeof value === "string" ? value : JSON.stringify(value);
        return { toolCall, text: text.slice(0, 8_000), isError: false };
      } catch (error: any) {
        return { toolCall, text: `Error: ${error?.message || String(error)}`, isError: true };
      }
    }));
    for (const item of toolResults) {
      messages.push({
        role: "toolResult",
        toolCallId: item.toolCall.id,
        toolName: item.toolCall.name,
        content: [{ type: "text", text: item.text }],
        details: {},
        isError: item.isError,
        timestamp: Date.now(),
      });
    }
  }
  throw new Error(`The model exceeded the ${maxRounds}-round tool limit.`);
}
