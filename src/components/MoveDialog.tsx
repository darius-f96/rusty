import React, { useState, useEffect, useRef, useMemo } from "react";
import { Folder, FolderOpen, ChevronDown, ChevronRight, Move, Check } from "lucide-react";
import { Modal } from "./Modal";

interface MoveDialogProps {
  node: { name: string; path: string; is_dir: boolean };
  fileTree: any[];
  onMove: (destPath: string) => void;
  onCancel: () => void;
}

function getParentsForPath(path: string): string[] {
  const parts = path.split("/");
  const parents: string[] = [];
  let current = "";
  for (let i = 0; i < parts.length; i++) {
    current = current ? `${current}/${parts[i]}` : parts[i];
    parents.push(current);
  }
  return parents;
}

export const MoveDialog: React.FC<MoveDialogProps> = ({ node, fileTree, onMove, onCancel }) => {
  const parentDir = node.path.substring(0, node.path.lastIndexOf("/"));
  const [destPath, setDestPath] = useState(parentDir);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const treeScrollRef = useRef<HTMLDivElement>(null);

  const allDirs = useMemo(() => {
    const result: { path: string; name: string }[] = [];
    function traverse(entries: any[]) {
      for (const e of entries) {
        if (e.is_dir) {
          result.push({ path: e.path, name: e.name });
          if (e.children) traverse(e.children);
        }
      }
    }
    traverse(fileTree);
    return result;
  }, [fileTree]);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    return new Set(getParentsForPath(parentDir));
  });

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      const len = inputRef.current.value.length;
      inputRef.current.setSelectionRange(len, len);
    }
  }, []);

  useEffect(() => {
    if (treeScrollRef.current) {
      const selected = treeScrollRef.current.querySelector("[data-selected='true']");
      if (selected) {
        selected.scrollIntoView({ block: "center" });
      }
    }
  }, [expandedFolders]);

  const suggestions = useMemo(() => {
    if (!destPath) return [];
    const trimmed = destPath.trim().toLowerCase();
    return allDirs
      .filter(d => {
        if (d.path === node.path || d.path.startsWith(node.path + "/")) return false;
        if (trimmed.endsWith("/")) {
          return d.path.toLowerCase().startsWith(trimmed);
        }
        const lastSlash = d.path.lastIndexOf("/");
        const dirName = lastSlash >= 0 ? d.path.substring(lastSlash + 1) : d.path;
        return d.path.toLowerCase().startsWith(trimmed) || dirName.toLowerCase().includes(trimmed.split("/").pop() || "");
      })
      .slice(0, 10);
  }, [destPath, allDirs, node.path]);

  const handleMove = () => {
    const trimmed = destPath.trim();
    if (!trimmed) return;
    const fileName = node.path.split("/").pop() || "";
    const fullDest = trimmed.endsWith(fileName) ? trimmed : `${trimmed}/${fileName}`;
    onMove(fullDest);
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderFolderTree = (entries: any[], depth: number = 0): React.ReactNode => {
    return entries
      .filter((e: any) => e.is_dir)
      .map((entry: any) => {
        const isExpanded = expandedFolders.has(entry.path);
        const isSelected = destPath === entry.path;
        const childDirs = (entry.children || []).filter((c: any) => c.is_dir);
        return (
          <div key={entry.path}>
            <div
              data-selected={isSelected}
              onClick={() => setDestPath(entry.path)}
              className={`flex items-center px-2 py-1 rounded-md cursor-pointer transition-colors text-xs ${
                isSelected
                  ? "bg-[var(--accent-bg)] text-[var(--accent-color)]"
                  : "hover:bg-[var(--bg-app)] text-[var(--text-normal)]"
              }`}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
            >
              <span
                onClick={(e) => { e.stopPropagation(); toggleFolder(entry.path); }}
                className="mr-1 text-[var(--text-muted)] flex-shrink-0 cursor-pointer w-3 flex justify-center"
              >
                {childDirs.length > 0 ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
              </span>
              <span className="mr-1 text-[var(--accent-color)] flex-shrink-0">
                {isExpanded ? <FolderOpen size={12} /> : <Folder size={12} />}
              </span>
              <span className="truncate">{entry.name}</span>
            </div>
            {isExpanded && childDirs.length > 0 && (
              <div>{renderFolderTree(entry.children, depth + 1)}</div>
            )}
          </div>
        );
      });
  };

  const truncatePathStart = (path: string, maxLen: number = 60) => {
    if (path.length <= maxLen) return path;
    return "…" + path.substring(path.length - maxLen + 1);
  };

  return (
    <Modal
      title={`Move ${node.is_dir ? "Folder" : "File"}`}
      icon={Move}
      onClose={onCancel}
      width="w-[520px]"
      scrollable
      footer={
        <div className="flex items-center justify-end space-x-2 px-5 py-3 border-t border-[var(--border-color)]">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-light)] rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleMove}
            disabled={!destPath.trim()}
            className="flex items-center space-x-1.5 px-4 py-1.5 bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 disabled:opacity-40 text-[var(--color-primary-foreground)] text-xs font-bold rounded-lg transition-colors"
          >
            <Check size={13} />
            <span>Move</span>
          </button>
        </div>
      }
    >
          {/* Current path info */}
          <div className="text-[10px] font-mono text-[var(--text-muted)] truncate" title={node.path}>
            <span className="opacity-60">Current: </span>
            <span className="text-[var(--text-normal)]">{truncatePathStart(node.path)}</span>
          </div>

          {/* Destination input with suggestions */}
          <div className="relative">
            <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono block mb-1.5">
              Destination folder
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={destPath}
                onChange={(e) => { setDestPath(e.target.value); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleMove();
                }}
                placeholder="Type a path or select from tree below..."
                className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-xs font-mono text-[var(--text-light)] focus:border-[var(--accent-color)] focus:outline-none"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute left-0 right-0 mt-1 bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg shadow-2xl z-[100] max-h-40 overflow-y-auto">
                  {suggestions.map((s) => (
                    <div
                      key={s.path}
                      onMouseDown={(e) => { e.preventDefault(); setDestPath(s.path); setShowSuggestions(false); }}
                      className="px-3 py-1.5 hover:bg-[var(--accent-bg)] cursor-pointer text-xs font-mono text-[var(--text-normal)] truncate"
                      title={s.path}
                    >
                      {truncatePathStart(s.path)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Folder tree */}
          <div className="overflow-y-auto bg-[var(--bg-app)]/50 border border-[var(--border-color)] rounded-lg p-2 min-h-[120px] max-h-[240px]" ref={treeScrollRef}>
            <div className="text-[10px] text-[var(--text-muted)] uppercase font-bold mb-2 px-1">Browse folders</div>
            {renderFolderTree(fileTree)}
          </div>

          {/* Preview */}
          {destPath && (
            <div className="text-[10px] font-mono text-[var(--text-muted)] bg-[var(--bg-app)]/50 rounded-lg px-3 py-2 border border-[var(--border-color)]/50">
              <span className="opacity-60">Will move to: </span>
              <span className="text-[var(--accent-color)]" title={destPath.trim().endsWith(node.name) ? destPath.trim() : `${destPath.trim()}/${node.name}`}>
                {truncatePathStart(destPath.trim().endsWith(node.name) ? destPath.trim() : `${destPath.trim()}/${node.name}`)}
              </span>
            </div>
          )}
    </Modal>
  );
};