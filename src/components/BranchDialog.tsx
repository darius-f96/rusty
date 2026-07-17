import React, { useState, useEffect, useRef } from "react";
import { GitBranch, GitMerge, GitPullRequest, Trash2, AlertCircle, AlertTriangle } from "lucide-react";
import { Modal } from "./Modal";

interface BranchDialogProps {
  mode: "create" | "merge" | "rebase" | "delete";
  currentBranch: string;
  localBranches: string[];
  remoteBranches?: string[];
  onConfirm: (branchName: string, extra?: boolean) => void;
  onCancel: () => void;
}

export const BranchDialog: React.FC<BranchDialogProps> = ({ mode, currentBranch, localBranches, remoteBranches = [], onConfirm, onCancel }) => {
  const [branchName, setBranchName] = useState("");
  const [checkoutAfter, setCheckoutAfter] = useState(true);
  const [forceDelete, setForceDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "create") {
      inputRef.current?.focus();
    }
  }, [mode]);

  const config = {
    create: {
      icon: GitBranch,
      title: "Create Branch",
      placeholder: "e.g. feature/my-new-branch",
      label: "Branch name",
      confirmLabel: "Create",
      needsInput: true,
      variant: "default" as const,
    },
    merge: {
      icon: GitMerge,
      title: "Merge Branch",
      placeholder: "",
      label: "Merge into current branch",
      confirmLabel: "Merge",
      needsInput: false,
      variant: "default" as const,
    },
    rebase: {
      icon: GitPullRequest,
      title: "Rebase",
      placeholder: "",
      label: "Rebase current branch onto",
      confirmLabel: "Rebase",
      needsInput: false,
      variant: "default" as const,
    },
    delete: {
      icon: Trash2,
      title: "Delete Branch",
      placeholder: "",
      label: "Select a branch to delete",
      confirmLabel: "Delete",
      needsInput: false,
      variant: "danger" as const,
    },
  }[mode];

  const isOriginBranch = branchName.startsWith("origin/");
  const isCurrent = branchName === currentBranch || branchName === `origin/${currentBranch}`;

  const handleConfirm = () => {
    const name = branchName.trim();
    if (mode === "create") {
      if (!name) {
        setError("Branch name is required");
        return;
      }
      if (localBranches.includes(name)) {
        setError("Branch already exists");
        return;
      }
      onConfirm(name, checkoutAfter);
    } else if (mode === "delete") {
      if (!name) {
        setError("Please select a branch");
        return;
      }
      if (isCurrent) {
        setError("Cannot delete the currently checked out branch");
        return;
      }
      onConfirm(name, forceDelete);
    } else {
      if (!name) {
        setError("Please select a branch");
        return;
      }
      if (name === currentBranch) {
        setError(`Cannot ${mode} onto the current branch`);
        return;
      }
      onConfirm(name);
    }
  };

  const renderBranchRow = (b: string) => {
    const rowCurrent = b === currentBranch || b === `origin/${currentBranch}`;
    return (
      <div
        key={b}
        onClick={() => { setBranchName(b); setError(null); }}
        className={`flex items-center px-2.5 py-1.5 rounded-md cursor-pointer text-xs font-mono transition-colors ${
          branchName === b
            ? "bg-[var(--accent-bg)] text-[var(--accent-color)] font-semibold"
            : "hover:bg-[var(--bg-app)] text-[var(--text-normal)]"
        }`}
      >
        <GitBranch size={12} className="mr-2 flex-shrink-0" />
        <span className="truncate">{b}</span>
        {rowCurrent && (
          <span className="ml-auto text-[9px] text-[var(--text-muted)] uppercase pl-2 flex-shrink-0">current</span>
        )}
      </div>
    );
  };

  const showOriginWarning = mode === "delete" && isOriginBranch;
  const showLocalDeleteOptions = mode === "delete" && branchName && !isOriginBranch;

  return (
    <Modal
      title={config.title}
      icon={config.icon}
      iconClassName={config.variant === "danger" ? "text-[var(--color-status-danger)]" : "text-[var(--accent-color)]"}
      onClose={onCancel}
      onConfirm={handleConfirm}
      confirmLabel={showOriginWarning ? "Delete from Origin" : config.confirmLabel}
      disableConfirm={mode === "create" ? !branchName.trim() : !branchName}
      variant={config.variant === "danger" ? "danger" : "default"}
    >
      {mode !== "create" && (
        <div className="text-[10px] font-mono text-[var(--text-muted)] bg-[var(--bg-app)]/50 rounded-lg px-3 py-2 border border-[var(--border-color)]/50">
          <span className="opacity-60">Current branch: </span>
          <span className="text-[var(--accent-color)] font-bold">{currentBranch}</span>
        </div>
      )}

      <div>
        <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono block mb-1.5">
          {config.label}
        </label>
        {mode === "create" ? (
          <input
            ref={inputRef}
            type="text"
            value={branchName}
            onChange={(e) => { setBranchName(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirm();
            }}
            placeholder={config.placeholder}
            className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-xs font-mono text-[var(--text-light)] focus:border-[var(--accent-color)] focus:outline-none"
          />
        ) : mode === "delete" ? (
          <div className="space-y-2 max-h-[260px] overflow-y-auto bg-[var(--bg-app)]/50 border border-[var(--border-color)] rounded-lg p-2">
            {localBranches.length > 0 && (
              <div>
                <div className="px-2.5 pt-1 pb-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)] select-none">
                  Local
                </div>
                <div className="space-y-0.5">
                  {localBranches.map(renderBranchRow)}
                </div>
              </div>
            )}
            {remoteBranches.length > 0 && (
              <div>
                <div className="px-2.5 pt-1 pb-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)] select-none">
                  Origin
                </div>
                <div className="space-y-0.5">
                  {remoteBranches.map(renderBranchRow)}
                </div>
              </div>
            )}
            {localBranches.length === 0 && remoteBranches.length === 0 && (
              <div className="px-2.5 py-1.5 text-[var(--text-muted)] text-center italic text-[11px]">
                No branches available
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-0.5 max-h-[200px] overflow-y-auto bg-[var(--bg-app)]/50 border border-[var(--border-color)] rounded-lg p-2">
            {localBranches.filter(b => b !== currentBranch).map((b) => (
              <div
                key={b}
                onClick={() => { setBranchName(b); setError(null); }}
                className={`flex items-center px-2.5 py-1.5 rounded-md cursor-pointer text-xs font-mono transition-colors ${
                  branchName === b
                    ? "bg-[var(--accent-bg)] text-[var(--accent-color)] font-semibold"
                    : "hover:bg-[var(--bg-app)] text-[var(--text-normal)]"
                }`}
              >
                <GitBranch size={12} className="mr-2 flex-shrink-0" />
                <span className="truncate">{b}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {mode === "create" && (
        <label className="flex items-center space-x-2 cursor-pointer text-xs text-[var(--text-normal)]">
          <input
            type="checkbox"
            checked={checkoutAfter}
            onChange={(e) => setCheckoutAfter(e.target.checked)}
            className="accent-[var(--accent-color)]"
          />
          <span>Checkout after creation</span>
        </label>
      )}

      {showLocalDeleteOptions && (
        <label className="flex items-center space-x-2 cursor-pointer text-xs text-[var(--text-normal)]">
          <input
            type="checkbox"
            checked={forceDelete}
            onChange={(e) => setForceDelete(e.target.checked)}
            className="accent-rose-500"
          />
          <span>Force delete (<span className="font-mono text-[var(--color-status-danger)]">-D</span>) — even if not merged</span>
        </label>
      )}

      {showOriginWarning && (
        <div className="flex items-start space-x-2 text-xs text-[var(--color-status-danger)] font-mono bg-[var(--color-status-danger-bg)] border border-[var(--color-status-danger-border)] rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5 text-[var(--color-status-danger)]" />
          <span className="leading-relaxed">
            This will permanently delete <span className="font-bold text-[var(--color-status-danger)]">{branchName}</span> from the remote origin via <span className="font-bold">push --delete</span>. This action cannot be undone.
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-center space-x-2 text-xs text-[var(--color-status-danger)] font-mono">
          <AlertCircle size={12} />
          <span>{error}</span>
        </div>
      )}
    </Modal>
  );
};
