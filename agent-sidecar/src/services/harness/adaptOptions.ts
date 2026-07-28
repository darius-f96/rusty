import type { HarnessAgenticRunOptions, HarnessToolLoopOptions } from "./types";

/**
 * Adapters that have no native agentic tier (Copilot, Codex, Claude Code)
 * satisfy runAgentic() by running the same bounded tool loop the Pi adapter
 * falls back to. This mirrors the pre-harness behavior exactly: runPiAgentChat()
 * returned undefined immediately for those providers and the caller fell
 * through to callLlmWithToolsPiStreaming() with these same fields.
 */
export function agenticToToolLoopOptions(options: HarnessAgenticRunOptions): HarnessToolLoopOptions {
  return {
    modelReference: options.model,
    customProvider: options.customProvider,
    systemPrompt: options.systemPrompt,
    userMessage: options.message,
    tools: options.tools,
    sendLog: options.sendLog,
    sendToken: options.sendToken,
    history: options.conversationHistory,
    cwd: options.workspaceRoot,
    onUsage: options.onUsage,
  };
}
