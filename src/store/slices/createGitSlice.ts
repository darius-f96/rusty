import { invoke } from "@tauri-apps/api/core";
import type { GitStatusResult } from "../types";
import type { WorkspaceSliceCreator } from "../sliceTypes";

export const createGitSlice: WorkspaceSliceCreator = (set, get) => ({
  gitStatus: null,
  lastRename: null,

  setGitStatus: (gitStatus) => set({ gitStatus }),
  setLastRename: (lastRename) => set({ lastRename }),

  loadGitStatus: async (rootDir) => {
    const rootPath = rootDir || get().rootPath;
    if (!rootPath) {
      set({ gitStatus: null });
      return;
    }
    try {
      const result: any = await invoke("git_status", { rootDir: rootPath });
      const gitStatus: GitStatusResult = {
        isRepo: result.is_repo,
        currentBranch: result.current_branch,
        staged: (result.staged || []).map((file: any) => ({
          path: file.path,
          name: file.name,
          status_type: file.status_type,
        })),
        unstaged: (result.unstaged || []).map((file: any) => ({
          path: file.path,
          name: file.name,
          status_type: file.status_type,
        })),
      };
      set({ gitStatus });
    } catch (error) {
      console.error("Failed to load git status:", error);
    }
  },
});
