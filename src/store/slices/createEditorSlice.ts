import { syncActiveCanvasAliases } from "../canvasHelpers";
import type { WorkspaceSliceCreator } from "../sliceTypes";
import type { WorkspaceState } from "../types";

function withActiveCanvas(
  state: WorkspaceState,
  updates: Partial<WorkspaceState>,
): Partial<WorkspaceState> {
  const nextState = { ...state, ...updates } as WorkspaceState;
  return { ...updates, ...syncActiveCanvasAliases(nextState) };
}

export const createEditorSlice: WorkspaceSliceCreator = (set) => ({
  editorGroups: [{
    id: "group_0",
    openTabs: [
      { id: "welcome", type: "onboarding", title: "Welcome to Rusty", key: "onboarding" },
      { id: "workspace_select", type: "workspace", title: "Workspaces", key: "workspace" },
    ],
    activeTabId: "welcome",
  }],
  activeGroupId: "group_0",
  groupSizes: [1],

  openTab: (tab, groupId) => set((state) => {
    const targetGroupId = groupId || state.activeGroupId;
    const isSingleton = ["llm-setup", "mcp-integration", "settings", "skills", "workspace", "onboarding"].includes(tab.type);
    const isRustyTab = tab.type === "canvas" || tab.type === "rusty";

    for (const group of state.editorGroups) {
      const existingTab = group.openTabs.find((candidate) => {
        if (isSingleton && candidate.type === tab.type) return true;
        return isRustyTab
          && (candidate.type === "canvas" || candidate.type === "rusty")
          && candidate.key === tab.key;
      });
      if (existingTab) {
        const editorGroups = state.editorGroups.map((candidate) => candidate.id === group.id
          ? { ...candidate, activeTabId: existingTab.id }
          : candidate);
        return withActiveCanvas(state, { editorGroups, activeGroupId: group.id });
      }
    }

    const groupExists = state.editorGroups.some((group) => group.id === targetGroupId);
    let editorGroups = state.editorGroups.map((group) => {
      if (group.id !== targetGroupId) return group;
      const hasTab = group.openTabs.some((candidate) => candidate.id === tab.id);
      const updatedTabs = group.openTabs.map((candidate) =>
        candidate.id === tab.id ? { ...candidate, ...tab } : candidate,
      );
      return {
        ...group,
        openTabs: hasTab ? updatedTabs : [...group.openTabs, tab],
        activeTabId: tab.id,
      };
    });

    if (!groupExists || editorGroups.length === 0) {
      const newGroup = {
        id: targetGroupId || `group_${Date.now()}`,
        openTabs: [tab],
        activeTabId: tab.id,
      };
      editorGroups = [newGroup];
      return withActiveCanvas(state, {
        editorGroups,
        activeGroupId: newGroup.id,
        groupSizes: [1],
      });
    }

    return withActiveCanvas(state, { editorGroups, activeGroupId: targetGroupId });
  }),

  closeTab: (id, groupId) => set((state) => {
    const targetGroup = state.editorGroups.find((group) =>
      groupId ? group.id === groupId : group.openTabs.some((tab) => tab.id === id),
    );
    if (!targetGroup) return {};
    if (id === "workspace_select" && state.editorGroups.length === 1 && targetGroup.openTabs.length === 1) {
      return {};
    }

    const groupIndex = state.editorGroups.indexOf(targetGroup);
    const remainingTabs = targetGroup.openTabs.filter((tab) => tab.id !== id);
    let updates: Partial<WorkspaceState>;

    if (remainingTabs.length > 0) {
      const activeTabId = targetGroup.activeTabId === id
        ? remainingTabs[remainingTabs.length - 1].id
        : targetGroup.activeTabId;
      updates = {
        editorGroups: state.editorGroups.map((group) => group.id === targetGroup.id
          ? { ...group, openTabs: remainingTabs, activeTabId }
          : group),
      };
    } else if (state.editorGroups.length === 1) {
      const fallbackGroup = {
        id: targetGroup.id,
        openTabs: [{ id: "welcome", type: "onboarding" as const, title: "Welcome to Rusty", key: "onboarding" }],
        activeTabId: "welcome",
      };
      updates = { editorGroups: [fallbackGroup], activeGroupId: fallbackGroup.id, groupSizes: [1] };
    } else {
      const editorGroups = state.editorGroups.filter((group) => group.id !== targetGroup.id);
      const groupSizes = [...state.groupSizes];
      const oldSize = groupSizes[groupIndex];
      groupSizes.splice(groupIndex, 1);
      const neighborIndex = groupIndex > 0 ? groupIndex - 1 : 0;
      groupSizes[neighborIndex] = (groupSizes[neighborIndex] || 0) + oldSize;
      const activeGroupId = state.activeGroupId === targetGroup.id
        ? editorGroups[neighborIndex].id
        : state.activeGroupId;
      updates = { editorGroups, groupSizes, activeGroupId };
    }

    return withActiveCanvas(state, updates);
  }),

  setActiveTabId: (id, groupId) => set((state) => {
    const targetGroupId = groupId || state.activeGroupId;
    const editorGroups = state.editorGroups.map((group) => group.id === targetGroupId
      ? { ...group, activeTabId: id }
      : group);
    return withActiveCanvas(state, { editorGroups, activeGroupId: targetGroupId });
  }),

  splitTab: (id, fromGroupId) => set((state) => {
    const fromGroupIndex = state.editorGroups.findIndex((group) => group.id === fromGroupId);
    if (fromGroupIndex === -1) return {};
    const tabToSplit = state.editorGroups[fromGroupIndex].openTabs.find((tab) => tab.id === id);
    if (!tabToSplit) return {};

    const newGroupId = `group_${Date.now()}`;
    const editorGroups = [...state.editorGroups];
    editorGroups.splice(fromGroupIndex + 1, 0, {
      id: newGroupId,
      openTabs: [tabToSplit],
      activeTabId: tabToSplit.id,
    });
    const groupSizes = [...state.groupSizes];
    const oldSize = groupSizes[fromGroupIndex];
    groupSizes[fromGroupIndex] = oldSize / 2;
    groupSizes.splice(fromGroupIndex + 1, 0, oldSize / 2);
    return withActiveCanvas(state, { editorGroups, groupSizes, activeGroupId: newGroupId });
  }),

  moveTab: (id, fromGroupId, toGroupId) => set((state) => {
    if (fromGroupId === toGroupId) return {};
    const fromGroupIndex = state.editorGroups.findIndex((group) => group.id === fromGroupId);
    const toGroupIndex = state.editorGroups.findIndex((group) => group.id === toGroupId);
    if (fromGroupIndex === -1 || toGroupIndex === -1) return {};

    const fromGroup = state.editorGroups[fromGroupIndex];
    const tabToMove = fromGroup.openTabs.find((tab) => tab.id === id);
    if (!tabToMove) return {};

    const remainingTabs = fromGroup.openTabs.filter((tab) => tab.id !== id);
    let editorGroups = [...state.editorGroups];
    const groupSizes = [...state.groupSizes];
    let activeGroupId = state.activeGroupId;

    if (remainingTabs.length > 0) {
      editorGroups[fromGroupIndex] = {
        ...fromGroup,
        openTabs: remainingTabs,
        activeTabId: fromGroup.activeTabId === id
          ? remainingTabs[remainingTabs.length - 1].id
          : fromGroup.activeTabId,
      };
    } else if (state.editorGroups.length > 1) {
      editorGroups.splice(fromGroupIndex, 1);
      const oldSize = groupSizes[fromGroupIndex];
      groupSizes.splice(fromGroupIndex, 1);
      const neighborIndex = fromGroupIndex > 0 ? fromGroupIndex - 1 : 0;
      groupSizes[neighborIndex] = (groupSizes[neighborIndex] || 0) + oldSize;
      if (state.activeGroupId === fromGroupId) activeGroupId = editorGroups[neighborIndex].id;
    }

    const destinationIndex = editorGroups.findIndex((group) => group.id === toGroupId);
    if (destinationIndex !== -1) {
      const destination = editorGroups[destinationIndex];
      const openTabs = destination.openTabs.some((tab) => tab.id === id)
        ? destination.openTabs
        : [...destination.openTabs, tabToMove];
      editorGroups[destinationIndex] = { ...destination, openTabs, activeTabId: id };
      activeGroupId = toGroupId;
    }

    return withActiveCanvas(state, { editorGroups, groupSizes, activeGroupId });
  }),

  setGroupSizes: (groupSizes) => set({ groupSizes }),
  setActiveGroupId: (activeGroupId) => set({ activeGroupId }),

  updateTabTitle: (tabId, title) => set((state) => ({
    editorGroups: state.editorGroups.map((group) => ({
      ...group,
      openTabs: group.openTabs.map((tab) => tab.id === tabId ? { ...tab, title } : tab),
    })),
  })),
});
