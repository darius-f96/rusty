import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../../../../store";

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

    const payload = {
      id: tabId,
      title,
      nodes: context.nodes,
      edges: context.edges,
      nodeLogs: context.nodeLogs,
      nodeStatus: context.nodeStatus,
      globalChatHistory: context.globalChatHistory,
      edgeReconciliationStatus: context.edgeReconciliationStatus,
      isPipelineApplied: context.isPipelineApplied || false
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
  }
};
