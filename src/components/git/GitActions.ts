export interface GitFileStatus {
  path: string;
  name: string;
  status_type: "modified" | "added" | "deleted" | "untracked" | "renamed";
}

/**
 * Git Actions Interface
 * 
 * Formalizes all capabilities of the independent Git integration.
 * Enables clean extensibility for multiple repos or subprojects.
 */
export interface GitActions {
  commit: (rootDir: string, message: string) => Promise<void>;
  push: (rootDir: string, branchName: string) => Promise<void>;
  pull: (rootDir: string) => Promise<void>;
  stageFile: (rootDir: string, filePath: string) => Promise<void>;
  unstageFile: (rootDir: string, filePath: string) => Promise<void>;
  addToGitignore: (rootDir: string, filePath: string) => Promise<void>;
  discardChanges: (
    rootDir: string,
    filePath: string,
    fileName: string,
    confirmFn: (title: string, msg: string) => Promise<boolean>
  ) => Promise<void>;
  discardAllChanges: (
    rootDir: string,
    confirmFn: (title: string, msg: string) => Promise<boolean>
  ) => Promise<void>;
  switchBranch: (rootDir: string, branchName: string) => Promise<void>;
  createBranch: (rootDir: string, branchName: string, checkout: boolean) => Promise<void>;
  deleteBranch: (rootDir: string, branchName: string, force: boolean) => Promise<void>;
  mergeBranch: (rootDir: string, branchName: string) => Promise<void>;
  rebaseBranch: (rootDir: string, branchName: string) => Promise<void>;
  abortPending: (rootDir: string) => Promise<void>;
  undoLastRename: (rootDir: string, originalPath: string, newPath: string) => Promise<void>;
  scanSubprojects: (rootDir: string) => Promise<string[]>; // Returns list of subproject git root dirs
}
