import { VfsRegistry } from "./vfs";

export const RECONCILIATION_OVERLAY_CHANGED_EVENT = "axiom-reconciliation-overlay-changed";

interface ReconciliationOverlaySession {
  changedPaths: Set<string>;
  wasPipelineApplied: boolean;
}

const sessions = new Map<string, ReconciliationOverlaySession>();

const emitChanged = (tabId: string) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(RECONCILIATION_OVERLAY_CHANGED_EVENT, {
    detail: { tabId, changedPaths: reconciliationOverlayService.getChangedPaths(tabId) },
  }));
};

const clearOverlayContents = async (tabId: string) => {
  const overlay = VfsRegistry.getOrCreate(reconciliationOverlayService.getOverlayTabId(tabId));
  await overlay.deleteAllFiles();
  const snapshot = await overlay.snapshot();
  for (const filePath of Object.keys(snapshot.contents)) {
    await overlay.removeFile(filePath);
  }
};

export const reconciliationOverlayService = {
  getOverlayTabId: (tabId: string) => `__reconciliation_overlay__:${tabId}`,

  getReconciliationNodeId: (tabId: string) => `__reconciliation_node__:${tabId}`,

  hasSession: (tabId: string) => sessions.has(tabId),

  getChangedPaths: (tabId: string): string[] => Array.from(sessions.get(tabId)?.changedPaths || []),

  wasPipelineApplied: (tabId: string): boolean => sessions.get(tabId)?.wasPipelineApplied || false,

  /** Start an isolated overlay seeded with the current task VFS contents. */
  ensureSession: async (tabId: string, wasPipelineApplied = false): Promise<void> => {
    if (sessions.has(tabId)) return;

    const baseSnapshot = await VfsRegistry.getOrCreate(tabId).snapshot();
    await clearOverlayContents(tabId);
    await VfsRegistry.getOrCreate(reconciliationOverlayService.getOverlayTabId(tabId)).restore({
      contents: baseSnapshot.contents,
      tracker: {},
    });
    sessions.set(tabId, { changedPaths: new Set<string>(), wasPipelineApplied });
    emitChanged(tabId);
  },

  markChanged: (tabId: string, filePath: string): void => {
    const session = sessions.get(tabId);
    if (!session) throw new Error("No active reconciliation overlay session");
    session.changedPaths.add(filePath);
    emitChanged(tabId);
  },

  /** Discard reconciled versions while leaving every task-owned VFS file untouched. */
  discard: async (tabId: string): Promise<void> => {
    await clearOverlayContents(tabId);
    sessions.delete(tabId);
    emitChanged(tabId);
  },

  /** Promote only reconciled files into the main VFS immediately before Apply Axiom flushes it. */
  stageIntoMainVfs: async (tabId: string): Promise<string[]> => {
    const changedPaths = reconciliationOverlayService.getChangedPaths(tabId);
    if (changedPaths.length === 0) return [];

    const overlay = VfsRegistry.getOrCreate(reconciliationOverlayService.getOverlayTabId(tabId));
    const mainVfs = VfsRegistry.getOrCreate(tabId);
    for (const filePath of changedPaths) {
      const content = await overlay.readFile(filePath);
      await mainVfs.writeFile(filePath, content);
    }
    return changedPaths;
  },
};
