import type { CustomProvider, ProviderQuotaSnapshot, ProviderQuotaWindow } from "../../store";

/** Key used to persist the selected quota provider in localStorage. */
export const SELECTED_QUOTA_PROVIDER_KEY = "axiom_quota_provider";

/** Interval (ms) between automatic quota refreshes. */
export const REFRESH_INTERVAL_MS = 5 * 60 * 1_000;

/**
 * Returns true when the provider has enough configuration to attempt a quota fetch.
 */
export function isConfiguredProvider(provider: CustomProvider): boolean {
  return (
    provider.authType === "environment"
    || provider.authType === "none"
    || Boolean(provider.apiKey?.trim())
  );
}

/**
 * Formats a number with locale-aware separators and at most one decimal.
 */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Formats an ISO timestamp into a short human-readable reset string.
 */
export function formatResetTimestamp(resetAt: string): string {
  const timestamp = Date.parse(resetAt);
  if (!Number.isFinite(timestamp)) return resetAt;

  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return formatter.format(new Date(timestamp));
}

/**
 * Returns a short label summarising the current quota state.
 */
export function getQuotaSummary(
  quota: ProviderQuotaSnapshot | undefined,
  loading: boolean,
): string {
  if (loading) return "Checking…";
  if (!quota) return "Quota";
  if (quota.state === "unauthenticated") return "Sign in required";
  if (quota.state === "unavailable") return "Quota unavailable";

  const preferredWindow =
    quota.windows.find((w) => w.id === "premium_interactions")
    || quota.windows[0];

  if (preferredWindow?.unlimited) return "Unlimited";
  if (preferredWindow?.remainingPercent !== undefined) {
    return `${Math.round(preferredWindow.remainingPercent)}% left`;
  }
  if (quota.balance?.unlimited) return "Unlimited credits";
  if (quota.balance?.formatted) return `${quota.balance.formatted} credits`;

  return "Quota available";
}

/**
 * Returns a CSS colour variable based on how much quota remains.
 */
export function getProgressColor(remaining: number): string {
  if (remaining <= 10) return "var(--color-status-danger)";
  if (remaining <= 30) return "var(--color-status-warning)";
  return "var(--accent-color)";
}

/**
 * Computes the display text for a single quota window row.
 */
export function getWindowDisplayText(window: ProviderQuotaWindow): string {
  if (window.unlimited) return "Unlimited";
  if (window.remaining !== undefined && window.limit !== undefined) {
    return `${formatNumber(window.remaining)} of ${formatNumber(window.limit)} ${window.unit || "requests"} left`;
  }
  if (window.used !== undefined && window.limit !== undefined) {
    return `${formatNumber(window.used)} of ${formatNumber(window.limit)} ${window.unit || "requests"} used`;
  }
  if (window.remainingPercent !== undefined) {
    return `${Math.round(window.remainingPercent)}% remaining`;
  }
  return "Usage available";
}
