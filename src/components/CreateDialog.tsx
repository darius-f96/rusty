import React, { useState, useEffect, useRef } from "react";
import { FilePlus, FolderPlus } from "lucide-react";
import { Modal } from "./Modal";

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

  return (
    <Modal
      title={`New ${type === "file" ? "File" : "Folder"}`}
      icon={Icon}
      onClose={onCancel}
      onConfirm={handleCreate}
      confirmLabel="Create"
      disableConfirm={!name.trim()}
      width="w-[420px]"
    >
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
          }}
          placeholder={type === "file" ? "e.g. component.tsx" : "e.g. components"}
          className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-xs font-mono text-[var(--text-light)] focus:border-[var(--accent-color)] focus:outline-none"
        />
      </div>
    </Modal>
  );
};
