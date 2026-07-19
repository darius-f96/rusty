import type { CustomProvider, ProviderModel } from "./types";

export function normalizedProviderId(providerId: string): string {
  return providerId === "github-copilot" ? "github-models" : providerId;
}

function normalizeProviderModel(
  model: ProviderModel,
  originalProviderId: string,
  providerId: string,
): ProviderModel {
  const originalPrefix = `${originalProviderId}/`;
  const remoteId = model.remoteId
    || (model.id.startsWith(originalPrefix) ? model.id.slice(originalPrefix.length) : model.id);
  return {
    ...model,
    id: `${providerId}/${remoteId}`,
    remoteId,
    apiType: model.apiType === "anthropic" ? "anthropic-messages" : model.apiType,
  };
}

export function normalizeStoredProvider(provider: CustomProvider): CustomProvider {
  const providerId = normalizedProviderId(provider.id);
  const apiType = provider.apiType === "anthropic" ? "anthropic-messages" : provider.apiType;
  const builtInBearerProviders = new Set(["openai", "opencode", "opencode-go", "github-models"]);
  const inferredAuthType = providerId === "anthropic"
    ? "anthropic"
    : builtInBearerProviders.has(providerId) || provider.apiKey
      ? "bearer"
      : "none";
  return {
    ...provider,
    id: providerId,
    name: provider.id === "github-copilot" ? "GitHub Models" : provider.name,
    apiType,
    authType: provider.authType || inferredAuthType,
    models: (provider.models || []).map((model) => normalizeProviderModel(model, provider.id, providerId)),
  };
}

export function normalizeStoredModelReference(model: string | undefined): string | undefined {
  if (!model) return model;
  return model.startsWith("github-copilot/")
    ? `github-models/${model.slice("github-copilot/".length)}`
    : model;
}
