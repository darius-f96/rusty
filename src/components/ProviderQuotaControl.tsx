import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertCircle, ChevronDown, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useWorkspaceStore } from "../store";
import type { CustomProvider, ProviderQuotaSnapshot, ProviderQuotaWindow } from "../store";
import { llmIntegrationService } from "../services/llmIntegrationService";
import { CustomSelect } from "./CustomSelect";

const SELECTED_QUOTA_PROVIDER_KEY = "axiom_quota_provider";
const REFRESH_INTERVAL_MS = 5 * 60 * 1_000;

function isConfiguredProvider(provider: CustomProvider): boolean {
  return provider.authType === "environment"
    || provider.authType === "none"
    || Boolean(provider.apiKey?.trim());
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

function formatReset(resetAt: string): string {
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

function quotaSummary(quota: ProviderQuotaSnapshot | undefined, loading: boolean): string {
  if (loading) return "Checking…";
  if (!quota) return "Quota";
  if (quota.state === "unauthenticated") return "Sign in required";
  if (quota.state === "unavailable") return "Quota unavailable";
  const preferredWindow = quota.windows.find((window) => window.id === "premium_interactions")
    || quota.windows[0];
  if (preferredWindow?.unlimited) return "Unlimited";
  if (preferredWindow?.remainingPercent !== undefined) {
    return `${Math.round(preferredWindow.remainingPercent)}% left`;
  }
  if (quota.balance?.unlimited) return "Unlimited credits";
  if (quota.balance?.formatted) return `${quota.balance.formatted} credits`;
  return "Quota available";
}

function progressColor(remaining: number): string {
  if (remaining <= 10) return "var(--color-status-danger)";
  if (remaining <= 30) return "var(--color-status-warning)";
  return "var(--accent-color)";
}

const QuotaWindowRow: React.FC<{ window: ProviderQuotaWindow }> = ({ window }) => {
  const remaining = window.unlimited ? 100 : window.remainingPercent;
  const unit = window.unit || "requests";
  return (
    <div className="rounded-lg border border-[var(--border-color)]/70 bg-[var(--bg-app)]/70 p-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-[10px] font-bold text-[var(--text-light)]">
            {window.label}
          </div>
          <div className="mt-0.5 font-mono text-[9px] text-[var(--text-muted)]">
            {window.unlimited
              ? "Unlimited"
              : window.remaining !== undefined && window.limit !== undefined
                ? `${formatNumber(window.remaining)} of ${formatNumber(window.limit)} ${unit} left`
                : window.used !== undefined && window.limit !== undefined
                  ? `${formatNumber(window.used)} of ${formatNumber(window.limit)} ${unit} used`
                  : window.remainingPercent !== undefined
                    ? `${Math.round(window.remainingPercent)}% remaining`
                    : "Usage available"}
          </div>
        </div>
        {remaining !== undefined && (
          <span className="shrink-0 font-mono text-[11px] font-bold text-[var(--text-light)]">
            {Math.round(remaining)}%
          </span>
        )}
      </div>
      {remaining !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--border-color)]/70">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${Math.max(0, Math.min(100, remaining))}%`, backgroundColor: progressColor(remaining) }}
          />
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[8px] text-[var(--text-muted)]">
        {window.resetAt && <span title={window.resetAt}>Resets {formatReset(window.resetAt)}</span>}
        {window.overage !== undefined && window.overage > 0 && <span>{formatNumber(window.overage)} overage</span>}
        {window.overageAllowed && <span>Paid overage enabled</span>}
      </div>
    </div>
  );
};

export const ProviderQuotaControl: React.FC = () => {
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const activeProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);
  const providers = useMemo(
    () => customProviders.filter(isConfiguredProvider),
    [customProviders],
  );
  const [selectedProviderId, setSelectedProviderId] = useState(() =>
    localStorage.getItem(SELECTED_QUOTA_PROVIDER_KEY) || activeProviderId || ""
  );
  const [quotas, setQuotas] = useState<Record<string, ProviderQuotaSnapshot>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadingProviderId, setLoadingProviderId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const requestId = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const selectedQuota = selectedProvider ? quotas[selectedProvider.id] : undefined;
  const selectedError = selectedProvider ? errors[selectedProvider.id] : undefined;
  const loading = loadingProviderId === selectedProvider?.id;

  useEffect(() => {
    if (selectedProvider) return;
    const fallback = providers.find((provider) => provider.id === activeProviderId) || providers[0];
    if (fallback) setSelectedProviderId(fallback.id);
  }, [activeProviderId, providers, selectedProvider]);

  useEffect(() => {
    if (!selectedProviderId) return;
    localStorage.setItem(SELECTED_QUOTA_PROVIDER_KEY, selectedProviderId);
  }, [selectedProviderId]);

  const refresh = useCallback(async () => {
    if (!selectedProvider) return;
    const currentRequest = ++requestId.current;
    setLoadingProviderId(selectedProvider.id);
    setErrors((current) => {
      const next = { ...current };
      delete next[selectedProvider.id];
      return next;
    });
    try {
      const quota = await llmIntegrationService.getQuota(selectedProvider);
      if (currentRequest !== requestId.current) return;
      setQuotas((current) => ({ ...current, [selectedProvider.id]: quota }));
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      setErrors((current) => ({
        ...current,
        [selectedProvider.id]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      if (currentRequest === requestId.current) setLoadingProviderId(null);
    }
  }, [selectedProvider]);

  useEffect(() => {
    if (!selectedProvider) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh, selectedProvider]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-custom-select-dropdown]")) return;
      if (!rootRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!selectedProvider) return null;

  const summary = selectedError ? "Quota error" : quotaSummary(selectedQuota, loading);
  const openManageUrl = async () => {
    if (selectedQuota?.manageUrl) await openUrl(selectedQuota.manageUrl);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-7 max-w-[250px] items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-sidebar)] px-2.5 text-left transition-colors hover:border-[var(--accent-color)]/45"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`${selectedProvider.name}: ${summary}`}
      >
        {loading ? (
          <Loader2 size={12} className="shrink-0 animate-spin text-[var(--accent-color)]" />
        ) : selectedError ? (
          <AlertCircle size={12} className="shrink-0 text-[var(--color-status-danger)]" />
        ) : (
          <Activity size={12} className="shrink-0 text-[var(--accent-color)]" />
        )}
        <span className="max-w-[92px] truncate font-mono text-[9px] text-[var(--text-muted)]">
          {selectedProvider.name}
        </span>
        <span className="truncate font-mono text-[9px] font-bold text-[var(--text-light)]">{summary}</span>
        <ChevronDown size={10} className={`ml-auto shrink-0 text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Provider subscription quota"
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-[360px] overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-sidebar)] shadow-2xl"
        >
          <div className="flex items-center gap-2 border-b border-[var(--border-color)] p-3">
            <Activity size={14} className="shrink-0 text-[var(--accent-color)]" />
            <CustomSelect
              value={selectedProvider.id}
              onChange={setSelectedProviderId}
              options={providers.map((provider) => ({ id: provider.id, name: provider.name }))}
              className="min-w-0 flex-1"
              direction="down"
            />
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-muted)] hover:border-[var(--accent-color)] hover:text-[var(--text-light)] disabled:opacity-50"
              title="Refresh quota"
              aria-label="Refresh quota"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            </button>
          </div>

          <div className="max-h-[430px] space-y-3 overflow-y-auto p-3">
            {(selectedQuota?.plan || selectedQuota?.account) && (
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[9px] text-[var(--text-muted)]">
                <span className="truncate">{selectedQuota.account || selectedProvider.name}</span>
                {selectedQuota.plan && (
                  <span className="rounded-full border border-[var(--accent-color)]/35 bg-[var(--accent-bg)]/15 px-2 py-0.5 font-bold text-[var(--text-light)]">
                    {selectedQuota.plan}
                  </span>
                )}
              </div>
            )}

            {selectedError && (
              <div className="rounded-lg border border-[var(--color-status-danger)]/35 bg-[var(--color-status-danger)]/10 p-3 font-mono text-[9px] leading-relaxed text-[var(--text-normal)]">
                {selectedError}
              </div>
            )}

            {!selectedError && loading && !selectedQuota && (
              <div className="flex items-center justify-center gap-2 py-8 font-mono text-[10px] text-[var(--text-muted)]">
                <Loader2 size={14} className="animate-spin text-[var(--accent-color)]" />
                Reading provider quota…
              </div>
            )}

            {!selectedError && selectedQuota?.windows.map((window) => (
              <QuotaWindowRow key={window.id} window={window} />
            ))}

            {selectedQuota?.balance && (
              <div className="flex items-center justify-between rounded-lg border border-[var(--border-color)]/70 bg-[var(--bg-app)]/70 p-2.5 font-mono">
                <span className="text-[9px] text-[var(--text-muted)]">Credit balance</span>
                <span className="text-[11px] font-bold text-[var(--text-light)]">
                  {selectedQuota.balance.unlimited ? "Unlimited" : selectedQuota.balance.formatted}
                </span>
              </div>
            )}

            {selectedQuota?.resetCreditsAvailable !== undefined && (
              <div className="font-mono text-[9px] text-[var(--text-muted)]">
                Earned resets available: <span className="font-bold text-[var(--text-light)]">{selectedQuota.resetCreditsAvailable}</span>
              </div>
            )}

            {selectedQuota?.message && (
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-app)]/60 p-3 font-mono text-[9px] leading-relaxed text-[var(--text-muted)]">
                {selectedQuota.message}
              </div>
            )}

            {selectedQuota?.manageUrl && (
              <button
                type="button"
                onClick={() => void openManageUrl()}
                className="flex items-center gap-1.5 font-mono text-[9px] font-bold text-[var(--accent-color)] hover:underline"
              >
                <ExternalLink size={10} />
                Open provider usage
              </button>
            )}
          </div>

          {selectedQuota && (
            <div className="border-t border-[var(--border-color)] px-3 py-2 font-mono text-[8px] text-[var(--text-muted)]">
              Updated {formatReset(selectedQuota.fetchedAt)} · {selectedQuota.source}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
