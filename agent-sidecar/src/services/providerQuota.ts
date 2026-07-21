import type { LlmProviderConfig } from "./llmProviders";
import { resolveProviderApiKey } from "./llmProviders";
import { readCopilotQuota } from "./copilotService";
import { readCodexQuota } from "./codexService";
import { readClaudeCodeQuota } from "./claudeCodeService";

export type ProviderQuotaState = "available" | "unavailable" | "unauthenticated";

export interface ProviderQuotaWindow {
  id: string;
  label: string;
  usedPercent?: number;
  remainingPercent?: number;
  used?: number;
  limit?: number;
  remaining?: number;
  unit?: "requests" | "tokens" | "credits";
  resetAt?: string;
  windowMinutes?: number;
  unlimited?: boolean;
  overage?: number;
  overageAllowed?: boolean;
}

export interface ProviderQuotaBalance {
  formatted?: string;
  unlimited?: boolean;
}

export interface ProviderQuotaSnapshot {
  providerId: string;
  providerName: string;
  state: ProviderQuotaState;
  source: string;
  fetchedAt: string;
  plan?: string;
  account?: string;
  windows: ProviderQuotaWindow[];
  balance?: ProviderQuotaBalance;
  resetCreditsAvailable?: number;
  spendControlReached?: boolean;
  message?: string;
  manageUrl?: string;
}

interface ProviderIdentity {
  id: string;
  name: string;
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
}

function percentage(value: unknown): number | undefined {
  const number = finiteNumber(value);
  if (number === undefined) return undefined;
  return Math.max(0, Math.min(100, number));
}

function isoDate(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
  }
  const seconds = finiteNumber(value);
  if (seconds === undefined) return undefined;
  const timestamp = seconds > 10_000_000_000 ? seconds : seconds * 1_000;
  return new Date(timestamp).toISOString();
}

function snapshotBase(provider: ProviderIdentity, source: string): Pick<
  ProviderQuotaSnapshot,
  "providerId" | "providerName" | "source" | "fetchedAt" | "windows"
> {
  return {
    providerId: provider.id,
    providerName: provider.name,
    source,
    fetchedAt: new Date().toISOString(),
    windows: [],
  };
}

const COPILOT_QUOTA_ORDER = ["premium_interactions", "chat", "completions"];

function copilotQuotaLabel(id: string): string {
  if (id === "premium_interactions") return "Premium requests";
  if (id === "chat") return "Chat requests";
  if (id === "completions") return "Code completions";
  return id.replace(/[_-]+/g, " ").replace(/^./, (character) => character.toUpperCase());
}

export function mapCopilotQuota(
  provider: ProviderIdentity,
  data: {
    authenticated: boolean;
    login?: string;
    plan?: string;
    quotaSnapshots?: Record<string, any>;
    message?: string;
  },
): ProviderQuotaSnapshot {
  const base = snapshotBase(provider, "github-copilot-sdk");
  if (!data.authenticated) {
    return {
      ...base,
      state: "unauthenticated",
      message: data.message || "Sign in with GitHub to read Copilot subscription quota.",
      manageUrl: "https://github.com/settings/copilot",
    };
  }

  const snapshots = data.quotaSnapshots || {};
  const ids = Object.keys(snapshots).sort((left, right) => {
    const leftIndex = COPILOT_QUOTA_ORDER.indexOf(left);
    const rightIndex = COPILOT_QUOTA_ORDER.indexOf(right);
    return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
  });
  const windows = ids.flatMap((id): ProviderQuotaWindow[] => {
    const quota = snapshots[id];
    if (!quota || typeof quota !== "object") return [];
    const unlimited = Boolean(quota.isUnlimitedEntitlement);
    const limit = finiteNumber(quota.entitlementRequests);
    const used = finiteNumber(quota.usedRequests);
    const remainingPercent = unlimited ? 100 : percentage(quota.remainingPercentage);
    return [{
      id,
      label: copilotQuotaLabel(id),
      usedPercent: remainingPercent === undefined ? undefined : 100 - remainingPercent,
      remainingPercent,
      used,
      limit: unlimited || limit === -1 ? undefined : limit,
      remaining: unlimited || limit === undefined || used === undefined ? undefined : Math.max(0, limit - used),
      unit: "requests",
      resetAt: isoDate(quota.resetDate),
      unlimited,
      overage: finiteNumber(quota.overage),
      overageAllowed: Boolean(
        quota.overageAllowedWithExhaustedQuota || quota.usageAllowedWithExhaustedQuota,
      ),
    }];
  });

  return {
    ...base,
    state: windows.length ? "available" : "unavailable",
    plan: data.plan,
    account: data.login,
    windows,
    message: windows.length
      ? undefined
      : "GitHub did not return quota snapshots for this Copilot plan.",
    manageUrl: "https://github.com/settings/copilot",
  };
}

function durationLabel(minutes: number | undefined, fallback: string): string {
  if (minutes === 300) return "5-hour limit";
  if (minutes === 10_080) return "Weekly limit";
  if (minutes && minutes % 1_440 === 0) return `${minutes / 1_440}-day limit`;
  if (minutes && minutes % 60 === 0) return `${minutes / 60}-hour limit`;
  return fallback;
}

function codexWindow(id: string, fallbackLabel: string, value: any): ProviderQuotaWindow | null {
  if (!value || typeof value !== "object") return null;
  const usedPercent = percentage(value.usedPercent);
  const windowMinutes = finiteNumber(value.windowDurationMins);
  return {
    id,
    label: durationLabel(windowMinutes, fallbackLabel),
    usedPercent,
    remainingPercent: usedPercent === undefined ? undefined : 100 - usedPercent,
    resetAt: isoDate(value.resetsAt),
    windowMinutes,
  };
}

function codexSpendWindow(value: any): ProviderQuotaWindow | null {
  if (!value || typeof value !== "object") return null;
  const limit = finiteNumber(value.limit);
  const used = finiteNumber(value.used);
  return {
    id: "individual_limit",
    label: "Monthly spend limit",
    usedPercent: limit && used !== undefined ? percentage((used / limit) * 100) : undefined,
    remainingPercent: percentage(value.remainingPercent),
    used,
    limit,
    remaining: limit === undefined || used === undefined ? undefined : Math.max(0, limit - used),
    unit: "credits",
    resetAt: isoDate(value.resetsAt),
  };
}

export function mapCodexQuota(
  provider: ProviderIdentity,
  data: {
    authenticated: boolean;
    email?: string;
    plan?: string;
    rateLimitResult?: any;
    message?: string;
  },
): ProviderQuotaSnapshot {
  const base = snapshotBase(provider, "openai-codex-app-server");
  if (!data.authenticated) {
    return {
      ...base,
      state: "unauthenticated",
      message: data.message || "Sign in with OpenAI to read Codex subscription quota.",
      manageUrl: "https://chatgpt.com/codex/settings/usage",
    };
  }

  const result = data.rateLimitResult || {};
  const rateLimits = result.rateLimits || {};
  const windows = [
    codexWindow("primary", "Primary limit", rateLimits.primary),
    codexWindow("secondary", "Secondary limit", rateLimits.secondary),
    codexSpendWindow(rateLimits.individualLimit),
  ].filter((window): window is ProviderQuotaWindow => Boolean(window));
  const credits = rateLimits.credits;
  const hasBalance = credits && typeof credits === "object" && (credits.unlimited || credits.balance != null);
  const resetCreditsAvailable = finiteNumber(result.rateLimitResetCredits?.availableCount);

  return {
    ...base,
    state: windows.length || hasBalance ? "available" : "unavailable",
    plan: rateLimits.planType || data.plan,
    account: data.email,
    windows,
    balance: hasBalance ? {
      formatted: credits.unlimited ? undefined : String(credits.balance),
      unlimited: Boolean(credits.unlimited),
    } : undefined,
    resetCreditsAvailable,
    spendControlReached: typeof result.spendControlReached === "boolean"
      ? result.spendControlReached
      : undefined,
    message: windows.length || hasBalance
      ? (result.spendControlReached ? "The account spending control has been reached." : undefined)
      : "OpenAI did not return rate-limit windows for this Codex account.",
    manageUrl: "https://chatgpt.com/codex/settings/usage",
  };
}

const CLAUDE_WINDOW_DETAILS: Record<string, { label: string; minutes: number }> = {
  five_hour: { label: "5-hour limit", minutes: 300 },
  seven_day: { label: "Weekly limit", minutes: 10_080 },
  seven_day_oauth_apps: { label: "Weekly OAuth apps limit", minutes: 10_080 },
  seven_day_opus: { label: "Weekly Opus limit", minutes: 10_080 },
  seven_day_sonnet: { label: "Weekly Sonnet limit", minutes: 10_080 },
};

export function mapClaudeCodeQuota(
  provider: ProviderIdentity,
  data: { authenticated: boolean; email?: string; plan?: string; usage?: any; message?: string },
): ProviderQuotaSnapshot {
  const base = snapshotBase(provider, "anthropic-claude-code");
  if (!data.authenticated) {
    return {
      ...base,
      state: "unauthenticated",
      account: data.email,
      plan: data.plan,
      message: data.message || "Sign in with Claude Code to read subscription usage.",
      manageUrl: "https://claude.ai/settings/usage",
    };
  }
  const usage = data.usage || {};
  const windows = Object.entries(CLAUDE_WINDOW_DETAILS).flatMap(([id, details]): ProviderQuotaWindow[] => {
    const value = usage[id];
    if (!value || typeof value !== "object") return [];
    const usedPercent = percentage(value.utilization ?? value.used_percent ?? value.usedPercent);
    return [{
      id,
      label: details.label,
      usedPercent,
      remainingPercent: usedPercent === undefined ? undefined : 100 - usedPercent,
      resetAt: isoDate(value.resets_at ?? value.resetsAt),
      windowMinutes: details.minutes,
    }];
  });
  if (Array.isArray(usage.model_scoped)) {
    usage.model_scoped.forEach((value: any, index: number) => {
      if (!value || typeof value !== "object") return;
      const usedPercent = percentage(value.utilization ?? value.used_percent ?? value.usedPercent);
      windows.push({
        id: `model_scoped_${index}`,
        label: typeof value.display_name === "string" && value.display_name.trim()
          ? `Weekly ${value.display_name.trim()} limit`
          : "Weekly model limit",
        usedPercent,
        remainingPercent: usedPercent === undefined ? undefined : 100 - usedPercent,
        resetAt: isoDate(value.resets_at ?? value.resetsAt),
        windowMinutes: 10_080,
      });
    });
  }
  const extraUsage = usage.extra_usage;
  if (extraUsage?.is_enabled) {
    const usedPercent = percentage(extraUsage.utilization);
    const used = finiteNumber(extraUsage.used_credits);
    const limit = finiteNumber(extraUsage.monthly_limit);
    windows.push({
      id: "extra_usage",
      label: "Monthly extra usage",
      usedPercent,
      remainingPercent: usedPercent === undefined ? undefined : 100 - usedPercent,
      used,
      limit,
      remaining: used === undefined || limit === undefined ? undefined : Math.max(0, limit - used),
      unit: "credits",
    });
  }
  return {
    ...base,
    state: windows.length ? "available" : "unavailable",
    account: data.email,
    plan: data.plan,
    windows,
    message: windows.length ? data.message : data.message || "Anthropic did not return usage windows for this Claude Code account.",
    manageUrl: "https://claude.ai/settings/usage",
  };
}

interface UnavailableProviderDetails {
  source: string;
  message: string;
  manageUrl?: string;
}

const UNAVAILABLE_PROVIDER_DETAILS: Record<string, UnavailableProviderDetails> = {
  opencode: {
    source: "opencode-console",
    message: "OpenCode does not expose Zen balance through a public API. View it in the OpenCode console.",
    manageUrl: "https://opencode.ai/console",
  },
  "opencode-go": {
    source: "opencode-console",
    message: "OpenCode does not currently expose Go subscription windows through a public API. View them in the OpenCode console.",
    manageUrl: "https://opencode.ai/console",
  },
  openai: {
    source: "openai-platform",
    message: "A standard OpenAI project key cannot read organization billing quota. An organization Admin API key is required for the Usage API.",
    manageUrl: "https://platform.openai.com/usage",
  },
  anthropic: {
    source: "anthropic-console",
    message: "A standard Anthropic API key cannot read organization usage. The Usage and Cost API requires an Admin API key.",
    manageUrl: "https://console.anthropic.com/settings/usage",
  },
  "github-models": {
    source: "github-models",
    message: "GitHub Models does not expose an account subscription quota through its model catalog API.",
    manageUrl: "https://github.com/marketplace/models",
  },
};

export function mapUnavailableProviderQuota(
  provider: ProviderIdentity,
  authenticated: boolean,
  details = UNAVAILABLE_PROVIDER_DETAILS[provider.id],
): ProviderQuotaSnapshot {
  const resolved = details || {
    source: "provider",
    message: "This provider does not advertise an account quota endpoint.",
  };
  return {
    ...snapshotBase(provider, resolved.source),
    state: authenticated ? "unavailable" : "unauthenticated",
    message: authenticated
      ? resolved.message
      : `Configure credentials for ${provider.name} to check quota availability.`,
    manageUrl: resolved.manageUrl,
  };
}

export async function fetchProviderQuota(provider: LlmProviderConfig): Promise<ProviderQuotaSnapshot> {
  if (provider.transport === "github-copilot-sdk" || provider.id === "github-copilot") {
    const result = await readCopilotQuota();
    return mapCopilotQuota(provider, {
      authenticated: result.status.authenticated,
      login: result.status.login,
      plan: result.plan,
      quotaSnapshots: result.quotaSnapshots,
      message: result.status.message,
    });
  }
  if (provider.transport === "openai-codex-app-server" || provider.id === "openai-codex") {
    const result = await readCodexQuota();
    return mapCodexQuota(provider, {
      authenticated: result.status.authenticated,
      email: result.status.email,
      plan: result.status.planType,
      rateLimitResult: result.rateLimitResult,
      message: result.status.message,
    });
  }
  if (provider.transport === "anthropic-claude-agent-sdk" || provider.id === "anthropic-claude-code") {
    const result = await readClaudeCodeQuota();
    return mapClaudeCodeQuota(provider, {
      authenticated: result.status.authenticated,
      email: result.status.email,
      plan: result.status.planType,
      usage: result.usage,
      message: result.message || result.status.message,
    });
  }

  const authType = provider.authType || (resolveProviderApiKey(provider) ? "bearer" : "none");
  const authenticated = authType === "none" || Boolean(resolveProviderApiKey(provider));
  return mapUnavailableProviderQuota(provider, authenticated);
}
