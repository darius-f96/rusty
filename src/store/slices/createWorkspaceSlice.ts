import { createEmptyCanvasContext } from "../canvasHelpers";
import type { WorkspaceSliceCreator } from "../sliceTypes";

export const createWorkspaceSlice: WorkspaceSliceCreator = (set, get) => ({
  rootPath: "",
  fileTree: [],
  expandedPaths: {},
  revealPath: null,

  setRootPath: (path) => {
    if (path) {
      try {
        const stored = localStorage.getItem("previous_workspaces");
        const list: string[] = stored ? JSON.parse(stored) : [];
        const filtered = list.filter((previousPath) => previousPath !== path);
        filtered.unshift(path);
        if (filtered.length > 10) filtered.pop();
        localStorage.setItem("previous_workspaces", JSON.stringify(filtered));
      } catch (error) {
        console.error("Failed to update previous workspaces history:", error);
      }
    }

    set({
      rootPath: path,
      editorGroups: [{
        id: "group_0",
        openTabs: [{ id: "canvas", type: "canvas", title: "Axiom", key: "canvas" }],
        activeTabId: "canvas",
      }],
      activeGroupId: "group_0",
      groupSizes: [1],
      canvasContexts: { canvas: createEmptyCanvasContext() },
      canvasHistories: { canvas: { past: [], future: [] } },
      expandedPaths: {},
      revealPath: null,
      nodes: [],
      edges: [],
      selectedNodeId: null,
      nodeLogs: {},
      nodeStatus: {},
    });
    void get().loadGitStatus();
    void get().loadSkills();
    setTimeout(() => void get().saveSecureConfig(), 0);
  },

  setFileTree: (tree) => set({ fileTree: tree }),

  resetForBranchChange: () => set((state) => {
    const canvasTab = state.editorGroups
      .flatMap((group) => group.openTabs)
      .find((tab) => tab.type === "canvas" || tab.type === "axiom") || {
        id: "canvas",
        type: "canvas" as const,
        title: "Axiom",
        key: "canvas",
      };
    return {
      fileTree: [],
      expandedPaths: {},
      revealPath: null,
      selectedNodeId: null,
      editorGroups: [{ id: "group_0", openTabs: [canvasTab], activeTabId: canvasTab.id }],
      activeGroupId: "group_0",
      groupSizes: [1],
    };
  }),

  setPathExpanded: (path, expanded) => set((state) => ({
    expandedPaths: { ...state.expandedPaths, [path]: expanded },
  })),

  togglePathExpanded: (path) => set((state) => ({
    expandedPaths: { ...state.expandedPaths, [path]: !state.expandedPaths[path] },
  })),

  collapseAllFolders: () => set({
    expandedPaths: {},
    collapseAllTrigger: Date.now(),
  }),

  revealFileInTree: (filePath) => set((state) => {
    const parts = filePath.split("/");
    const expandedPaths = { ...state.expandedPaths };
    let currentPath = "";
    for (let index = 0; index < parts.length - 1; index++) {
      currentPath += (index > 0 ? "/" : "") + parts[index];
      expandedPaths[currentPath] = true;
    }
    setTimeout(() => window.dispatchEvent(new CustomEvent("reveal-file-in-tree")), 0);
    return { expandedPaths, revealPath: filePath };
  }),

  clearRevealPath: () => set({ revealPath: null }),
});
