import type { LlmProviderConfig } from "../llmProviders";
import type { HarnessAdapter } from "./types";
import { copilotHarnessAdapter } from "./adapters/copilotAdapter";
import { codexHarnessAdapter } from "./adapters/codexAdapter";
import { claudeCodeHarnessAdapter } from "./adapters/claudeCodeAdapter";
import { piHarnessAdapter } from "./adapters/piAdapter";

/**
 * The single lookup table for "which integration handles this provider".
 * Order matters only in that piHarnessAdapter matches unconditionally and
 * must stay last - it is the fallback for Pi's native runtime and every
 * generic HTTP provider.
 *
 * Adding a new managed-runtime provider means adding one adapter here and
 * nowhere else: no capability, no server.ts route, and no other service file
 * should ever branch on provider.transport or provider.id again.
 */
const adapters: HarnessAdapter[] = [
  copilotHarnessAdapter,
  codexHarnessAdapter,
  claudeCodeHarnessAdapter,
  piHarnessAdapter,
];

export function resolveHarness(provider?: LlmProviderConfig | null): HarnessAdapter {
  return adapters.find((adapter) => adapter.matches(provider)) || piHarnessAdapter;
}

export function listHarnessAdapters(): readonly HarnessAdapter[] {
  return adapters;
}
