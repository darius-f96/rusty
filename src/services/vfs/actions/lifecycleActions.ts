/**
 * Lifecycle Actions — thin stateless wrappers around Tauri VFS lifecycle commands.
 *
 * These handle flushing VFS contents to the physical disk and managing
 * the global "currently executing node" state.
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * Flush all in-memory VFS files for a tab to the physical disk.
 * Each cached file is written to its path on disk, creating parent
 * directories as needed. After flushing, the VFS cache for that tab is cleared.
 *
 * @param tabId - The canvas tab whose VFS should be flushed
 */
export async function flushToDisk(tabId: string): Promise<void> {
  await invoke("apply_vfs_to_disk", { tabId });
}

/**
 * Set which node is currently executing.
 * This is a global (non-tab-scoped) state used by the Rust backend
 * to route file operations to the correct node tracker.
 *
 * @param nodeId - The node ID to mark as executing, or null to clear
 */
export async function setExecutingNode(nodeId: string | null): Promise<void> {
  await invoke("set_current_executing_node", { nodeId });
}
