import type { CustomProvider, ProviderModel } from "./types";

/**
 * Version 1 and older used the misleading `github-copilot` id for GitHub
 * Models. Version 2 introduces a real Copilot SDK provider under that id.
 */
export const PROVIDER_CONFIG_VERSION = 2;

export function normalizedProviderId(
  providerId: string,
  configVersion = PROVIDER_CONFIG_VERSION,
): string {
  return configVersion < PROVIDER_CONFIG_VERSION && providerId === "github-copilot"
    ? "github-models"
    : providerId;
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

export function normalizeStoredProvider(
  provider: CustomProvider,
  configVersion = PROVIDER_CONFIG_VERSION,
): CustomProvider {
  const providerId = normalizedProviderId(provider.id, configVersion);
  const apiType = provider.apiType === "anthropic" ? "anthropic-messages" : provider.apiType;
  const builtInBearerProviders = new Set(["openai", "opencode", "opencode-go", "github-models"]);
  const inferredAuthType = providerId === "github-copilot" || providerId === "openai-codex"
    ? "environment"
    : providerId === "anthropic"
    ? "anthropic"
    : builtInBearerProviders.has(providerId) || provider.apiKey
      ? "bearer"
      : "none";
  return {
    ...provider,
    id: providerId,
    name: configVersion < PROVIDER_CONFIG_VERSION && provider.id === "github-copilot"
      ? "GitHub Models"
      : provider.name,
    apiType,
    authType: provider.authType || inferredAuthType,
    models: (provider.models || []).map((model) => normalizeProviderModel(model, provider.id, providerId)),
  };
}

export function normalizeStoredModelReference(
  model: string | undefined,
  configVersion = PROVIDER_CONFIG_VERSION,
): string | undefined {
  if (!model) return model;
  return configVersion < PROVIDER_CONFIG_VERSION && model.startsWith("github-copilot/")
    ? `github-models/${model.slice("github-copilot/".length)}`
    : model;
}

/**
 * Providers whose models may appear in model selectors.
 *
 * The selected provider remains available because built-in integrations can
 * receive credentials from the sidecar environment. Other providers must be
 * explicitly configured so untouched built-in catalogs do not leak into every
 * model dropdown.
 */
export function selectableModelProviders(
  providers: CustomProvider[],
  selectedProviderId: string | null,
): CustomProvider[] {
  return providers.filter((provider) =>
    provider.id === selectedProviderId
    || provider.authType === "none"
    || provider.authType === "environment"
    || Boolean(provider.apiKey?.trim())
  );
}

export function selectableProviderModels(
  providers: CustomProvider[],
  selectedProviderId: string | null,
): Array<{ provider: CustomProvider; model: ProviderModel }> {
  return selectableModelProviders(providers, selectedProviderId).flatMap((provider) =>
    provider.models
      .filter((model) => model.supported !== false)
      .map((model) => ({ provider, model }))
  );
}
