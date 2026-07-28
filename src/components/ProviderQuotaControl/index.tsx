import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useWorkspaceStore } from "../../store";
import type { CustomProvider, ProviderQuotaSnapshot } from "../../store";
import { llmIntegrationService } from "../../services/llmIntegrationService";
import type { Option } from "../CustomSelect";
import { ProviderQuotaControlView } from "./ProviderQuotaControl.view";
import {
  isConfiguredProvider,
  SELECTED_QUOTA_PROVIDER_KEY,
  REFRESH_INTERVAL_MS,
} from "./helpers";

/* ── Module-level state ──────────────────────────────────────────────────── */

/** Counter for discarding stale fetch responses. */
let fetchCounter = 0;

/* ── Component ───────────────────────────────────────────────────────────── */

/**
 * Controls the display and fetching of provider quota information.
 *
 * This component manages:
 *  - Persisting the selected provider across sessions
 *  - Fetching and caching quota snapshots
 *  - Auto-refreshing on an interval
 *  - Outside-click / Escape-key dismissal of the dropdown
 */
export const ProviderQuotaControl: React.FC = () => {
  const customProviders = useWorkspaceStore((s) => s.customProviders);
  const activeProviderId = useWorkspaceStore((s) => s.activeCustomProviderId);

  const providers = useMemo(
    () => customProviders.filter(isConfiguredProvider),
    [customProviders],
  );

  const [selectedId, setSelectedId] = useState(() =>
    localStorage.getItem(SELECTED_QUOTA_PROVIDER_KEY) || activeProviderId || "",
  );
  const [quotas, setQuotas] = useState<Record<string, ProviderQuotaSnapshot>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);

  const selectedProvider = providers.find((p) => p.id === selectedId) ?? null;
  const selectedQuota = selectedProvider ? quotas[selectedProvider.id] : undefined;
  const selectedError = selectedProvider ? errors[selectedProvider.id] : undefined;
  const loading = loadingId === selectedProvider?.id;

  /* ── Effects ───────────────────────────────────────────────────────────── */

  useFallbackProviderEffect(providers, activeProviderId, selectedId, setSelectedId);
  usePersistSelectedIdEffect(selectedId);
  useQuotaFetchEffect(selectedProvider, setErrors, setQuotas, setLoadingId);
  useAutoRefreshEffect(selectedProvider, setErrors, setQuotas, setLoadingId);
  useDismissEffect(open, setOpen, rootRef);

  /* ── Handlers ──────────────────────────────────────────────────────────── */

  const handleToggleOpen = useCallback(() => {
    setOpen((v) => !v);
  }, []);

  const handleProviderChange = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const handleRefresh = useCallback(() => {
    if (!selectedProvider) return;
    fetchQuota(selectedProvider, setErrors, setQuotas, setLoadingId);
  }, [selectedProvider]);

  const handleOpenManageUrl = useCallback(() => {
    if (selectedQuota?.manageUrl) {
      void openUrl(selectedQuota.manageUrl);
    }
  }, [selectedQuota?.manageUrl]);

  /* ── Derived data ──────────────────────────────────────────────────────── */

  const providerOptions: Option[] = useMemo(
    () => providers.map((p) => ({ id: p.id, name: p.name })),
    [providers],
  );

  /* ── Render ────────────────────────────────────────────────────────────── */

  return (
    <ProviderQuotaControlView
      selectedProvider={selectedProvider}
      selectedQuota={selectedQuota}
      selectedError={selectedError}
      loading={loading}
      open={open}
      providerOptions={providerOptions}
      rootRef={rootRef}
      onToggleOpen={handleToggleOpen}
      onProviderChange={handleProviderChange}
      onRefresh={handleRefresh}
      onOpenManageUrl={handleOpenManageUrl}
    />
  );
};

export default ProviderQuotaControl;

/* ── Effects ─────────────────────────────────────────────────────────────── */

/**
 * Falls back to the active or first provider when the current selection
 * is no longer available.
 */
function useFallbackProviderEffect(
  providers: CustomProvider[],
  activeId: string | null,
  selectedId: string,
  setSelectedId: React.Dispatch<React.SetStateAction<string>>,
) {
  useEffect(() => {
    const isSelectedStillValid = providers.some((p) => p.id === selectedId);
    if (isSelectedStillValid) return;

    const fallback = providers.find((p) => p.id === activeId) || providers[0];
    if (fallback) setSelectedId(fallback.id);
  }, [activeId, providers, selectedId, setSelectedId]);
}

/**
 * Persists the selected provider ID to localStorage.
 */
function usePersistSelectedIdEffect(selectedId: string) {
  useEffect(() => {
    if (!selectedId) return;
    localStorage.setItem(SELECTED_QUOTA_PROVIDER_KEY, selectedId);
  }, [selectedId]);
}

/**
 * Fetches the quota for the selected provider on mount and when it changes.
 */
function useQuotaFetchEffect(
  provider: CustomProvider | null,
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>,
  setQuotas: React.Dispatch<React.SetStateAction<Record<string, ProviderQuotaSnapshot>>>,
  setLoadingId: React.Dispatch<React.SetStateAction<string | null>>,
) {
  useEffect(() => {
    if (!provider) return;
    fetchQuota(provider, setErrors, setQuotas, setLoadingId);
  }, [provider]);
}

/**
 * Sets up an automatic refresh timer for the selected provider's quota.
 */
function useAutoRefreshEffect(
  provider: CustomProvider | null,
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>,
  setQuotas: React.Dispatch<React.SetStateAction<Record<string, ProviderQuotaSnapshot>>>,
  setLoadingId: React.Dispatch<React.SetStateAction<string | null>>,
) {
  useEffect(() => {
    if (!provider) return;

    const timer = window.setInterval(() => {
      fetchQuota(provider, setErrors, setQuotas, setLoadingId);
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [provider]);
}

/**
 * Handles outside-click and Escape-key dismissal for the dropdown.
 */
function useDismissEffect(
  open: boolean,
  setOpen: React.Dispatch<React.SetStateAction<boolean>>,
  rootRef: React.RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!open) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-custom-select-dropdown]")) return;
      if (!rootRef.current?.contains(target)) setOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, setOpen, rootRef]);
}

/* ── Data fetching ───────────────────────────────────────────────────────── */

/**
 * Fetches a quota snapshot for the given provider and updates state.
 * Uses a request counter to discard stale responses.
 */
async function fetchQuota(
  provider: CustomProvider,
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>,
  setQuotas: React.Dispatch<React.SetStateAction<Record<string, ProviderQuotaSnapshot>>>,
  setLoadingId: React.Dispatch<React.SetStateAction<string | null>>,
): Promise<void> {
  const currentRequest = ++fetchCounter;

  setLoadingId(provider.id);
  clearProviderError(provider.id, setErrors);

  try {
    const quota = await llmIntegrationService.getQuota(provider);
    if (currentRequest !== fetchCounter) return;
    setQuotas((prev) => ({ ...prev, [provider.id]: quota }));
  } catch (error) {
    if (currentRequest !== fetchCounter) return;
    setProviderError(provider.id, error, setErrors);
  } finally {
    if (currentRequest === fetchCounter) setLoadingId(null);
  }
}

function clearProviderError(
  providerId: string,
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>,
) {
  setErrors((prev) => {
    const next = { ...prev };
    delete next[providerId];
    return next;
  });
}

function setProviderError(
  providerId: string,
  error: unknown,
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>,
) {
  const message = error instanceof Error ? error.message : String(error);
  setErrors((prev) => ({ ...prev, [providerId]: message }));
}
