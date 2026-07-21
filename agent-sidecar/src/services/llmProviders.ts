import { importEsm } from "./esmImport";

export type LlmApiType =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";

export type LlmAuthType = "bearer" | "anthropic" | "none" | "environment";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

const REASONING_VARIANT_SEPARATOR = "::reasoning=";

export interface ProviderModelConfig {
  id: string;
  name: string;
  remoteId?: string;
  apiType?: LlmApiType | string;
  baseUrl?: string;
  supported?: boolean;
  capabilities?: string[];
  reasoning?: boolean;
  reasoningEffort?: ReasoningEffort;
  supportedReasoningEfforts?: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
  thinkingLevelMap?: Record<string, string | null>;
  thinkingBudgets?: Record<string, number>;
  input?: Array<"text" | "image">;
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  compat?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface LlmProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  apiType?: LlmApiType | string;
  transport?: "http" | "github-copilot-sdk" | "openai-codex-app-server" | "anthropic-claude-agent-sdk";
  authType?: LlmAuthType;
  catalogUrl?: string;
  models?: ProviderModelConfig[];
}

export interface DiscoveredProviderModel extends ProviderModelConfig {
  remoteId: string;
  apiType: LlmApiType | string;
  supported: boolean;
}

interface ProviderDefaults {
  baseUrl: string;
  catalogUrl: string;
  authType: LlmAuthType;
  apiType: LlmApiType;
  envVar?: string;
  piProvider?: string;
}

const PROVIDER_DEFAULTS: Record<string, ProviderDefaults> = {
  opencode: {
    baseUrl: "https://opencode.ai/zen/v1",
    catalogUrl: "https://opencode.ai/zen/v1/models",
    authType: "bearer",
    apiType: "openai-completions",
    envVar: "OPENCODE_API_KEY",
    piProvider: "opencode",
  },
  "opencode-go": {
    baseUrl: "https://opencode.ai/zen/go/v1",
    catalogUrl: "https://opencode.ai/zen/go/v1/models",
    authType: "bearer",
    apiType: "openai-completions",
    envVar: "OPENCODE_API_KEY",
    piProvider: "opencode-go",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    catalogUrl: "https://api.openai.com/v1/models",
    authType: "bearer",
    apiType: "openai-responses",
    envVar: "OPENAI_API_KEY",
    piProvider: "openai",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    catalogUrl: "https://api.anthropic.com/v1/models",
    authType: "anthropic",
    apiType: "anthropic-messages",
    envVar: "ANTHROPIC_API_KEY",
    piProvider: "anthropic",
  },
  "github-models": {
    baseUrl: "https://models.github.ai/inference",
    catalogUrl: "https://models.github.ai/catalog/models",
    authType: "bearer",
    apiType: "openai-completions",
    envVar: "GITHUB_TOKEN",
  },
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function normalizeApiType(apiType?: string): LlmApiType | string {
  if (apiType === "anthropic") return "anthropic-messages";
  return apiType || "openai-completions";
}

export function remoteModelId(modelId: string, providerId: string): string {
  const prefix = `${providerId}/`;
  return modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId;
}

export function providerModelId(providerId: string, modelId: string): string {
  return `${providerId}/${remoteModelId(modelId, providerId)}`;
}

function reasoningEffort(value: unknown): ReasoningEffort | undefined {
  return value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh"
    ? value
    : undefined;
}

function reasoningEfforts(value: unknown): ReasoningEffort[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(reasoningEffort)
    .filter((effort): effort is ReasoningEffort => Boolean(effort))
    .filter((effort, index, efforts) => efforts.indexOf(effort) === index);
}

export function parseModelReference(modelReference: string): {
  baseReference: string;
  reasoningEffort?: ReasoningEffort;
} {
  const separator = modelReference.lastIndexOf(REASONING_VARIANT_SEPARATOR);
  if (separator === -1) return { baseReference: modelReference };
  const effort = reasoningEffort(modelReference.slice(separator + REASONING_VARIANT_SEPARATOR.length));
  return effort
    ? { baseReference: modelReference.slice(0, separator), reasoningEffort: effort }
    : { baseReference: modelReference };
}

export function resolveProviderModelSelection(
  provider: LlmProviderConfig,
  modelReference: string,
): { model?: ProviderModelConfig; modelId: string; reasoningEffort?: ReasoningEffort } {
  const parsed = parseModelReference(modelReference);
  const target = remoteModelId(parsed.baseReference, provider.id);
  const model = provider.models?.find((candidate) => candidate.id === parsed.baseReference)
    || provider.models?.find((candidate) =>
      (candidate.remoteId || remoteModelId(candidate.id, provider.id)) === target
    );
  return {
    model,
    modelId: model?.remoteId || target,
    reasoningEffort: parsed.reasoningEffort || model?.reasoningEffort,
  };
}

export function getProviderDefaults(providerId: string): ProviderDefaults | undefined {
  return PROVIDER_DEFAULTS[providerId];
}

export function resolveProviderApiKey(provider: LlmProviderConfig): string {
  const explicit = provider.apiKey?.trim();
  if (explicit) return explicit;
  const envVar = PROVIDER_DEFAULTS[provider.id]?.envVar;
  return envVar ? process.env[envVar] || "" : "";
}

function validateHttpUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("The provider URL is not valid.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Provider URLs must use http or https.");
  }
  return parsed.toString();
}

function catalogRequest(provider: LlmProviderConfig): { url: string; headers: Record<string, string> } {
  const defaults = PROVIDER_DEFAULTS[provider.id];
  const baseUrl = provider.baseUrl?.trim() || defaults?.baseUrl || "";
  const catalogUrl = provider.catalogUrl?.trim()
    || defaults?.catalogUrl
    || `${trimTrailingSlash(baseUrl)}/models`;
  const validatedUrl = validateHttpUrl(catalogUrl);
  const parsedCatalogUrl = new URL(validatedUrl);
  if (provider.id === "anthropic" && !parsedCatalogUrl.searchParams.has("limit")) {
    parsedCatalogUrl.searchParams.set("limit", "1000");
  }
  const url = parsedCatalogUrl.toString();
  const apiKey = resolveProviderApiKey(provider);
  const authType = provider.authType || defaults?.authType || (apiKey ? "bearer" : "none");
  const headers: Record<string, string> = { Accept: "application/json" };

  if (authType === "anthropic") {
    if (apiKey) headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (authType === "bearer" || authType === "environment") {
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  }

  if (provider.id === "github-models") {
    headers.Accept = "application/vnd.github+json";
    headers["X-GitHub-Api-Version"] = "2026-03-10";
  }

  return { url, headers };
}

function safeRemoteError(status: number, statusText: string, body: string): Error {
  const compact = body.replace(/\s+/g, " ").trim().slice(0, 500);
  return new Error(`Provider request failed (${status} ${statusText})${compact ? `: ${compact}` : ""}`);
}

async function loadPiModels(providerId: string): Promise<Map<string, any>> {
  const piProvider = PROVIDER_DEFAULTS[providerId]?.piProvider;
  if (!piProvider) return new Map();
  try {
    const { getModels, getSupportedThinkingLevels } = await importEsm<any>("@earendil-works/pi-ai/compat");
    const models = getModels(piProvider as any) || [];
    return new Map(models.map((model: any) => [model.id, {
      ...model,
      supportedReasoningEfforts: reasoningEfforts(getSupportedThinkingLevels?.(model)),
    }]));
  } catch (error) {
    console.warn(`[LLM Providers] Could not load Pi metadata for ${providerId}:`, error);
    return new Map();
  }
}

function rawModelsFromPayload(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.models)) return payload.models;
  throw new Error("The provider returned an unsupported model-catalog format.");
}

function modelDisplayName(raw: any, remoteId: string): string {
  return raw?.friendly_name
    || raw?.display_name
    || raw?.name
    || remoteId.split("/").pop()
    || remoteId;
}

function githubModelSupported(raw: any): boolean {
  const capabilities = Array.isArray(raw?.capabilities) ? raw.capabilities : [];
  const output = Array.isArray(raw?.supported_output_modalities) ? raw.supported_output_modalities : ["text"];
  return capabilities.includes("tool-calling") && output.includes("text");
}

function openAiModelSupported(remoteId: string, hasPiMetadata: boolean): boolean {
  const id = remoteId.toLowerCase();
  if (/(audio|realtime|transcrib|tts|image|embedding|moderation|whisper|dall-e|sora|search-preview)/.test(id)) {
    return false;
  }
  if (hasPiMetadata) return true;
  // The OpenAI model catalog does not expose endpoint/tool capability flags.
  // Keep current text/reasoning families usable through the generic Responses
  // adapter while excluding the specialized catalogs above.
  return /^(gpt-|o\d(?:-|$)|codex-)/.test(id);
}

export async function discoverProviderModels(provider: LlmProviderConfig): Promise<DiscoveredProviderModel[]> {
  if (provider.transport === "github-copilot-sdk" || provider.id === "github-copilot") {
    throw new Error("GitHub Copilot model discovery must use the Copilot SDK adapter.");
  }
  if (provider.transport === "openai-codex-app-server" || provider.id === "openai-codex") {
    throw new Error("OpenAI Codex model discovery must use the Codex app-server adapter.");
  }
  if (provider.transport === "anthropic-claude-agent-sdk" || provider.id === "anthropic-claude-code") {
    throw new Error("Claude Code model discovery must use the Claude Agent SDK adapter.");
  }
  const { url, headers } = catalogRequest(provider);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(url, { method: "GET", headers, signal: controller.signal });
  } catch (error: any) {
    if (error?.name === "AbortError") throw new Error("The provider did not respond within 15 seconds.");
    throw new Error(`Could not reach the provider: ${error?.message || String(error)}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw safeRemoteError(response.status, response.statusText, await response.text());
  }

  const payload = await response.json();
  const rawModels = rawModelsFromPayload(payload);
  const piModels = await loadPiModels(provider.id);
  const defaults = PROVIDER_DEFAULTS[provider.id];
  const providerApiType = normalizeApiType(provider.apiType || defaults?.apiType);
  const providerBaseUrl = trimTrailingSlash(provider.baseUrl?.trim() || defaults?.baseUrl || "");
  const isGitHub = provider.id === "github-models";
  const isKnownPiProvider = !!defaults?.piProvider;

  return rawModels
    .map((raw: any): DiscoveredProviderModel | null => {
      const remoteId = String(raw?.id || raw?.key || raw?.name || "").trim();
      if (!remoteId) return null;
      const piModel = piModels.get(remoteId);
      const capabilities = Array.isArray(raw?.capabilities) ? raw.capabilities.map(String) : [];
      const supportedReasoningEfforts = reasoningEfforts(
        piModel?.supportedReasoningEfforts
        || raw?.supportedReasoningEfforts
        || raw?.supported_reasoning_efforts,
      );
      const defaultReasoningEffort = reasoningEffort(
        raw?.defaultReasoningEffort || raw?.default_reasoning_effort,
      );
      const supported = isGitHub
        ? githubModelSupported(raw)
        : provider.id === "openai"
          ? openAiModelSupported(remoteId, !!piModel)
          : provider.id === "anthropic"
            ? true
            : isKnownPiProvider ? !!piModel : true;
      const inferredReasoning = provider.id === "openai"
        ? /^(gpt-5|o\d(?:-|$))/.test(remoteId.toLowerCase())
        : raw?.capabilities?.thinking?.supported === true;
      const inferredInput: Array<"text" | "image"> = provider.id === "openai" && supported
        ? ["text", "image"]
        : raw?.capabilities?.image_input?.supported === true
          ? ["text", "image"]
          : (raw?.supported_input_modalities || ["text"])
              .filter((item: string) => item === "text" || item === "image");
      return {
        id: providerModelId(provider.id, remoteId),
        remoteId,
        name: piModel?.name || modelDisplayName(raw, remoteId),
        apiType: normalizeApiType(piModel?.api || providerApiType),
        baseUrl: trimTrailingSlash(piModel?.baseUrl || providerBaseUrl),
        supported,
        capabilities,
        reasoning: piModel?.reasoning ?? inferredReasoning,
        supportedReasoningEfforts,
        defaultReasoningEffort,
        thinkingLevelMap: piModel?.thinkingLevelMap,
        thinkingBudgets: piModel?.thinkingBudgets,
        input: piModel?.input || inferredInput,
        contextWindow: piModel?.contextWindow || raw?.limits?.max_input_tokens || raw?.max_input_tokens,
        maxTokens: piModel?.maxTokens || raw?.limits?.max_output_tokens || raw?.max_tokens,
        cost: piModel?.cost,
        compat: piModel?.compat,
        headers: piModel?.headers,
      };
    })
    .filter((model: DiscoveredProviderModel | null): model is DiscoveredProviderModel => model !== null)
    .sort((a, b) => Number(b.supported) - Number(a.supported) || a.name.localeCompare(b.name));
}

export async function testProviderConnection(provider: LlmProviderConfig): Promise<{ modelCount: number; supportedModelCount: number }> {
  const models = await discoverProviderModels(provider);
  return {
    modelCount: models.length,
    supportedModelCount: models.filter((model) => model.supported).length,
  };
}
