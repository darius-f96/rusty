import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

interface ManagedProviderStatus {
  state: "disconnected" | "connecting" | "connected" | "failed";
  authenticated: boolean;
  message?: string;
}

interface UseManagedProviderStatusOptions<TStatus extends ManagedProviderStatus> {
  providerId: string;
  loadStatus: () => Promise<TStatus>;
  unavailableMessage: string;
  updateConnectionStatus: Dispatch<
    SetStateAction<Record<string, "connected" | "failed">>
  >;
}

interface ManagedProviderStatusState<TStatus extends ManagedProviderStatus> {
  status: TStatus | null;
  setStatus: Dispatch<SetStateAction<TStatus | null>>;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function statusPollingDelay(status: ManagedProviderStatus): number {
  return status.state === "connecting" ? 1_000 : 10_000;
}

function updateProviderConnectionState(
  providerId: string,
  status: ManagedProviderStatus,
  updateConnectionStatus: Dispatch<
    SetStateAction<Record<string, "connected" | "failed">>
  >,
): void {
  if (!status.authenticated && status.state !== "failed") return;

  updateConnectionStatus((current) => ({
    ...current,
    [providerId]: status.authenticated ? "connected" : "failed",
  }));
}

export function useManagedProviderStatus<TStatus extends ManagedProviderStatus>({
  providerId,
  loadStatus,
  unavailableMessage,
  updateConnectionStatus,
}: UseManagedProviderStatusOptions<TStatus>): ManagedProviderStatusState<TStatus> {
  const [status, setStatus] = useState<TStatus | null>(null);

  useEffect(() => {
    let isCancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const pollStatus = async () => {
      try {
        const nextStatus = await loadStatus();
        if (isCancelled) return;

        setStatus(nextStatus);
        updateProviderConnectionState(providerId, nextStatus, updateConnectionStatus);
        timer = setTimeout(pollStatus, statusPollingDelay(nextStatus));
      } catch (error) {
        if (isCancelled) return;

        const failedStatus = {
          state: "failed" as const,
          authenticated: false,
          message: errorMessage(error, unavailableMessage),
        } as TStatus;
        setStatus(failedStatus);
        updateProviderConnectionState(providerId, failedStatus, updateConnectionStatus);
        timer = setTimeout(pollStatus, 10_000);
      }
    };

    void pollStatus();
    return () => {
      isCancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [loadStatus, providerId, unavailableMessage, updateConnectionStatus]);

  return { status, setStatus };
}
