import { invoke } from "@tauri-apps/api/core";

export interface NodeFilesResponse {
  node_id: string;
  files: string[];
}

export interface VfsService {
  setCurrentExecutingNode(nodeId: string | null): Promise<void>;
  deleteNodeVfsFiles(nodeId: string): Promise<void>;
  getAllNodeVfsFiles(): Promise<NodeFilesResponse[]>;
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
};