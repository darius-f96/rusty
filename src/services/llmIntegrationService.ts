import type { CustomProvider, ProviderModel } from "../store";

const SIDECAR_HTTP_URL = "http://localhost:4000";

async function post<T>(path: string, provider: CustomProvider): Promise<T> {
  const connectionConfig = { ...provider, models: [] };
  const response = await fetch(`${SIDECAR_HTTP_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: connectionConfig }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Sidecar request failed (${response.status}).`);
  return payload as T;
}

export const llmIntegrationService = {
  async discoverModels(provider: CustomProvider): Promise<ProviderModel[]> {
    const result = await post<{ models: ProviderModel[] }>("/llm/models", provider);
    return result.models;
  },

  async testConnection(provider: CustomProvider): Promise<{ modelCount: number; supportedModelCount: number }> {
    return post<{ ok: true; modelCount: number; supportedModelCount: number }>("/llm/test", provider);
  },
};
