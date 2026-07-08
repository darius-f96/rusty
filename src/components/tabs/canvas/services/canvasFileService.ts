import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../../../../store";
import { persistenceOrchestrator } from "../../../../services/vfs";

export const canvasFileService = {
  getCanvasDir: (rootPath: string) => {
    return `${rootPath}/.axiom/canvas`;
  },

  getCanvasFilePath: (rootPath: string, sanitizedTitle: string) => {
    return `${canvasFileService.getCanvasDir(rootPath)}/${sanitizedTitle}.json`;
  },

  sanitizeFileName: (title: string) => {
    return title.replace(/[^a-zA-Z0-9_\-]/g, "_").toLowerCase();
  },

  saveCanvas: async (tabId: string, title: string): Promise<string> => {
    const state = useWorkspaceStore.getState();
    const rootPath = state.rootPath;
    if (!rootPath) throw new Error("No active workspace directory loaded");

    const context = state.canvasContexts[tabId] || {
      nodes: [],
      edges: [],
      nodeLogs: {},
      nodeStatus: {},
      globalChatHistory: {},
      edgeReconciliationStatus: {},
      isPipelineApplied: false
    };

    // Export VFS contents and the node -> file tracker to include in the canvas.
    const nodeIds = new Set(context.nodes.map((n: any) => n.id));
    let vfsSnapshot = { contents: {}, tracker: {} };
    try {
      vfsSnapshot = await persistenceOrchestrator.captureVfsForSave(tabId, nodeIds);
    } catch (err) {
      console.warn("[canvasFileService] Could not export VFS state for save:", err);
    }
 
    const payload = {
      id: tabId,
      title,
      nodes: context.nodes,
      edges: context.edges,
      nodeLogs: context.nodeLogs,
      nodeStatus: context.nodeStatus,
      globalChatHistory: context.globalChatHistory,
      edgeReconciliationStatus: context.edgeReconciliationStatus,
      isPipelineApplied: context.isPipelineApplied || false,
      vfsContents: vfsSnapshot.contents,
      vfsTracker: vfsSnapshot.tracker
    };
 
    const fileName = canvasFileService.sanitizeFileName(title);
    const filePath = canvasFileService.getCanvasFilePath(rootPath, fileName);
 
    await invoke("write_file_disk", {
      path: filePath,
      content: JSON.stringify(payload, null, 2)
    });
 
    // Refresh file structure in workspace
    const tree: any[] = await invoke("get_directory_structure", { rootDir: rootPath });
    useWorkspaceStore.getState().setFileTree(tree);
 
    return filePath;
  },

  autoSaveCanvas: async (tabId: string): Promise<string | null> => {
    const state = useWorkspaceStore.getState();
    const rootPath = state.rootPath;
    if (!rootPath) return null;

    let title = "Untitled Pipeline";
    for (const group of state.editorGroups) {
      const tab = group.openTabs.find((t) => t.id === tabId);
      if (tab) {
        title = tab.title;
        break;
      }
    }

    try {
      return await canvasFileService.saveCanvas(tabId, title);
    } catch (err) {
      console.error("[canvasFileService] Auto-save failed:", err);
      return null;
    }
  },
 
  loadCanvasFromFile: async (filePath: string): Promise<any> => {
    const rawContent: string = await invoke("read_file_disk", { path: filePath });
    const parsed = JSON.parse(rawContent);
    return parsed;
  },
 
  restoreCanvasVfs: async (
    vfsContents: Record<string, string>,
    vfsTracker: Record<string, string[]>,
    tabId: string
  ): Promise<void> => {
    try {
      await persistenceOrchestrator.restoreVfsFromSave(tabId, {
        contents: vfsContents || {},
        tracker: vfsTracker || {},
      });
    } catch (err) {
      console.error("[canvasFileService] Failed to restore VFS state:", err);
      throw err;
    }
  }
};
