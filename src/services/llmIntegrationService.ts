import type { CustomProvider, ProviderModel, ProviderQuotaSnapshot } from "../store";

const SIDECAR_HTTP_URL = "http://localhost:4000";

export interface CopilotConnectionStatus {
  state: "disconnected" | "connecting" | "connected" | "failed";
  authenticated: boolean;
  authType?: string;
  host?: string;
  login?: string;
  message?: string;
  verificationUri?: string;
  userCode?: string;
  diagnostics?: string[];
}

export interface CodexConnectionStatus {
  state: "disconnected" | "connecting" | "connected" | "failed";
  authenticated: boolean;
  authType?: string;
  email?: string;
  planType?: string;
  message?: string;
  verificationUri?: string;
  userCode?: string;
  diagnostics?: string[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SIDECAR_HTTP_URL}${path}`, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Sidecar request failed (${response.status}).`);
  return payload as T;
}

async function post<T>(path: string, provider: CustomProvider): Promise<T> {
  const connectionConfig = { ...provider, models: [] };
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: connectionConfig }),
  });
}

export const llmIntegrationService = {
  async discoverModels(provider: CustomProvider): Promise<ProviderModel[]> {
    const result = await post<{ models: ProviderModel[] }>("/llm/models", provider);
    return result.models;
  },

  async testConnection(provider: CustomProvider): Promise<{ modelCount: number; supportedModelCount: number }> {
    return post<{ ok: true; modelCount: number; supportedModelCount: number }>("/llm/test", provider);
  },

  async getQuota(provider: CustomProvider): Promise<ProviderQuotaSnapshot> {
    return post<ProviderQuotaSnapshot>("/llm/quota", provider);
  },

  async getCopilotStatus(): Promise<CopilotConnectionStatus> {
    return request<CopilotConnectionStatus>("/llm/copilot/status");
  },

  async startCopilotLogin(): Promise<CopilotConnectionStatus> {
    return request<CopilotConnectionStatus>("/llm/copilot/login", {
      method: "POST",
    });
  },

  async getCodexStatus(): Promise<CodexConnectionStatus> {
    return request<CodexConnectionStatus>("/llm/codex/status");
  },

  async startCodexLogin(): Promise<CodexConnectionStatus> {
    return request<CodexConnectionStatus>("/llm/codex/login", {
      method: "POST",
    });
  },
};
