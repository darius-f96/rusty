import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../../../../store";
import { vfsService } from "../../../../services/vfsService";

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

    // Export VFS contents to include in the canvas
    let vfsContents: Record<string, string> = {};
    try {
      vfsContents = await vfsService.exportVfsContents();
    } catch (err) {
      console.warn("[canvasFileService] Could not export VFS contents:", err);
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
      vfsContents
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

  loadCanvasFromFile: async (filePath: string): Promise<any> => {
    const rawContent: string = await invoke("read_file_disk", { path: filePath });
    const parsed = JSON.parse(rawContent);
    return parsed;
  },

  restoreCanvasVfs: async (vfsContents: Record<string, string>): Promise<void> => {
    if (!vfsContents || Object.keys(vfsContents).length === 0) {
      console.log("[canvasFileService] No VFS contents to restore");
      return;
    }
    try {
      await vfsService.importVfsContents(vfsContents);
      console.log(`[canvasFileService] Restored ${Object.keys(vfsContents).length} VFS files`);
    } catch (err) {
      console.error("[canvasFileService] Failed to restore VFS contents:", err);
      throw err;
    }
  }
};
