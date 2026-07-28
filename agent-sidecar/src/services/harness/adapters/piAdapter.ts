import { runPiAgentChat } from "../../piAgentChat";
import { callLlmWithToolsPiStreaming, completeLlmText } from "../../llmRuntime";
import { discoverProviderModels, testProviderConnection } from "../../llmProviders";
import { fetchProviderQuota } from "../../providerQuota";
import type { HarnessAdapter, HarnessAgenticRunOptions, HarnessCompleteOptions, HarnessToolLoopOptions } from "../types";
import { agenticToToolLoopOptions } from "../adaptOptions";

/**
 * The default/fallback harness: Pi's native agent runtime (with subagent
 * delegation and extensions) when available, and Pi's provider-compatible
 * tool-calling/completion loop for every generic HTTP provider (opencode,
 * openai, anthropic, github-models, and any custom OpenAI/Anthropic-shaped
 * endpoint) otherwise. This is intentionally the last adapter checked by the
 * registry - it matches unconditionally so every provider not claimed by a
 * managed-runtime adapter (Copilot, Codex, Claude Code) falls through to it,
 * exactly as it did before the harness existed.
 */
export const piHarnessAdapter: HarnessAdapter = {
  id: "pi",

  matches() {
    return true;
  },

  async runAgentic(options: HarnessAgenticRunOptions) {
    const native = await runPiAgentChat({
      tabId: options.tabId,
      model: options.model,
      workspaceRoot: options.workspaceRoot,
      systemPrompt: options.systemPrompt,
      conversationHistory: options.conversationHistory,
      message: options.message,
      tools: options.tools,
      customProvider: options.customProvider,
      sendLog: options.sendLog,
      sendToken: options.sendToken,
      sendSubagentUpdate: options.sendSubagentUpdate,
      enableSubagents: options.enableSubagents,
      consumeDeferredQuestion: options.consumeDeferredQuestion,
      requestUserQuestion: options.requestUserQuestion,
      onUsage: options.onUsage,
    });
    if (native !== undefined) return native;
    return piHarnessAdapter.runToolLoop(agenticToToolLoopOptions(options));
  },

  async runToolLoop(options: HarnessToolLoopOptions) {
    return callLlmWithToolsPiStreaming(options);
  },

  async completeText(options: HarnessCompleteOptions) {
    return completeLlmText(options);
  },

  async discoverModels(provider) {
    return discoverProviderModels(provider);
  },

  async testConnection(provider) {
    return testProviderConnection(provider);
  },

  async fetchQuota(provider) {
    return fetchProviderQuota(provider);
  },
};
