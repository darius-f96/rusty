import React, { useState, useEffect } from "react";
import { GitBranch, Plus, Minus, RotateCcw, Check, AlertCircle, ArrowUp, ArrowDown, GitCommit, ChevronDown } from "lucide-react";
import { useWorkspaceStore } from "../store";
import { invoke } from "@tauri-apps/api/core";
import { gitPresenter } from "./git/GitPresenter";
import { GitBranchManager } from "./git/GitBranchManager";
import { notify } from "../notificationStore";
import { useConfirm } from "./useConfirm";

export const SourceControl: React.FC = () => {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const gitStatus = useWorkspaceStore((state) => state.gitStatus);
  const loadGitStatus = useWorkspaceStore((state) => state.loadGitStatus);
  const openTab = useWorkspaceStore((state) => state.openTab);

  const [activeRepo, setActiveRepo] = useState<string>("");
  const [subprojects, setSubprojects] = useState<string[]>([]);
  const [commitMsg, setCommitMsg] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [initLoading, setInitLoading] = useState(false);
  const [localBranches, setLocalBranches] = useState<string[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(true);
  const [historyCommits, setHistoryCommits] = useState<any[]>([]);
  const [showBranchPopover, setShowBranchPopover] = useState(false);

  const lastRename = useWorkspaceStore((state) => state.lastRename);
  const setLastRename = useWorkspaceStore((state) => state.setLastRename);

  const { confirm, ConfirmModalComponent } = useConfirm();

  const handleOpenGraph = () => {
    openTab({
      id: "git-history",
      type: "git-history",
      title: "Git Graph",
      key: "git-history",
    });
  };

  // Scan subprojects and initialize activeRepo
  useEffect(() => {
    if (rootPath) {
      setActiveRepo(rootPath);
      gitPresenter.scanSubprojects(rootPath).then((repos) => {
        // Add rootPath if not already present
        const list = Array.from(new Set([rootPath, ...repos]));
        setSubprojects(list);
      }).catch((err) => {
        console.error("Failed to scan subprojects:", err);
      });
    }
  }, [rootPath]);

  // Load Git status, branches, and history on repository switch
  const loadRepoData = async () => {
    if (activeRepo) {
      try {
        await loadGitStatus(activeRepo);
        
        // Fetch commit history
        try {
          const history: any[] = await invoke("git_get_commit_history", { rootDir: activeRepo });
          setHistoryCommits(history.slice(0, 15)); // Show last 15 commits
        } catch (e) {
          console.warn("Failed to load history commits for current repo:", e);
        }

        // Fetch branches
        try {
          try {
            await invoke("git_fetch", { rootDir: activeRepo });
          } catch {}
          const res: { local: string[]; remote: string[] } = await invoke("git_get_all_branches", { rootDir: activeRepo });
          setLocalBranches(res.local || []);
          setRemoteBranches(res.remote || []);
        } catch (e) {
          console.warn("Failed to load branches for current repo:", e);
        }
      } catch (err) {
        console.error("Failed to load repo data:", err);
      }
    }
  };

  useEffect(() => {
    loadRepoData();
  }, [activeRepo]);

  // If no folder is open, guide the user
  if (!rootPath) {
    return (
      <div className="flex flex-col items-center justify-center p-6 h-full text-center text-[var(--text-muted)] font-mono text-xs select-none">
        <AlertCircle size={20} className="text-amber-500 mb-2" />
        <span>Open a folder first to view Source Control</span>
      </div>
    );
  }

  // Handle git initialization
  const handleInitializeRepo = async () => {
    setInitLoading(true);
    try {
      console.log(`Git: Initializing repository at ${activeRepo}`);
      await invoke("git_init", { rootDir: activeRepo });
      await loadRepoData();
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

  const handleCommit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!commitMsg.trim() || isCommitting || !gitStatus) return;

    if (gitStatus.staged.length === 0) {
      notify("Nothing to commit", "Please stage your changes before committing.", "info");
      return;
    }

    setIsCommitting(true);
    try {
      await gitPresenter.commit(activeRepo, commitMsg);
      setCommitMsg("");
      await loadRepoData();
    } catch (err) {
      console.error(err);
    } finally {
      setIsCommitting(false);
    }
  };

  const handlePull = async () => {
    if (!activeRepo || isPulling) return;
    setIsPulling(true);
    try {
      await gitPresenter.pull(activeRepo);
      await loadRepoData();
    } catch (err) {
      console.error(err);
    } finally {
      setIsPulling(false);
    }
  };

  const handlePush = async () => {
    if (!activeRepo || !gitStatus || isPushing) return;
    setIsPushing(true);
    try {
      await gitPresenter.push(activeRepo, gitStatus.currentBranch);
      await loadRepoData();
    } catch (err) {
      console.error(err);
    } finally {
      setIsPushing(false);
    }
  };

  const handleStageFile = async (e: React.MouseEvent, filePath: string) => {
    e.stopPropagation();
    try {
      await gitPresenter.stageFile(activeRepo, filePath);
      await loadRepoData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleUnstageFile = async (e: React.MouseEvent, filePath: string) => {
    e.stopPropagation();
    try {
      await gitPresenter.unstageFile(activeRepo, filePath);
      await loadRepoData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDiscardChanges = async (e: React.MouseEvent, filePath: string, fileName: string) => {
    e.stopPropagation();
    try {
      await gitPresenter.discardChanges(activeRepo, filePath, fileName, async (title, msg) => {
        return await confirm({
          title,
          message: msg,
          kind: "warning"
        });
      });
      await loadRepoData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDiscardAllChanges = async () => {
    try {
      await gitPresenter.discardAllChanges(activeRepo, async (title, msg) => {
        return await confirm({
          title,
          message: msg,
          kind: "danger"
        });
      });
      await loadRepoData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleCheckoutBranch = async (branchName: string) => {
    try {
      await gitPresenter.switchBranch(activeRepo, branchName);
      await loadRepoData();
      setShowBranchPopover(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateBranch = async (branchName: string) => {
    try {
      await gitPresenter.createBranch(activeRepo, branchName, true);
      await loadRepoData();
      setShowBranchPopover(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteBranch = async (branchName: string, force: boolean) => {
    try {
      await gitPresenter.deleteBranch(activeRepo, branchName, force);
      await loadRepoData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleMergeBranch = async (branchName: string) => {
    try {
      await gitPresenter.mergeBranch(activeRepo, branchName);
      await loadRepoData();
      setShowBranchPopover(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRebaseBranch = async (branchName: string) => {
    try {
      await gitPresenter.rebaseBranch(activeRepo, branchName);
      await loadRepoData();
      setShowBranchPopover(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAbortPending = async () => {
    try {
      await gitPresenter.abortPending(activeRepo);
      await loadRepoData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleUndoRename = async () => {
    if (!lastRename) return;
    try {
      await gitPresenter.undoLastRename(activeRepo, lastRename.originalPath, lastRename.newPath);
      setLastRename(null);
      await loadRepoData();
    } catch (err) {
      console.error(err);
    }
  };

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

  const buildUnstagedList = () => {
    if (!gitStatus) return [];
    if (!lastRename) return gitStatus.unstaged;

    const { originalPath, newPath } = lastRename;
    const hasDeleted = gitStatus.unstaged.some(f => f.path === originalPath);
    const hasUntracked = gitStatus.unstaged.some(f => f.path === newPath);

    if (!hasDeleted || !hasUntracked) return gitStatus.unstaged;

    const filtered = gitStatus.unstaged.filter(
      (f) => f.path !== originalPath && f.path !== newPath
    );
    return [
      ...filtered,
      {
        path: newPath,
        name: `${originalPath.split("/").pop()} → ${newPath.split("/").pop()}`,
        status_type: "renamed" as const,
      },
    ];
  };

  const unstagedList = buildUnstagedList();
  const totalChanges = (gitStatus?.staged.length || 0) + unstagedList.length;

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[var(--bg-sidebar)] font-sans text-xs select-none relative">
      {/* Subproject Selector (Only if nested repositories are present) */}
      {subprojects.length > 1 && (
        <div className="px-4 py-2 border-b border-[var(--border-color)]/60 bg-black/10 flex items-center justify-between flex-shrink-0">
          <span className="text-[9px] font-mono text-[var(--text-muted)] uppercase font-semibold">Repository:</span>
          <select
            value={activeRepo}
            onChange={(e) => setActiveRepo(e.target.value)}
            className="bg-[var(--bg-app)] border border-[var(--border-color)] text-[var(--text-normal)] rounded px-2 py-0.5 max-w-[170px] truncate text-[10px] font-mono focus:outline-none focus:border-[var(--accent-color)]"
          >
            {subprojects.map((repo) => {
              const name = repo === rootPath ? "[Workspace Root]" : repo.replace(`${rootPath}/`, "");
              return (
                <option key={repo} value={repo}>
                  {name}
                </option>
              );
            })}
          </select>
        </div>
      )}

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
          <div className="flex items-center space-x-1.5 relative">
            <button
              type="button"
              onClick={handleAbortPending}
              className="p-1 rounded hover:bg-rose-500/10 text-[var(--text-muted)] hover:text-rose-400 transition-colors cursor-pointer"
              title="Abort Merge/Rebase"
            >
              <RotateCcw size={12} />
            </button>
            <button
              onClick={() => setShowBranchPopover(!showBranchPopover)}
              className="flex items-center space-x-1 bg-[var(--accent-bg)]/35 text-[var(--accent-color)] px-2 py-1 rounded font-mono text-[10px] border border-[var(--accent-color)]/25 hover:border-[var(--accent-color)]/50 transition-all cursor-pointer font-bold"
            >
              <GitBranch size={10} className="flex-shrink-0 mr-1" />
              <span className="truncate max-w-[80px]">{gitStatus.currentBranch}</span>
              <ChevronDown size={10} className="flex-shrink-0 opacity-60 ml-0.5" />
            </button>

            {/* IntelliJ Branch Manager Popover */}
            {showBranchPopover && (
              <GitBranchManager
                currentBranch={gitStatus.currentBranch}
                localBranches={localBranches}
                remoteBranches={remoteBranches}
                onCheckout={handleCheckoutBranch}
                onCreateBranch={handleCreateBranch}
                onDeleteBranch={handleDeleteBranch}
                onMergeBranch={handleMergeBranch}
                onRebaseBranch={handleRebaseBranch}
                onClose={() => setShowBranchPopover(false)}
              />
            )}
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
                const relativeDir = file.path.substring(activeRepo.length + 1, file.path.length - file.name.length - 1);
                
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
                  : file.path.substring(activeRepo.length + 1, file.path.length - file.name.length - 1);

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
                      {isRenamed && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleUndoRename(); }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-sky-400 hover:bg-black/20 rounded transition-all cursor-pointer"
                          title="Undo rename/move"
                        >
                          <RotateCcw size={11} />
                        </button>
                      )}

                      {!isRenamed && file.status_type !== "untracked" && (
                        <button
                          onClick={(e) => handleDiscardChanges(e, file.path, file.name)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-amber-400 hover:bg-black/20 rounded transition-all cursor-pointer"
                          title="Discard changes"
                        >
                          <RotateCcw size={11} />
                        </button>
                      )}
                      
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
      </div>

      {/* 4. Collapsible Git History Section */}
      {gitStatus && (
        <div className="flex-shrink-0 border-t border-[var(--border-color)]/40">
          <div
            onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
            className="px-3 py-2 flex items-center justify-between text-[10px] font-mono font-bold text-[var(--text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--text-light)] select-none bg-black/5"
          >
            <div className="flex items-center space-x-1.5">
              <ChevronDown size={11} className={`transform transition-transform duration-200 ${isHistoryExpanded ? "" : "-rotate-90"}`} />
              <span>Git History</span>
              <span className="bg-[var(--border-color)] px-1.5 py-0.2 rounded-full text-[9px] text-[var(--text-normal)]">
                {historyCommits.length}
              </span>
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

          <div className={`transition-all duration-200 ease-out ${isHistoryExpanded ? "max-h-64" : "max-h-0"} overflow-hidden`}>
            <div className="flex flex-col-reverse p-2 pt-0 space-y-0.5 max-h-60 overflow-y-auto">
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
          </div>
        </div>
      )}

      {ConfirmModalComponent}
    </div>
  );
};
