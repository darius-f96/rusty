import {
  GITHUB_COPILOT_PROVIDER_ID,
  completeCopilotText,
  callCopilotWithToolsStreaming,
  discoverCopilotModels,
  testCopilotConnection,
  readCopilotQuota,
} from "../../copilotService";
import { mapCopilotQuota } from "../../providerQuota";
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

export const copilotHarnessAdapter: HarnessAdapter = {
  id: "copilot",

  matches(provider) {
    return provider?.transport === "github-copilot-sdk" || provider?.id === GITHUB_COPILOT_PROVIDER_ID;
  },

  async runAgentic(options) {
    return copilotHarnessAdapter.runToolLoop(agenticToToolLoopOptions(options));
  },

  async runToolLoop(options: HarnessToolLoopOptions) {
    const { modelId, reasoningEffort } = resolveModel(options.customProvider, options.modelReference);
    return callCopilotWithToolsStreaming({
      modelId,
      systemPrompt: options.systemPrompt,
      userMessage: options.userMessage,
      tools: options.tools,
      sendLog: options.sendLog,
      sendToken: options.sendToken,
      history: options.history,
      reasoning: options.reasoning || reasoningEffort,
      shouldAbort: options.shouldAbort,
      onUsage: options.onUsage,
    });
  },

  async completeText(options: HarnessCompleteOptions) {
    const { modelId, reasoningEffort } = resolveModel(options.customProvider, options.modelReference);
    return completeCopilotText({
      modelId,
      systemPrompt: options.systemPrompt,
      userMessage: options.userMessage,
      history: options.history,
      reasoning: options.reasoning || reasoningEffort,
      signal: options.signal,
      onUsage: options.onUsage,
    });
  },

  async discoverModels() {
    return discoverCopilotModels();
  },

  async testConnection() {
    return testCopilotConnection();
  },

  async fetchQuota(provider) {
    const result = await readCopilotQuota();
    return mapCopilotQuota(provider, {
      authenticated: result.status.authenticated,
      login: result.status.login,
      plan: result.plan,
      quotaSnapshots: result.quotaSnapshots,
      message: result.status.message,
    });
  },
};
