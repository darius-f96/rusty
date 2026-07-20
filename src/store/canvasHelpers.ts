import type { CanvasContext, CanvasHistory, CanvasHistorySnapshot, WorkspaceState } from "./types";

const RECONCILIATION_STREAM_PREFIX = "__reconciliation__:";
export const MAX_CANVAS_HISTORY = 50;

export const createEmptyCanvasContext = (): CanvasContext => ({
  nodes: [],
  edges: [],
  nodeLogs: {},
  nodeStatus: {},
  globalChatHistory: {},
  edgeReconciliationStatus: {},
  isPipelineApplied: false,
});

export function getActiveCanvasTabId(state: WorkspaceState): string {
  const activeGroup = state.editorGroups.find((group) => group.id === state.activeGroupId);
  if (activeGroup?.activeTabId) {
    const activeTab = activeGroup.openTabs.find((tab) => tab.id === activeGroup.activeTabId);
    if (activeTab?.type === "canvas") return activeTab.id;
  }
  for (const group of state.editorGroups) {
    const canvasTab = group.openTabs.find((tab) => tab.type === "canvas");
    if (canvasTab) return canvasTab.id;
  }
  return "canvas";
}

export function getOrCreateContext(state: WorkspaceState, tabId: string): CanvasContext {
  if (!state.canvasContexts) state.canvasContexts = {};
  if (!state.canvasContexts[tabId]) {
    state.canvasContexts[tabId] = createEmptyCanvasContext();
  }
  return state.canvasContexts[tabId];
}

export const canvasHasGlobalChatNode = (state: WorkspaceState, tabId: string): boolean =>
  state.canvasContexts[tabId]?.nodes.some((node) => node.type === "globalChatNode") ?? false;

export function findTabIdByNodeId(state: WorkspaceState, nodeId: string): string {
  if (nodeId.startsWith(RECONCILIATION_STREAM_PREFIX)) {
    const tabId = nodeId.slice(RECONCILIATION_STREAM_PREFIX.length);
    if (state.canvasContexts?.[tabId]) return tabId;
  }
  for (const [tabId, context] of Object.entries(state.canvasContexts || {})) {
    if (context.nodes?.some((node) => node.id === nodeId)) return tabId;
  }
  return getActiveCanvasTabId(state);
}

export function findTabIdByEdgeId(state: WorkspaceState, edgeId: string): string {
  for (const [tabId, context] of Object.entries(state.canvasContexts || {})) {
    if (context.edges?.some((edge) => edge.id === edgeId)) return tabId;
  }
  return getActiveCanvasTabId(state);
}

function pushHistoryToState(
  state: WorkspaceState,
  tabId: string,
  snapshot: CanvasHistorySnapshot,
): Record<string, CanvasHistory> {
  const existing = state.canvasHistories?.[tabId] || { past: [], future: [] };
  const past = [...existing.past, snapshot];
  if (past.length > MAX_CANVAS_HISTORY) past.shift();
  return { ...state.canvasHistories, [tabId]: { past, future: [] } };
}

export function updateContextAndSync(
  state: WorkspaceState,
  tabId: string,
  updater: (context: CanvasContext) => Partial<CanvasContext>,
  trackHistory = false,
): Partial<WorkspaceState> {
  const context = getOrCreateContext(state, tabId);
  const updates = updater(context);
  const shouldResetApplied = ("nodes" in updates || "edges" in updates)
    && !("isPipelineApplied" in updates);
  const canvasContexts = {
    ...state.canvasContexts,
    [tabId]: {
      ...context,
      ...updates,
      ...(shouldResetApplied ? { isPipelineApplied: false } : {}),
    },
  };
  const activeContext = canvasContexts[getActiveCanvasTabId({ ...state, canvasContexts })]
    || createEmptyCanvasContext();

  return {
    canvasContexts,
    canvasHistories: trackHistory
      ? pushHistoryToState(state, tabId, { nodes: context.nodes, edges: context.edges })
      : state.canvasHistories,
    nodes: activeContext.nodes,
    edges: activeContext.edges,
    nodeLogs: activeContext.nodeLogs,
    nodeStatus: activeContext.nodeStatus,
    globalChatHistory: activeContext.globalChatHistory,
    edgeReconciliationStatus: activeContext.edgeReconciliationStatus,
  };
}

export function syncActiveCanvasAliases(state: WorkspaceState): Partial<WorkspaceState> {
  const context = getOrCreateContext(state, getActiveCanvasTabId(state));
  return {
    nodes: context.nodes,
    edges: context.edges,
    nodeLogs: context.nodeLogs,
    nodeStatus: context.nodeStatus,
    globalChatHistory: context.globalChatHistory,
    edgeReconciliationStatus: context.edgeReconciliationStatus,
  };
}
