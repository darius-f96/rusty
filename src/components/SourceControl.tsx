import React, { useState, useEffect } from "react";
import { GitBranch, Plus, Minus, RotateCcw, Check, AlertCircle, ArrowUp, ArrowDown, GitCommit, ChevronDown, GitMerge, GitPullRequest, Trash2 } from "lucide-react";
import { useWorkspaceStore } from "../store";
import { invoke } from "@tauri-apps/api/core";
import { CustomSelect } from "./CustomSelect";
import { BranchDialog } from "./BranchDialog";
import { notify } from "../notificationStore";

export const SourceControl: React.FC = () => {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const gitStatus = useWorkspaceStore((state) => state.gitStatus);
  const loadGitStatus = useWorkspaceStore((state) => state.loadGitStatus);
  const openTab = useWorkspaceStore((state) => state.openTab);

  const handleOpenGraph = () => {
    openTab({
      id: "git-history",
      type: "git-history",
      title: "Git Graph",
      key: "git-history",
    });
  };

  const [commitMsg, setCommitMsg] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [initLoading, setInitLoading] = useState(false);
  const [localBranches, setLocalBranches] = useState<string[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(true);
  const [historyCommits, setHistoryCommits] = useState<any[]>([]);
  const [branchDialog, setBranchDialog] = useState<"create" | "merge" | "rebase" | "delete" | null>(null);
  const lastRename = useWorkspaceStore((state) => state.lastRename);
  const setLastRename = useWorkspaceStore((state) => state.setLastRename);

  // Fetch recent commits for the sidebar
  const fetchHistory = async () => {
    if (rootPath) {
      try {
        const history: any[] = await invoke("git_get_commit_history", { rootDir: rootPath });
        setHistoryCommits(history.slice(0, 15)); // Show last 15 commits
      } catch (err) {
        console.error("Failed to load history commits in sidebar:", err);
      }
    }
  };

  // Load local + remote branches. Best-effort fetch/prune first so the origin
  // branch list stays in sync (e.g. remote branches that were deleted are pruned).
  const fetchBranches = async () => {
    if (rootPath) {
      try {
        try {
          await invoke("git_fetch", { rootDir: rootPath });
        } catch (err) {
          console.warn("git_fetch skipped (no remote or offline):", err);
        }
        const res: { local: string[]; remote: string[] } = await invoke("git_get_all_branches", { rootDir: rootPath });
        setLocalBranches(res.local || []);
        setRemoteBranches(res.remote || []);
      } catch (err) {
        console.error("Failed to load branches:", err);
      }
    }
  };

  // Load Git status, branches, and history on mount or directory change
  useEffect(() => {
    if (rootPath) {
      loadGitStatus();
      fetchBranches();
      fetchHistory();
    }
  }, [rootPath]);

  // If no folder is open, guide the user
  if (!rootPath) {
    return (
      <div className="flex flex-col items-center justify-center p-6 h-full text-center text-[var(--text-muted)] font-mono text-xs select-none">
        <AlertCircle size={20} className="text-amber-500 mb-2" />
        <span>Open a folder first to view Source Control</span>
      </div>
    );
  }

  // Handle git initialization for non-git workspaces
  const handleInitializeRepo = async () => {
    setInitLoading(true);
    try {
      console.log(`Git: Initializing repository at ${rootPath}`);
      await invoke("git_init", { rootDir: rootPath });
      await loadGitStatus();
      await fetchBranches();
      await fetchHistory();
    } catch (err: any) {
      console.error("Failed to initialize git repository:", err);
      notify("Error", `Error initializing Git: ${err}`, "error");
    } finally {
      setInitLoading(false);
    }
  };

  // If folder is open but not a git repo, prompt to initialize
  if (gitStatus && !gitStatus.isRepo) {
    return (
      <div className="flex flex-col items-center justify-center p-6 h-full text-center space-y-4 select-none">
        <div className="flex flex-col items-center text-[var(--text-muted)] font-mono text-xs space-y-2">
          <GitBranch size={24} className="text-[var(--text-muted)] animate-pulse" />
          <span className="font-semibold text-[var(--text-normal)]">No Git Repository Found</span>
          <span className="text-[10px] max-w-[200px] leading-relaxed">
            Initialize git source control to track modifications and commit code changes.
          </span>
        </div>
        <button
          onClick={handleInitializeRepo}
          disabled={initLoading}
          className="w-full bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/85 disabled:bg-[var(--border-color)] text-white text-xs font-mono font-bold py-2 rounded-lg transition-all shadow-md cursor-pointer flex items-center justify-center"
        >
          {initLoading ? "Initializing..." : "Initialize Repository"}
        </button>
      </div>
    );
  }

  // Commit changes function
  const handleCommit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!commitMsg.trim() || isCommitting || !gitStatus) return;

    if (gitStatus.staged.length === 0) {
      notify("Nothing to commit", "Please stage your changes before committing.", "info");
      return;
    }

    setIsCommitting(true);
    try {
      console.log(`Git: Committing staged files with message: "${commitMsg}"`);
      await invoke("git_commit", { rootDir: rootPath, message: commitMsg });
      setCommitMsg("");
      await loadGitStatus();
      await fetchHistory();
    } catch (err: any) {
      console.error("Failed to commit git changes:", err);
      notify("Commit failed", `Commit failed: ${err}`, "error");
    } finally {
      setIsCommitting(false);
    }
  };

  // Pull changes from remote upstream
  const handlePull = async () => {
    if (!rootPath || isPulling) return;
    setIsPulling(true);
    try {
      console.log("Git: Pulling remote modifications...");
      await invoke("git_pull", { rootDir: rootPath });
      await loadGitStatus();
      await fetchHistory();
      // Reload file structure as files might have changed on disk
      const tree: any[] = await invoke("get_directory_structure", { rootDir: rootPath });
      useWorkspaceStore.getState().setFileTree(tree);
      notify("Pull complete", "Successfully pulled changes from remote.", "success");
    } catch (err: any) {
      console.error("Pull failed:", err);
      notify("Pull failed", `Pull failed: ${err}`, "error");
    } finally {
      setIsPulling(false);
    }
  };

  // Push changes to remote upstream
  const handlePush = async () => {
    if (!rootPath || !gitStatus || isPushing) return;
    setIsPushing(true);
    try {
      console.log(`Git: Pushing branch "${gitStatus.currentBranch}"...`);
      await invoke("git_push", { rootDir: rootPath, branchName: gitStatus.currentBranch });
      await loadGitStatus();
      await fetchHistory();
      notify("Push complete", "Successfully pushed changes to remote.", "success");
    } catch (err: any) {
      console.error("Push failed:", err);
      notify("Push failed", `Push failed: ${err}`, "error");
    } finally {
      setIsPushing(false);
    }
  };

  // Stage individual file
  const handleStageFile = async (e: React.MouseEvent, filePath: string) => {
    e.stopPropagation(); // Avoid opening the diff tab on button click
    try {
      await invoke("git_stage_file", { rootDir: rootPath, filePath });
      await loadGitStatus();
      await fetchHistory();
    } catch (err) {
      console.error(`Failed to stage file ${filePath}:`, err);
    }
  };

  // Unstage individual file
  const handleUnstageFile = async (e: React.MouseEvent, filePath: string) => {
    e.stopPropagation(); // Avoid opening the diff tab on button click
    try {
      await invoke("git_unstage_file", { rootDir: rootPath, filePath });
      await loadGitStatus();
      await fetchHistory();
    } catch (err) {
      console.error(`Failed to unstage file ${filePath}:`, err);
    }
  };

  // Discard file changes
  const handleDiscardChanges = async (e: React.MouseEvent, filePath: string, fileName: string) => {
    e.stopPropagation(); // Avoid opening the diff tab on button click
    const confirmDiscard = window.confirm(`Are you sure you want to discard all unstaged changes in "${fileName}"? This cannot be undone.`);
    if (!confirmDiscard) return;

    try {
      await invoke("git_discard_changes", { rootDir: rootPath, filePath });
      await loadGitStatus();
      await fetchHistory();
      // Reload workspace directory tree structure
      const tree: any[] = await invoke("get_directory_structure", { rootDir: rootPath });
      useWorkspaceStore.getState().setFileTree(tree);
    } catch (err) {
      console.error(`Failed to discard changes for ${filePath}:`, err);
    }
  };

  // Discard all changes in the working tree
  const handleDiscardAllChanges = async () => {
    const confirmDiscard = window.confirm(
      "Are you sure you want to discard ALL unstaged modifications and untracked files? This action CANNOT BE UNDONE."
    );
    if (!confirmDiscard) return;

    try {
      console.log(`Git: Discarding all unstaged changes in ${rootPath}`);
      await invoke("git_discard_all_changes", { rootDir: rootPath });
      await loadGitStatus();
      await fetchHistory();
      // Reload workspace directory tree structure
      const tree: any[] = await invoke("get_directory_structure", { rootDir: rootPath });
      useWorkspaceStore.getState().setFileTree(tree);
      notify("Discard complete", "All unstaged changes have been discarded.", "success");
    } catch (err: any) {
      console.error("Failed to discard all changes:", err);
      notify("Discard failed", `Discard failed: ${err}`, "error");
    }
  };

  // Handles checking out another branch. Accepts a local name ("feature") or a
  // remote-tracking ref ("origin/feature"). The backend wires up origin tracking
  // for remote refs so push/pull work on the resulting local branch.
  const handleSwitchBranch = async (branchName: string) => {
    if (!rootPath) return;
    try {
      console.log(`Git: Switching branch to "${branchName}"`);
      await invoke("git_checkout_branch", { rootDir: rootPath, branchName });
      await loadGitStatus();
      await fetchBranches();
      await fetchHistory();
      // Reload workspace directory tree structure
      const tree: any[] = await invoke("get_directory_structure", { rootDir: rootPath });
      useWorkspaceStore.getState().setFileTree(tree);
      const localName = branchName.startsWith("origin/") ? branchName.substring("origin/".length) : branchName;
      notify("Branch switched", `Switched to branch: ${localName}`, "success");
    } catch (err: any) {
      console.error("Failed to switch branch:", err);
      notify("Switch failed", `Failed to switch branch: ${err}`, "error");
    }
  };

  const handleCreateBranch = async (branchName: string, checkout: boolean) => {
    if (!rootPath) return;
    try {
      await invoke("git_create_branch", { rootDir: rootPath, branchName, checkout });
      await fetchBranches();
      if (checkout) {
        await loadGitStatus();
        await fetchHistory();
        const tree: any[] = await invoke("get_directory_structure", { rootDir: rootPath });
        useWorkspaceStore.getState().setFileTree(tree);
      }
      setBranchDialog(null);
    } catch (err: any) {
      notify("Error", `Failed to create branch: ${err}`, "error");
    }
  };

  // Delete a local branch (force via -D when `force` is true) or, when an
  // origin/... branch is selected, push-delete it from the remote.
  const handleDeleteBranch = async (branchName: string, force: boolean) => {
    if (!rootPath) return;
    try {
      if (branchName.startsWith("origin/")) {
        await invoke("git_delete_remote_branch", { rootDir: rootPath, branchName });
      } else {
        await invoke("git_delete_branch", { rootDir: rootPath, branchName, force });
      }
      await fetchBranches();
      await loadGitStatus();
      await fetchHistory();
      setBranchDialog(null);
      notify("Branch deleted", `Deleted branch: ${branchName}`, "success");
    } catch (err: any) {
      console.error("Failed to delete branch:", err);
      notify("Delete failed", `Failed to delete branch: ${err}`, "error");
    }
  };

  const handleMergeBranch = async (branchName: string) => {
    if (!rootPath) return;
    try {
      const result = await invoke("git_merge_branch", { rootDir: rootPath, branchName });
      await loadGitStatus();
      await fetchBranches();
      await fetchHistory();
      const tree: any[] = await invoke("get_directory_structure", { rootDir: rootPath });
      useWorkspaceStore.getState().setFileTree(tree);
      setBranchDialog(null);
      notify("Merge complete", String(result) || `Merged ${branchName} into current branch.`, "success");
    } catch (err: any) {
      // Check if it's a merge conflict
      const errMsg = String(err);
      if (errMsg.includes("conflict") || errMsg.includes("CONFLICT")) {
        notify("Merge conflicts", `Merge conflicts detected. Resolve them and commit, or run "Abort merge" from the branch menu.`, "danger");
      } else {
        notify("Merge failed", `Merge failed: ${err}`, "error");
      }
      setBranchDialog(null);
    }
  };

  const handleRebaseBranch = async (branchName: string) => {
    if (!rootPath) return;
    try {
      const result = await invoke("git_rebase_branch", { rootDir: rootPath, branchName });
      await loadGitStatus();
      await fetchBranches();
      await fetchHistory();
      const tree: any[] = await invoke("get_directory_structure", { rootDir: rootPath });
      useWorkspaceStore.getState().setFileTree(tree);
      setBranchDialog(null);
      notify("Rebase complete", String(result) || `Rebased current branch onto ${branchName}.`, "success");
    } catch (err: any) {
      const errMsg = String(err);
      if (errMsg.includes("conflict") || errMsg.includes("CONFLICT")) {
        notify("Rebase conflicts", `Rebase conflicts detected. Resolve them and continue, or run "Abort rebase" from the branch menu.`, "danger");
      } else {
        notify("Rebase failed", `Rebase failed: ${err}`, "error");
      }
      setBranchDialog(null);
    }
  };

  const handleAbortPending = async () => {
    if (!rootPath) return;
    try {
      // Try both abort types
      try {
        await invoke("git_abort_pending", { rootDir: rootPath, operation: "rebase" });
      } catch {
        await invoke("git_abort_pending", { rootDir: rootPath, operation: "merge" });
      }
      await loadGitStatus();
      await fetchHistory();
      const tree: any[] = await invoke("get_directory_structure", { rootDir: rootPath });
      useWorkspaceStore.getState().setFileTree(tree);
      notify("Aborted", "Aborted pending operation.", "success");
    } catch (err: any) {
      notify("Abort failed", `Abort failed: ${err}`, "error");
    }
  };

  const handleUndoRename = async () => {
    if (!rootPath || !lastRename) return;
    try {
      await invoke("git_undo_last_rename", {
        rootDir: rootPath,
        originalPath: lastRename.originalPath,
        newPath: lastRename.newPath,
      });
      await loadGitStatus();
      const tree: any[] = await invoke("get_directory_structure", { rootDir: rootPath });
      useWorkspaceStore.getState().setFileTree(tree);
      setLastRename(null);
      notify("Undo complete", "Move/rename has been undone.", "success");
    } catch (err: any) {
      notify("Undo failed", `Undo failed: ${err}`, "error");
    }
  };

  // Helper to open side-by-side Monaco diff panel in the workspace tabs
  const handleOpenFileDiff = (filePath: string, fileName: string, diffType: "staged" | "unstaged") => {
    const titleSuffix = diffType === "staged" ? "Index" : "Workspace";
    openTab({
      id: `git-diff-${filePath}-${diffType}`,
      type: "git-diff",
      title: `${fileName} (${titleSuffix})`,
      key: filePath,
      diffType,
    });
  };

  // Get modification status visual indicators
  const getStatusIndicator = (statusType: string) => {
    switch (statusType) {
      case "added":
        return { char: "A", colorClass: "text-emerald-400 font-bold" };
      case "deleted":
        return { char: "D", colorClass: "text-rose-500 font-bold" };
      case "untracked":
        return { char: "U", colorClass: "text-emerald-400 opacity-80" };
      case "renamed":
        return { char: "R", colorClass: "text-sky-400 font-bold" };
      case "modified":
      default:
        return { char: "M", colorClass: "text-amber-400 font-bold" };
    }
  };

  // Build a merged unstaged list that collapses rename/move pairs (deleted + untracked) into a single "renamed" entry
  const buildUnstagedList = () => {
    if (!gitStatus) return [];
    if (!lastRename) return gitStatus.unstaged;

    const { originalPath, newPath } = lastRename;
    const hasDeleted = gitStatus.unstaged.some(f => f.path === originalPath);
    const hasUntracked = gitStatus.unstaged.some(f => f.path === newPath);

    // Only collapse if BOTH entries exist in the unstaged list
    if (!hasDeleted || !hasUntracked) {
      return gitStatus.unstaged;
    }

    // Filter out both the old (deleted) and new (untracked) paths, add synthetic "renamed" entry
    const filtered = gitStatus.unstaged.filter(
      (f) => f.path !== originalPath && f.path !== newPath
    );
    return [
      ...filtered,
      {
        path: newPath,
        name: `${originalPath.split("/").pop()} → ${newPath.split("/").pop()}`,
        status_type: "renamed",
      },
    ];
  };

  const unstagedList = buildUnstagedList();

  // Clear stale lastRename when neither path appears in git status anymore
  useEffect(() => {
    if (!lastRename || !gitStatus) return;
    const { originalPath, newPath } = lastRename;
    const stillExists = gitStatus.unstaged.some(f => f.path === originalPath || f.path === newPath)
      || gitStatus.staged.some(f => f.path === originalPath || f.path === newPath);
    if (!stillExists) {
      setLastRename(null);
    }
  }, [gitStatus, lastRename, setLastRename]);
  const totalChanges = (gitStatus?.staged.length || 0) + unstagedList.length;

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[var(--bg-sidebar)] font-sans text-xs select-none">
      {/* Header Info */}
      <div className="px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between flex-shrink-0 bg-black/5">
        <div className="flex items-center space-x-2">
          <span className="font-bold text-[var(--text-light)] uppercase tracking-wider text-[10px] font-mono">Source Control</span>
          <button
            type="button"
            onClick={handleOpenGraph}
            className="p-1 rounded hover:bg-[var(--border-color)]/60 text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer"
            title="Open Commit Graph"
          >
            <GitCommit size={13} className="text-[var(--accent-color)]" />
          </button>
        </div>
        {gitStatus && (
          <div className="flex items-center space-x-1.5">
            {/* Branch management buttons */}
            <button
              type="button"
              onClick={() => setBranchDialog("create")}
              className="p-1 rounded hover:bg-[var(--border-color)]/60 text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer"
              title="Create Branch"
            >
              <Plus size={12} />
            </button>
            <button
              type="button"
              onClick={() => setBranchDialog("merge")}
              className="p-1 rounded hover:bg-[var(--border-color)]/60 text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer"
              title="Merge Branch"
            >
              <GitMerge size={12} />
            </button>
            <button
              type="button"
              onClick={() => setBranchDialog("rebase")}
              className="p-1 rounded hover:bg-[var(--border-color)]/60 text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer"
              title="Rebase"
            >
              <GitPullRequest size={12} />
            </button>
            <button
              type="button"
              onClick={() => setBranchDialog("delete")}
              className="p-1 rounded hover:bg-rose-500/10 text-[var(--text-muted)] hover:text-rose-400 transition-colors cursor-pointer"
              title="Delete Branch"
            >
              <Trash2 size={12} />
            </button>
            <button
              type="button"
              onClick={handleAbortPending}
              className="p-1 rounded hover:bg-rose-500/10 text-[var(--text-muted)] hover:text-rose-400 transition-colors cursor-pointer"
              title="Abort Merge/Rebase"
            >
              <RotateCcw size={12} />
            </button>
            <div className="flex items-center space-x-1 bg-[var(--accent-bg)]/35 text-[var(--accent-color)] px-2 py-0.5 rounded font-mono text-[10px] border border-[var(--accent-color)]/25 relative hover:border-[var(--accent-color)]/50 transition-all cursor-pointer min-w-[100px]">
              <GitBranch size={10} className="flex-shrink-0 mr-1" />
              <CustomSelect
                value={gitStatus.currentBranch}
                onChange={handleSwitchBranch}
                groups={[
                  { label: "Local", options: localBranches.map((b) => ({ id: b, name: b })) },
                  { label: "Origin", options: remoteBranches.map((b) => ({ id: b, name: b })) },
                ]}
                buttonClassName="bg-transparent border-none text-[var(--accent-color)] font-mono text-[10px] focus:outline-none cursor-pointer outline-none font-bold p-0 flex items-center justify-between w-full"
                dropdownClassName="min-w-[280px] w-max max-w-[min(90vw,560px)]"
                className="flex-1"
              />
            </div>
          </div>
        )}
      </div>

      {/* Commit Box Form */}
      <div className="p-3 border-b border-[var(--border-color)] flex-shrink-0 bg-black/10">
        <form onSubmit={handleCommit} className="space-y-2">
          <textarea
            placeholder={`Commit message (Cmd+Enter to commit)`}
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                handleCommit();
              }
            }}
            className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs font-sans text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)] resize-none h-16 leading-relaxed select-text placeholder:text-[var(--text-muted)]"
            disabled={isCommitting || totalChanges === 0}
          />
          <button
            type="submit"
            disabled={isCommitting || !commitMsg.trim() || totalChanges === 0}
            className="w-full bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/85 disabled:bg-[var(--border-color)] disabled:opacity-50 text-white text-[11px] font-mono font-bold py-1.5 rounded-lg transition-all shadow-md flex items-center justify-center space-x-1.5 cursor-pointer glow-btn"
          >
            <Check size={12} />
            <span>{isCommitting ? "Committing..." : "Commit"}</span>
          </button>
          
          <div className="flex space-x-2">
            <button
              type="button"
              onClick={handlePull}
              disabled={isCommitting || isPushing || isPulling}
              className="flex-1 bg-[var(--bg-app)] border border-[var(--border-color)] hover:border-[var(--border-active)] hover:bg-[var(--bg-sidebar)] text-[var(--text-light)] text-[10px] font-mono font-bold py-1.5 rounded-lg transition-all flex items-center justify-center space-x-1 cursor-pointer"
              title="Pull changes from remote"
            >
              <ArrowDown size={11} className={isPulling ? "animate-bounce" : ""} />
              <span>{isPulling ? "Pulling..." : "Pull"}</span>
            </button>
            <button
              type="button"
              onClick={handlePush}
              disabled={isCommitting || isPushing || isPulling}
              className="flex-1 bg-[var(--bg-app)] border border-[var(--border-color)] hover:border-[var(--border-active)] hover:bg-[var(--bg-sidebar)] text-[var(--text-light)] text-[10px] font-mono font-bold py-1.5 rounded-lg transition-all flex items-center justify-center space-x-1 cursor-pointer"
              title="Push changes to remote"
            >
              <ArrowUp size={11} className={isPushing ? "animate-bounce" : ""} />
              <span>{isPushing ? "Pushing..." : "Push"}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Scrollable Changes List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        
        {/* 1. Staged Changes List */}
        {gitStatus && gitStatus.staged.length > 0 && (
          <div className="space-y-1">
            <div className="px-2 py-1 flex items-center justify-between text-[10px] font-mono font-bold text-[var(--text-muted)] uppercase tracking-wider">
              <span>Staged Changes</span>
              <span className="bg-[var(--border-color)] px-1.5 py-0.2 rounded-full text-[9px] text-[var(--text-normal)]">
                {gitStatus.staged.length}
              </span>
            </div>
            
            <div className="space-y-0.5">
              {gitStatus.staged.map((file) => {
                const indicator = getStatusIndicator(file.status_type);
                // Extract parent directory for display
                const relativeDir = file.path.substring(rootPath.length + 1, file.path.length - file.name.length - 1);
                
                return (
                  <div
                    key={`staged-${file.path}`}
                    onClick={() => handleOpenFileDiff(file.path, file.name, "staged")}
                    className="group flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-[var(--accent-bg)]/20 cursor-pointer transition-colors"
                  >
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-[var(--text-normal)] group-hover:text-[var(--text-light)] truncate font-mono text-[11px]">
                        {file.name}
                      </span>
                      {relativeDir && (
                        <span className="text-[9px] text-[var(--text-muted)] truncate select-none">
                          {relativeDir}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-2.5">
                      {/* Unstage Hover Button */}
                      <button
                        onClick={(e) => handleUnstageFile(e, file.path)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-rose-400 hover:bg-black/20 rounded transition-all cursor-pointer"
                        title="Unstage changes"
                      >
                        <Minus size={11} />
                      </button>
                      <span className={`w-4 text-center text-[10px] font-mono select-none ${indicator.colorClass}`}>
                        {indicator.char}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 2. Unstaged Changes List */}
        {gitStatus && unstagedList.length > 0 && (
          <div className="space-y-1">
            <div className="px-2 py-1 flex items-center justify-between text-[10px] font-mono font-bold text-[var(--text-muted)] uppercase tracking-wider">
              <div className="flex items-center space-x-1.5">
                <span>Changes</span>
                <span className="bg-[var(--border-color)] px-1.5 py-0.2 rounded-full text-[9px] text-[var(--text-normal)]">
                  {unstagedList.length}
                </span>
              </div>
              <button
                type="button"
                onClick={handleDiscardAllChanges}
                className="p-1 rounded hover:bg-rose-500/10 text-[var(--text-muted)] hover:text-rose-400 transition-colors cursor-pointer"
                title="Discard All Unstaged Changes"
              >
                <RotateCcw size={12} />
              </button>
            </div>

            <div className="space-y-0.5">
              {unstagedList.map((file) => {
                const indicator = getStatusIndicator(file.status_type);
                const isRenamed = file.status_type === "renamed";
                const relativeDir = isRenamed
                  ? ""
                  : file.path.substring(rootPath.length + 1, file.path.length - file.name.length - 1);

                return (
                  <div
                    key={`unstaged-${file.path}`}
                    onClick={() => !isRenamed && handleOpenFileDiff(file.path, file.name, "unstaged")}
                    className="group flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-[var(--accent-bg)]/20 cursor-pointer transition-colors"
                  >
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-[var(--text-normal)] group-hover:text-[var(--text-light)] truncate font-mono text-[11px]">
                        {file.name}
                      </span>
                      {relativeDir && (
                        <span className="text-[9px] text-[var(--text-muted)] truncate select-none">
                          {relativeDir}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-1.5">
                      {/* Rollback Rename Button */}
                      {isRenamed && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleUndoRename(); }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-sky-400 hover:bg-black/20 rounded transition-all cursor-pointer"
                          title="Undo rename/move"
                        >
                          <RotateCcw size={11} />
                        </button>
                      )}

                      {/* Discard Hover Button */}
                      {!isRenamed && file.status_type !== "untracked" && (
                        <button
                          onClick={(e) => handleDiscardChanges(e, file.path, file.name)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-amber-400 hover:bg-black/20 rounded transition-all cursor-pointer"
                          title="Discard changes"
                        >
                          <RotateCcw size={11} />
                        </button>
                      )}
                      
                      {/* Stage Hover Button */}
                      {!isRenamed && (
                        <button
                          onClick={(e) => handleStageFile(e, file.path)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-emerald-400 hover:bg-black/20 rounded transition-all cursor-pointer"
                          title="Stage changes"
                        >
                          <Plus size={11} />
                        </button>
                      )}

                      <span className={`w-4 text-center text-[10px] font-mono select-none ${indicator.colorClass}`}>
                        {indicator.char}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 3. Empty Changes State */}
        {gitStatus && totalChanges === 0 && (
          <div className="flex flex-col items-center justify-center p-6 h-20 text-center text-[var(--text-muted)] font-mono text-[10px] space-y-1">
            <span>// No modifications detected.</span>
            <span>Working directory is clean.</span>
          </div>
        )}

        {/* 4. Collapsible Git History Section */}
        {gitStatus && (
          <div className="space-y-1 border-t border-[var(--border-color)]/40 pt-3 mt-2">
            <div
              onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
              className="px-2 py-1 flex items-center justify-between text-[10px] font-mono font-bold text-[var(--text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--text-light)] select-none"
            >
              <div className="flex items-center space-x-1.5">
                <ChevronDown size={11} className={`transform transition-transform ${isHistoryExpanded ? "" : "-rotate-90"}`} />
                <span>Git History</span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenGraph();
                }}
                className="text-[9px] text-[var(--accent-color)] hover:underline cursor-pointer flex items-center space-x-1 font-bold font-mono"
              >
                <span>[ full graph ]</span>
              </button>
            </div>

            {isHistoryExpanded && (
              <div className="space-y-0.5 max-h-72 overflow-y-auto pr-1">
                {historyCommits.length === 0 ? (
                  <div className="text-center py-4 text-[10px] text-[var(--text-muted)] font-mono">
                    No commits yet.
                  </div>
                ) : (
                  historyCommits.map((commit) => (
                    <div
                      key={commit.hash}
                      onClick={handleOpenGraph}
                      className="group flex items-center justify-between px-2 py-1 rounded hover:bg-[var(--accent-bg)]/20 cursor-pointer transition-colors"
                      title="Click to open Git Graph"
                    >
                      <div className="flex flex-col min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center space-x-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${commit.is_unpushed ? "bg-amber-500 animate-pulse" : "bg-[var(--accent-color)]"}`} />
                          <span className="text-[var(--text-normal)] group-hover:text-[var(--text-light)] truncate font-mono text-[10.5px]">
                            {commit.subject}
                          </span>
                        </div>
                        <div className="flex items-center text-[9px] text-[var(--text-muted)] font-mono space-x-2 pl-3">
                          <span className="truncate max-w-[80px]">{commit.author}</span>
                          <span>•</span>
                          <span>{commit.date}</span>
                          <span>•</span>
                          <span className="font-bold">{commit.short_hash}</span>
                        </div>
                      </div>
                      {commit.is_unpushed && (
                        <span title="Outgoing commit">
                          <ArrowUp size={10} className="text-amber-500 flex-shrink-0 ml-1.5" />
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Branch Dialog */}
      {branchDialog && gitStatus && (
        <BranchDialog
          mode={branchDialog}
          currentBranch={gitStatus.currentBranch}
          localBranches={localBranches}
          remoteBranches={remoteBranches}
          onConfirm={(name, extra) => {
            if (branchDialog === "create") handleCreateBranch(name, extra || false);
            else if (branchDialog === "merge") handleMergeBranch(name);
            else if (branchDialog === "rebase") handleRebaseBranch(name);
            else if (branchDialog === "delete") handleDeleteBranch(name, extra || false);
          }}
          onCancel={() => setBranchDialog(null)}
        />
      )}
    </div>
  );
};
