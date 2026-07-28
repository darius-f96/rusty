import { GitBranch } from "lucide-react";
import type { CustomProvider } from "../../../store";
import { providerModelVariants } from "../../../store/providerHelpers";
import type {
  ClaudeCodeConnectionStatus,
  CodexConnectionStatus,
  CopilotConnectionStatus,
} from "../../../services/llmIntegrationService";

type ConnectionStatus = "connected" | "failed";
type ManagedStatus =
  | ClaudeCodeConnectionStatus
  | CodexConnectionStatus
  | CopilotConnectionStatus;

const PROVIDERS_WITH_ENVIRONMENT_CREDENTIALS = new Set([
  "openai",
  "openai-codex",
  "anthropic",
  "opencode",
  "opencode-go",
  "github-models",
  "github-copilot",
]);

interface ProviderListProps {
  providers: CustomProvider[];
  activeProviderId: string | null;
  connectionStatuses: Record<string, ConnectionStatus>;
  copilotStatus: CopilotConnectionStatus | null;
  codexStatus: CodexConnectionStatus | null;
  claudeCodeStatus: ClaudeCodeConnectionStatus | null;
  onSelectProvider: (provider: CustomProvider) => void;
}

interface ProviderBadge {
  label: string;
  colorClassName: string;
}

function isCopilotProvider(provider: CustomProvider): boolean {
  return provider.transport === "github-copilot-sdk" || provider.id === "github-copilot";
}

function isCodexProvider(provider: CustomProvider): boolean {
  return provider.transport === "openai-codex-app-server" || provider.id === "openai-codex";
}

function isClaudeCodeProvider(provider: CustomProvider): boolean {
  return provider.transport === "anthropic-claude-agent-sdk"
    || provider.id === "anthropic-claude-code";
}

function managedStatusForProvider(
  provider: CustomProvider,
  statuses: Pick<
    ProviderListProps,
    "claudeCodeStatus" | "codexStatus" | "copilotStatus"
  >,
): ManagedStatus | null {
  if (isCodexProvider(provider)) return statuses.codexStatus;
  if (isClaudeCodeProvider(provider)) return statuses.claudeCodeStatus;
  if (isCopilotProvider(provider)) return statuses.copilotStatus;
  return null;
}

function providerBadge(
  provider: CustomProvider,
  connectionStatus: ConnectionStatus | undefined,
  managedStatus: ManagedStatus | null,
): ProviderBadge {
  if (isCopilotProvider(provider) || isCodexProvider(provider) || isClaudeCodeProvider(provider)) {
    return managedStatus ? managedProviderBadge(managedStatus) : warningBadge("Sign In");
  }
  if (connectionStatus === "connected") return successBadge("Connected");
  if (connectionStatus === "failed") return failedBadge("Failed");
  if (provider.apiKey) return successBadge("Configured");
  if (requiresAnApiKey(provider)) return failedBadge("Key Required");
  return warningBadge(provider.authType === "none" ? "No Auth" : "Env / Key");
}

function managedProviderBadge(status: ManagedStatus): ProviderBadge {
  if (status.authenticated) return successBadge("Connected");
  if (status.state === "connecting") return warningBadge("Signing In");
  if (status.state === "failed") return failedBadge("Failed");
  return warningBadge("Sign In");
}

function successBadge(label: string): ProviderBadge {
  return {
    label,
    colorClassName: "bg-[var(--color-status-success-solid)] text-[var(--color-status-success-solid-foreground)]",
  };
}

function failedBadge(label: string): ProviderBadge {
  return {
    label,
    colorClassName: "bg-[var(--color-status-danger-bg)] text-[var(--color-status-danger)]",
  };
}

function warningBadge(label: string): ProviderBadge {
  return {
    label,
    colorClassName: "bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning)]",
  };
}

function requiresAnApiKey(provider: CustomProvider): boolean {
  return provider.authType !== "none"
    && !PROVIDERS_WITH_ENVIRONMENT_CREDENTIALS.has(provider.id);
}

function providerSubtitle(provider: CustomProvider): string {
  if (isCopilotProvider(provider)) return "Copilot subscription via GitHub";
  if (isCodexProvider(provider)) return "Codex plan via OpenAI sign-in";
  if (isClaudeCodeProvider(provider)) return "Claude Code via Anthropic sign-in";
  return provider.baseUrl || "Built-in API endpoint";
}

function managedProviderVendor(provider: CustomProvider): string {
  if (isCodexProvider(provider)) return "OpenAI";
  if (isClaudeCodeProvider(provider)) return "Anthropic";
  return "GitHub";
}

function managedAccountLabel(
  provider: CustomProvider,
  status: ManagedStatus,
): string {
  if (isCopilotProvider(provider) && "login" in status && status.login) {
    return ` as ${status.login}`;
  }
  if ("email" in status && status.email) return ` as ${status.email}`;
  return "";
}

function managedStatusMessage(
  provider: CustomProvider,
  status: ManagedStatus,
): string {
  if (status.message) return status.message;

  const vendor = managedProviderVendor(provider);
  if (status.authenticated) return `Signed in${managedAccountLabel(provider, status)}.`;
  if (status.state === "connecting") return `Waiting for ${vendor} authorization to complete.`;
  return `Sign in with ${vendor} to activate this integration.`;
}

function statusDotClassName(status: ManagedStatus): string {
  if (status.authenticated) return "bg-[var(--color-status-success)]";
  if (status.state === "connecting") return "bg-[var(--color-status-warning)] animate-pulse";
  if (status.state === "failed") return "bg-[var(--color-status-danger)]";
  return "bg-[var(--text-muted)]";
}

function selectFirstSupportedModel(provider: CustomProvider): string | undefined {
  const model = provider.models.find((candidate) => candidate.supported !== false);
  return model ? providerModelVariants(model)[0].id : undefined;
}

export function ProviderList({
  providers,
  activeProviderId,
  connectionStatuses,
  copilotStatus,
  codexStatus,
  claudeCodeStatus,
  onSelectProvider,
}: ProviderListProps) {
  const statuses = { copilotStatus, codexStatus, claudeCodeStatus };

  return (
    <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl p-4 space-y-3">
      <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">
        Integrations
      </h3>
      <div className="space-y-2">
        {providers.map((provider) => {
          const managedStatus = managedStatusForProvider(provider, statuses);
          const badge = providerBadge(
            provider,
            connectionStatuses[provider.id],
            managedStatus,
          );
          const isActive = provider.id === activeProviderId;
          const isGitHubProvider = provider.id === "github-models"
            || isCopilotProvider(provider);

          return (
            <button
              key={provider.id}
              type="button"
              onClick={() => onSelectProvider(provider)}
              className={`group flex w-full items-center justify-between rounded-xl border p-3 text-left transition-all ${
                isActive
                  ? "border-[var(--accent-color)] bg-[var(--accent-bg)]/20 shadow-[0_0_10px_var(--color-focus-ring)]"
                  : "border-[var(--border-color)] bg-[var(--bg-app)]/50 hover:bg-[var(--bg-sidebar)] hover:border-[var(--border-active)]"
              }`}
            >
              <div className="flex min-w-0 flex-col pr-2">
                <span className="flex items-center space-x-1.5 text-xs font-bold text-[var(--text-light)] transition-colors group-hover:text-[var(--accent-color)]">
                  {isGitHubProvider && (
                    <GitBranch
                      size={11}
                      className="flex-shrink-0 text-[var(--text-muted)]"
                    />
                  )}
                  <span>{provider.name}</span>
                </span>
                <span className="mt-0.5 max-w-[180px] truncate font-mono text-[10px] text-[var(--text-muted)]">
                  {providerSubtitle(provider)}
                </span>
              </div>
              <div className="flex flex-shrink-0 items-center space-x-2">
                <div className="group/status relative">
                  <span className={`cursor-default rounded-full px-1.5 py-0.5 text-[8px] font-bold ${badge.colorClassName}`}>
                    {badge.label}
                  </span>
                  {managedStatus && (
                    <div className="pointer-events-none absolute right-0 top-full z-20 mt-2 w-56 rounded-lg border border-[var(--border-color)] bg-[var(--bg-sidebar)] p-2.5 text-left opacity-0 shadow-xl transition-opacity duration-150 group-hover/status:opacity-100">
                      <div className="flex items-center gap-1.5 font-mono text-[9px] font-bold text-[var(--text-light)]">
                        <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${statusDotClassName(managedStatus)}`} />
                        <span>{badge.label}</span>
                      </div>
                      <p className="mt-1.5 font-mono text-[9px] leading-relaxed text-[var(--text-muted)]">
                        {managedStatusMessage(provider, managedStatus)}
                      </p>
                    </div>
                  )}
                </div>
                {isActive && (
                  <div className="h-1.5 w-1.5 rounded-full bg-[var(--accent-color)] animate-pulse" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { selectFirstSupportedModel };
