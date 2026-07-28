/**
 * The Harness contract.
 *
 * Every place in the sidecar that needs to talk to the model (single-shot
 * completion, tool-calling loops, agentic runs with subagent delegation,
 * model discovery, connection testing, or quota reads) goes through exactly
 * one of the methods below, obtained via resolveHarness(customProvider) from
 * ./registry. Nothing outside services/harness/ should branch on
 * provider.transport or provider.id directly - that check is defined exactly
 * once per adapter, in matches().
 *
 * Adapters are thin wrappers around the existing provider integrations
 * (piAgentChat.ts, llmRuntime.ts, copilotService.ts, codexService.ts,
 * claudeCodeService.ts, llmProviders.ts, providerQuota.ts). They do not
 * reimplement provider behavior - they only route to it, so every
 * integration keeps its exact current functionality.
 */

import type { LlmProviderConfig, DiscoveredProviderModel, ReasoningEffort } from "../llmProviders";
import type { TokenUsageSample } from "../usageTracking";
import type { DeferredUserQuestion, SubagentUpdate } from "../piAgentChat";
import type { ProviderQuotaSnapshot } from "../providerQuota";

export interface HarnessTool {
  name: string;
  description: string;
  inputSchema?: any;
  execute: (args: any) => Promise<any>;
}

/** One full agentic turn: uses native subagent delegation when the resolved harness supports it. */
export interface HarnessAgenticRunOptions {
  tabId: string;
  model: string;
  workspaceRoot: string;
  systemPrompt: string;
  conversationHistory: Array<{ role: string; content: string }>;
  message: string;
  tools: HarnessTool[];
  customProvider?: LlmProviderConfig | null;
  sendLog: (message: string) => void;
  sendToken: (token: string) => void;
  sendSubagentUpdate: (subagent: SubagentUpdate) => void;
  /** Task nodes disable delegation to avoid multiplying one canvas run into many agents. */
  enableSubagents?: boolean;
  consumeDeferredQuestion?: () => DeferredUserQuestion | undefined;
  requestUserQuestion?: (question: DeferredUserQuestion) => Promise<string>;
  onUsage?: (sample: TokenUsageSample) => void;
}

/** A bounded tool-calling loop with no native subagent delegation (used directly by read-only surfaces and delegated subagent turns). */
export interface HarnessToolLoopOptions {
  modelReference: string;
  customProvider?: LlmProviderConfig | null;
  systemPrompt: string;
  userMessage: string;
  tools: HarnessTool[];
  sendLog: (message: string) => void;
  sendToken: (token: string) => void;
  history?: Array<{ role: string; content: string }>;
  maxRounds?: number;
  /** Generic providers may finish immediately after one of these tools succeeds. */
  returnAfterToolNames?: string[];
  reasoning?: ReasoningEffort;
  cwd?: string;
  shouldAbort?: () => boolean;
  onUsage?: (sample: TokenUsageSample) => void;
}

/** A single-shot completion with no tool use. */
export interface HarnessCompleteOptions {
  modelReference: string;
  customProvider?: LlmProviderConfig | null;
  systemPrompt: string;
  userMessage: string;
  history?: Array<{ role: string; content: string }>;
  maxTokens?: number;
  reasoning?: ReasoningEffort;
  cwd?: string;
  signal?: AbortSignal;
  onUsage?: (sample: TokenUsageSample) => void;
}

export interface HarnessAdapter {
  /** Stable identifier used only for logging/diagnostics; never branched on outside the registry. */
  readonly id: string;
  /** The single place this provider's routing condition is defined. */
  matches(provider?: LlmProviderConfig | null): boolean;
  runAgentic(options: HarnessAgenticRunOptions): Promise<string>;
  runToolLoop(options: HarnessToolLoopOptions): Promise<string>;
  completeText(options: HarnessCompleteOptions): Promise<string>;
  discoverModels(provider: LlmProviderConfig): Promise<DiscoveredProviderModel[]>;
  testConnection(provider: LlmProviderConfig): Promise<{ modelCount: number; supportedModelCount: number }>;
  fetchQuota(provider: LlmProviderConfig): Promise<ProviderQuotaSnapshot>;
}
