import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { GitBranch, GitMerge, GitPullRequest, X, Check, AlertCircle } from "lucide-react";

interface BranchDialogProps {
  mode: "create" | "merge" | "rebase";
  currentBranch: string;
  branches: string[];
  onConfirm: (branchName: string, extra?: boolean) => void;
  onCancel: () => void;
}

export const BranchDialog: React.FC<BranchDialogProps> = ({ mode, currentBranch, branches, onConfirm, onCancel }) => {
  const [branchName, setBranchName] = useState("");
  const [checkoutAfter, setCheckoutAfter] = useState(true);
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
    },
    merge: {
      icon: GitMerge,
      title: "Merge Branch",
      placeholder: "",
      label: "Merge into current branch",
      confirmLabel: "Merge",
      needsInput: false,
    },
    rebase: {
      icon: GitPullRequest,
      title: "Rebase",
      placeholder: "",
      label: "Rebase current branch onto",
      confirmLabel: "Rebase",
      needsInput: false,
    },
  }[mode];

  const handleConfirm = () => {
    const name = branchName.trim();
    if (mode === "create") {
      if (!name) {
        setError("Branch name is required");
        return;
      }
      if (branches.includes(name)) {
        setError("Branch already exists");
        return;
      }
      onConfirm(name, checkoutAfter);
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

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl shadow-2xl w-[440px] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)]">
          <div className="flex items-center space-x-2">
            <config.icon size={16} className="text-[var(--accent-color)]" />
            <span className="text-sm font-bold text-[var(--text-light)]">{config.title}</span>
          </div>
          <button onClick={onCancel} className="text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
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
                  if (e.key === "Escape") onCancel();
                }}
                placeholder={config.placeholder}
                className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-xs font-mono text-[var(--text-light)] focus:border-[var(--accent-color)] focus:outline-none"
              />
            ) : (
              <div className="space-y-0.5 max-h-[200px] overflow-y-auto bg-[var(--bg-app)]/50 border border-[var(--border-color)] rounded-lg p-2">
                {branches.filter(b => b !== currentBranch).map((b) => (
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

          {error && (
            <div className="flex items-center space-x-2 text-xs text-rose-400 font-mono">
              <AlertCircle size={12} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-2 px-5 py-3 border-t border-[var(--border-color)]">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-light)] rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={mode === "create" ? !branchName.trim() : !branchName}
            className="flex items-center space-x-1.5 px-4 py-1.5 bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors"
          >
            <Check size={13} />
            <span>{config.confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};