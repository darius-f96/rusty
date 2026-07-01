import { invoke } from "@tauri-apps/api/core";

export interface NodeFilesResponse {
  node_id: string;
  files: string[];
}

export interface VfsService {
  setCurrentExecutingNode(nodeId: string | null): Promise<void>;
  deleteNodeVfsFiles(nodeId: string): Promise<void>;
  getAllNodeVfsFiles(): Promise<NodeFilesResponse[]>;
  exportVfsContents(): Promise<Record<string, string>>;
  importVfsContents(files: Record<string, string>): Promise<void>;
  exportVfsTracker(): Promise<Record<string, string[]>>;
  importVfsTracker(tracker: Record<string, string[]>): Promise<void>;
}

export const vfsService: VfsService = {
  async setCurrentExecutingNode(nodeId: string | null): Promise<void> {
    try {
      await invoke("set_current_executing_node", { nodeId });
    } catch (err) {
      console.error(`[vfsService] set_current_executing_node failed:`, err);
      throw err;
    }
  },

  async deleteNodeVfsFiles(nodeId: string): Promise<void> {
    try {
      await invoke("delete_node_vfs_files", { nodeId });
      console.log(`[vfsService] Deleted all VFS files for node: ${nodeId}`);
    } catch (err) {
      console.error(`[vfsService] delete_node_vfs_files failed:`, err);
      throw err;
    }
  },

  async getAllNodeVfsFiles(): Promise<NodeFilesResponse[]> {
    try {
      const result = await invoke<NodeFilesResponse[]>("get_all_node_vfs_files");
      console.log(`[vfsService] get_all_node_vfs_files returned ${result.length} nodes`);
      return result;
    } catch (err) {
      console.error(`[vfsService] get_all_node_vfs_files failed:`, err);
      throw err;
    }
  },

  async exportVfsContents(): Promise<Record<string, string>> {
    try {
      const result = await invoke<Record<string, string>>("export_vfs_contents");
      console.log(`[vfsService] export_vfs_contents returned ${Object.keys(result).length} files`);
      return result;
    } catch (err) {
      console.error(`[vfsService] export_vfs_contents failed:`, err);
      throw err;
    }
  },

  async importVfsContents(files: Record<string, string>): Promise<void> {
    try {
      await invoke("import_vfs_contents", { files });
      console.log(`[vfsService] import_vfs_contents imported ${Object.keys(files).length} files`);
    } catch (err) {
      console.error(`[vfsService] import_vfs_contents failed:`, err);
      throw err;
    }
  },

  async exportVfsTracker(): Promise<Record<string, string[]>> {
    try {
      const result = await invoke<Record<string, string[]>>("export_vfs_tracker");
      console.log(`[vfsService] export_vfs_tracker returned tracking for ${Object.keys(result).length} nodes`);
      return result;
    } catch (err) {
      console.error(`[vfsService] export_vfs_tracker failed:`, err);
      throw err;
    }
  },

  async importVfsTracker(tracker: Record<string, string[]>): Promise<void> {
    try {
      await invoke("import_vfs_tracker", { tracker });
      console.log(`[vfsService] import_vfs_tracker imported tracking for ${Object.keys(tracker).length} nodes`);
    } catch (err) {
      console.error(`[vfsService] import_vfs_tracker failed:`, err);
      throw err;
    }
  },
};