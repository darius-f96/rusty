import {
  OPENAI_CODEX_PROVIDER_ID,
  completeCodexText,
  callCodexWithToolsStreaming,
  discoverCodexModels,
  testCodexConnection,
  readCodexQuota,
} from "../../codexService";
import { mapCodexQuota } from "../../providerQuota";
import { remoteModelId, resolveProviderModelSelection, LlmProviderConfig } from "../../llmProviders";
import type { HarnessAdapter, HarnessCompleteOptions, HarnessToolLoopOptions } from "../types";
import { agenticToToolLoopOptions } from "../adaptOptions";

function resolveModel(provider: LlmProviderConfig | null | undefined, modelReference: string) {
  const selection = resolveProviderModelSelection(provider!, modelReference);
  return {
    modelId: selection.modelId || remoteModelId(modelReference, provider!.id),
    reasoningEffort: selection.reasoningEffort,
  };
}

export const codexHarnessAdapter: HarnessAdapter = {
  id: "codex",

  matches(provider) {
    return provider?.transport === "openai-codex-app-server" || provider?.id === OPENAI_CODEX_PROVIDER_ID;
  },

  async runAgentic(options) {
    return codexHarnessAdapter.runToolLoop(agenticToToolLoopOptions(options));
  },

  async runToolLoop(options: HarnessToolLoopOptions) {
    const { modelId, reasoningEffort } = resolveModel(options.customProvider, options.modelReference);
    return callCodexWithToolsStreaming({
      modelId,
      systemPrompt: options.systemPrompt,
      userMessage: options.userMessage,
      tools: options.tools,
      sendLog: options.sendLog,
      sendToken: options.sendToken,
      history: options.history,
      maxRounds: options.maxRounds,
      reasoning: options.reasoning || reasoningEffort,
      cwd: options.cwd,
      shouldAbort: options.shouldAbort,
      onUsage: options.onUsage,
    });
  },

  async completeText(options: HarnessCompleteOptions) {
    const { modelId, reasoningEffort } = resolveModel(options.customProvider, options.modelReference);
    return completeCodexText({
      modelId,
      systemPrompt: options.systemPrompt,
      userMessage: options.userMessage,
      history: options.history,
      reasoning: options.reasoning || reasoningEffort,
      cwd: options.cwd,
      signal: options.signal,
      onUsage: options.onUsage,
    });
  },

  async discoverModels() {
    return discoverCodexModels();
  },

  async testConnection() {
    return testCodexConnection();
  },

  async fetchQuota(provider) {
    const result = await readCodexQuota();
    return mapCodexQuota(provider, {
      authenticated: result.status.authenticated,
      email: result.status.email,
      plan: result.status.planType,
      rateLimitResult: result.rateLimitResult,
      message: result.status.message,
    });
  },
};
