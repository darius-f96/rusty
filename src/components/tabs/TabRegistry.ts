/**
 * Tab Registry & Polymorphic Interface System
 * 
 * Architectural Flow:
 * 
 *        +-----------------------------------------------+
 *        |                 Workspace Shell               |
 *        +------------------------+----------------------+
 *                                 |
 *                 Listens to active tab switches
 *                                 |
 *                                 v
 *        +------------------------+----------------------+
 *        |                  TabRegistry                  |
 *        +--+---------------------+-------------------+--+
 *           |                     |                   |
 *           v                     v                   v
 *      FileTabHooks         AxiomTabHooks       SettingsTabHooks
 *   (onSave, canClose)     (getVfsMemory,     (saveSecureConfig)
 *                          onFocus, onSave)
 */

export interface TabHooks {
  onFocus?: () => void;
  onBlur?: () => void;
  onSave?: () => Promise<void>;
  canClose?: () => boolean | Promise<boolean>;
  getVfsMemory?: () => Record<string, string>;
}

export interface TabTypeConfig {
  type: string;
  label: string;
  allowDuplicates: boolean;
  isSingleton: boolean; // if true, jump to already open tab
}

export const TAB_CONFIGS: Record<string, TabTypeConfig> = {
  canvas: { type: "canvas", label: "Axiom Canvas", allowDuplicates: true, isSingleton: false }, // Mapped for compatibility
  file: { type: "file", label: "File Editor", allowDuplicates: true, isSingleton: false },
  task: { type: "task", label: "Task Auditor", allowDuplicates: true, isSingleton: false },
  settings: { type: "settings", label: "Settings", allowDuplicates: false, isSingleton: true },
  "llm-setup": { type: "llm-setup", label: "LLM Integrations", allowDuplicates: false, isSingleton: true },
  "git-diff": { type: "git-diff", label: "Git Diff", allowDuplicates: true, isSingleton: false },
  "git-history": { type: "git-history", label: "Git Graph", allowDuplicates: true, isSingleton: false },
  workspace: { type: "workspace", label: "Workspaces", allowDuplicates: false, isSingleton: true },
  agent: { type: "agent", label: "Agent Mode", allowDuplicates: true, isSingleton: false }, // different conversations
  skills: { type: "skills", label: "Skills", allowDuplicates: false, isSingleton: true },
  "mcp-integration": { type: "mcp-integration", label: "MCP Integration", allowDuplicates: false, isSingleton: true },
  onboarding: { type: "onboarding", label: "Welcome to Axiom", allowDuplicates: false, isSingleton: true },
  metrics: { type: "metrics", label: "Token Metrics", allowDuplicates: false, isSingleton: true },
};

// Global registry of mounted tab instances' hook callbacks
class TabHookRegistry {
  private registry = new Map<string, TabHooks>();

  public register(tabId: string, hooks: TabHooks) {
    this.registry.set(tabId, hooks);
  }

  public unregister(tabId: string) {
    this.registry.delete(tabId);
  }

  public get(tabId: string): TabHooks | undefined {
    return this.registry.get(tabId);
  }

  public async triggerSave(tabId: string): Promise<void> {
    const hooks = this.registry.get(tabId);
    if (hooks?.onSave) {
      await hooks.onSave();
    }
  }

  public triggerFocus(tabId: string): void {
    const hooks = this.registry.get(tabId);
    if (hooks?.onFocus) {
      hooks.onFocus();
    }
  }

  public triggerBlur(tabId: string): void {
    const hooks = this.registry.get(tabId);
    if (hooks?.onBlur) {
      hooks.onBlur();
    }
  }
}

export const tabHookRegistry = new TabHookRegistry();
