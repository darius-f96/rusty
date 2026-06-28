import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { FilePlus, FolderPlus, X, Check } from "lucide-react";

interface CreateDialogProps {
  type: "file" | "folder";
  parentDir: string;
  onCreate: (name: string) => void;
  onCancel: () => void;
}

export const CreateDialog: React.FC<CreateDialogProps> = ({ type, parentDir, onCreate, onCancel }) => {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const Icon = type === "file" ? FilePlus : FolderPlus;

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed);
  };

  const truncatePathStart = (path: string, maxLen: number = 50) => {
    if (path.length <= maxLen) return path;
    return "…" + path.substring(path.length - maxLen + 1);
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl shadow-2xl w-[420px] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)]">
          <div className="flex items-center space-x-2">
            <Icon size={16} className="text-[var(--accent-color)]" />
            <span className="text-sm font-bold text-[var(--text-light)]">New {type === "file" ? "File" : "Folder"}</span>
          </div>
          <button onClick={onCancel} className="text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <div className="text-[10px] font-mono text-[var(--text-muted)]">
            <span className="opacity-60">Inside: </span>
            <span className="text-[var(--text-normal)]" title={parentDir}>{truncatePathStart(parentDir)}</span>
          </div>
          <div>
            <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono block mb-1.5">
              {type === "file" ? "File name" : "Folder name"}
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") onCancel();
              }}
              placeholder={type === "file" ? "e.g. component.tsx" : "e.g. components"}
              className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-xs font-mono text-[var(--text-light)] focus:border-[var(--accent-color)] focus:outline-none"
            />
          </div>
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
            onClick={handleCreate}
            disabled={!name.trim()}
            className="flex items-center space-x-1.5 px-4 py-1.5 bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors"
          >
            <Check size={13} />
            <span>Create</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};