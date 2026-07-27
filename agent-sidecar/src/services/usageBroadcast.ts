/**
 * Shared plumbing between a capability's LLM call and token-usage persistence.
 * Each capability constructs one reporter per run/call and passes it as
 * `onUsage` to the LLM runtime, so persistence + live WS updates only need
 * to be implemented once.
 */

import { WebSocket } from "ws";
import { safeSend } from "./websocket";
import { getUsageTracker, TokenUsageSample } from "./usageTracking";

export interface UsageReporterContext {
  workspaceRoot: string;
  surface: string;
  runId?: string;
  tabId?: string;
  nodeId?: string;
  sessionId?: string;
  model: string;
  provider?: string;
}

function addSample(target: TokenUsageSample, sample: TokenUsageSample): void {
  target.input += sample.input || 0;
  target.output += sample.output || 0;
  target.cacheRead += sample.cacheRead || 0;
  target.cacheWrite += sample.cacheWrite || 0;
  target.totalTokens += sample.totalTokens || (sample.input || 0) + (sample.output || 0);
}

/**
 * Returns an `onUsage` callback that persists every sample it receives and
 * broadcasts the run-cumulative total to the frontend so a live badge can
 * render it. Safe to call multiple times per run (e.g. once per tool round).
 */
export function createUsageReporter(ws: WebSocket, context: UsageReporterContext): (sample: TokenUsageSample) => void {
  const cumulative: TokenUsageSample = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
  return (sample: TokenUsageSample) => {
    if (!sample) return;
    addSample(cumulative, sample);
    getUsageTracker(context.workspaceRoot)
      .record({
        surface: context.surface,
        runId: context.runId,
        tabId: context.tabId,
        provider: context.provider,
        model: context.model,
        usage: sample,
      })
      .catch((error) => console.error(`Token usage tracking failed for surface "${context.surface}":`, error));
    if (context.tabId || context.runId || context.nodeId || context.sessionId) {
      safeSend(ws, {
        type: "usage_update",
        tabId: context.tabId,
        runId: context.runId,
        nodeId: context.nodeId,
        sessionId: context.sessionId,
        surface: context.surface,
        usage: { ...cumulative },
      });
    }
  };
}
