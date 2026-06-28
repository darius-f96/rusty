import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { 
  Folder, 
  FolderOpen, 
  ChevronDown, 
  ChevronRight,
  Plus,
  FolderPlus,
  Trash2,
  Pencil,
  FolderInput,
  ExternalLink,
  FilePlus
} from "lucide-react";
import { useWorkspaceStore } from "../store";
import { FileIcon } from "../services/fileTypeService";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { MoveDialog } from "./MoveDialog";
import { CreateDialog } from "./CreateDialog";
import { notify } from "../notificationStore";

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
}

interface FileTreeProps {
  entries: FileEntry[];
}

interface GitState {
  colorClass: string;
  char: string;
  label: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: any;
}

const getGitState = (node: any, gitStatus: any): GitState | null => {
  if (!gitStatus) return null;
  
  if (node.is_dir) {
    const hasUnstaged = gitStatus.unstaged.some((f: any) => f.path.startsWith(node.path + "/"));
    const hasStaged = gitStatus.staged.some((f: any) => f.path.startsWith(node.path + "/"));
    
    if (hasUnstaged && hasStaged) {
      return { colorClass: "text-amber-400/80", char: "•", label: "Modified & Staged contents" };
    }
    if (hasUnstaged) {
      const isUntrackedOnly = !gitStatus.unstaged.some((f: any) => f.path.startsWith(node.path + "/") && f.status_type !== "untracked");
      if (isUntrackedOnly) {
        return { colorClass: "text-emerald-400/75", char: "•", label: "Untracked contents" };
      }
      return { colorClass: "text-amber-400/80", char: "•", label: "Modified contents" };
    }
    if (hasStaged) {
      return { colorClass: "text-emerald-400/75", char: "•", label: "Staged contents" };
    }
    return null;
  } else {
    const staged = gitStatus.staged.find((f: any) => f.path === node.path);
    const unstaged = gitStatus.unstaged.find((f: any) => f.path === node.path);

    if (staged && unstaged) {
      return { colorClass: "text-amber-400 font-bold", char: "M", label: "Staged & Modified" };
    }
    if (unstaged) {
      if (unstaged.status_type === "untracked") {
        return { colorClass: "text-emerald-400 opacity-90", char: "U", label: "Untracked" };
      }
      return { colorClass: "text-amber-400 font-semibold", char: "M", label: "Modified" };
    }
    if (staged) {
      if (staged.status_type === "added") {
        return { colorClass: "text-emerald-400 font-bold", char: "A", label: "Staged Added" };
      }
      return { colorClass: "text-sky-400 font-bold", char: "A", label: "Staged" };
    }
    return null;
  }
};

async function refreshTree() {
  const state = useWorkspaceStore.getState();
  if (state.rootPath) {
    const tree: any[] = await invoke("get_directory_structure", { rootDir: state.rootPath });
    state.setFileTree(tree);
    state.loadGitStatus();
  }
}

export const FileTree: React.FC<FileTreeProps> = ({ entries }) => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [moveDialogNode, setMoveDialogNode] = useState<any | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [createDialog, setCreateDialog] = useState<{ type: "file" | "folder"; dir: string; name: string } | null>(null);

  const handleDropOnRoot = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rootPath = useWorkspaceStore.getState().rootPath;
    if (!rootPath) return;

    try {
      const dataStr = e.dataTransfer.getData("text/plain");
      if (!dataStr) return;
      const dragData = JSON.parse(dataStr);
      if (!dragData.path) return;

      const srcPath = dragData.path;
      const fileName = srcPath.split("/").pop() || "";
      const destPath = `${rootPath}/${fileName}`;
      if (srcPath === destPath) return;

      await invoke("move_file_or_dir", { src: srcPath, dest: destPath });
      await refreshTree();
    } catch (err: any) {
      console.error("Failed to move file to root:", err);
      notify("Move failed", `Move failed: ${err}`, "error");
    }
  };

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-context-menu]")) return;
      setContextMenu(null);
    };
    if (contextMenu) {
      document.addEventListener("mousedown", handleOutsideClick);
      return () => document.removeEventListener("mousedown", handleOutsideClick);
    }
  }, [contextMenu]);

  const handleContextMenu = (e: React.MouseEvent, node: any) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  };

  const handleMove = async (destPath: string) => {
    if (!moveDialogNode) return;
    const originalPath = moveDialogNode.path;
    try {
      await invoke("move_file_or_dir", { src: originalPath, dest: destPath });
      await refreshTree();
      const state = useWorkspaceStore.getState();
      state.closeTab(`file_${originalPath.replace(/[^a-zA-Z0-9]/g, "_")}`);
      // Track for undo
      state.setLastRename({ originalPath, newPath: destPath });
      state.loadGitStatus();
    } catch (err: any) {
      notify("Move failed", `Move failed: ${err}`, "error");
    }
    setMoveDialogNode(null);
  };

  const handleDelete = async (node: any) => {
    const confirmDelete = window.confirm(`Are you sure you want to permanently delete "${node.name}"?`);
    if (!confirmDelete) return;
    try {
      await invoke("delete_file_or_dir", { path: node.path });
      await refreshTree();
      const state = useWorkspaceStore.getState();
      state.closeTab(`file_${node.path.replace(/[^a-zA-Z0-9]/g, "_")}`);
    } catch (err: any) {
      notify("Delete failed", `Delete failed: ${err}`, "error");
    }
  };

  const handleOpenInFinder = async (node: any) => {
    try {
      await revealItemInDir(node.path);
    } catch (err: any) {
      notify("Error", `Failed to open in Finder: ${err}`, "error");
    }
  };

  const handleNewFileFromMenu = (node: any) => {
    const targetDir = node.is_dir ? node.path : node.path.substring(0, node.path.lastIndexOf("/"));
    const dirName = node.is_dir ? node.name : targetDir.split("/").pop() || "folder";
    setCreateDialog({ type: "file", dir: targetDir, name: dirName });
  };

  const handleNewFolderFromMenu = (node: any) => {
    const targetDir = node.is_dir ? node.path : node.path.substring(0, node.path.lastIndexOf("/"));
    const dirName = node.is_dir ? node.name : targetDir.split("/").pop() || "folder";
    setCreateDialog({ type: "folder", dir: targetDir, name: dirName });
  };

  const handleCreate = async (name: string) => {
    if (!createDialog) return;
    const { type, dir } = createDialog;
    try {
      if (type === "file") {
        await invoke("create_file", { path: `${dir}/${name}` });
      } else {
        await invoke("create_directory", { path: `${dir}/${name}` });
      }
      await refreshTree();
      const state = useWorkspaceStore.getState();
      state.setPathExpanded(dir, true);
    } catch (err: any) {
      notify("Create failed", `Create ${type} failed: ${err}`, "error");
    }
    setCreateDialog(null);
  };

  return (
    <div 
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDropOnRoot}
      className="space-y-[1px] select-none font-sans text-xs text-[var(--text-normal)] w-full min-h-[300px] overflow-hidden"
    >
      {entries.map((entry) => (
        <FileTreeNode 
          key={entry.path} 
          node={entry} 
          onContextMenu={handleContextMenu}
          renamingPath={renamingPath}
          onRenameComplete={() => setRenamingPath(null)}
          onCreateRequest={(type, dir, name) => setCreateDialog({ type, dir, name })}
        />
      ))}

      {/* Context Menu */}
      {contextMenu && (
        <FileTreeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          onMove={() => { setMoveDialogNode(contextMenu.node); setContextMenu(null); }}
          onDelete={() => { handleDelete(contextMenu.node); setContextMenu(null); }}
          onOpenInFinder={() => { handleOpenInFinder(contextMenu.node); setContextMenu(null); }}
          onRename={() => { setRenamingPath(contextMenu.node.path); setContextMenu(null); }}
          onNewFile={() => { handleNewFileFromMenu(contextMenu.node); setContextMenu(null); }}
          onNewFolder={() => { handleNewFolderFromMenu(contextMenu.node); setContextMenu(null); }}
        />
      )}

      {/* Move Dialog */}
      {moveDialogNode && (
        <MoveDialog
          node={moveDialogNode}
          fileTree={entries}
          onMove={handleMove}
          onCancel={() => setMoveDialogNode(null)}
        />
      )}

      {/* Create Dialog */}
      {createDialog && (
        <CreateDialog
          type={createDialog.type}
          parentDir={createDialog.dir}
          onCreate={handleCreate}
          onCancel={() => setCreateDialog(null)}
        />
      )}
    </div>
  );
};

const FileTreeContextMenu: React.FC<{
  x: number;
  y: number;
  node: any;
  onMove: () => void;
  onDelete: () => void;
  onOpenInFinder: () => void;
  onRename: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
}> = ({ x, y, onMove, onDelete, onOpenInFinder, onRename, onNewFile, onNewFolder }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      let adjX = x;
      let adjY = y;
      if (x + rect.width > window.innerWidth) adjX = window.innerWidth - rect.width - 8;
      if (y + rect.height > window.innerHeight) adjY = window.innerHeight - rect.height - 8;
      setPos({ x: adjX, y: adjY });
    }
  }, [x, y]);

  const items = [
    { icon: FilePlus, label: "New File", action: "newFile" },
    { icon: FolderPlus, label: "New Folder", action: "newFolder" },
    { type: "divider" as const },
    { icon: Pencil, label: "Rename", action: "rename" },
    { icon: FolderInput, label: "Move...", action: "move" },
    { type: "divider" as const },
    { icon: ExternalLink, label: "Reveal in Finder", action: "finder" },
    { type: "divider" as const },
    { icon: Trash2, label: "Delete", action: "delete", danger: true },
  ];

  const handleAction = (action: string) => {
    switch (action) {
      case "move": onMove(); break;
      case "delete": onDelete(); break;
      case "finder": onOpenInFinder(); break;
      case "rename": onRename(); break;
      case "newFile": onNewFile(); break;
      case "newFolder": onNewFolder(); break;
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      data-context-menu="true"
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-[9999] bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-2xl py-1 min-w-[180px] font-sans text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, idx) => {
        if (item.type === "divider") {
          return <div key={idx} className="h-px bg-[var(--border-color)]/50 my-1" />;
        }
        const Icon = (item as any).icon;
        return (
          <button
            key={idx}
            onClick={() => handleAction((item as any).action)}
            className={`w-full flex items-center space-x-2.5 px-3 py-1.5 text-left hover:bg-[var(--accent-bg)] transition-colors ${
              (item as any).danger ? "text-rose-400 hover:bg-rose-500/10" : "text-[var(--text-normal)] hover:text-[var(--text-light)]"
            }`}
          >
            <Icon size={13} className="flex-shrink-0" />
            <span>{(item as any).label}</span>
          </button>
        );
      })}
    </div>,
    document.body
  );
};

const FileTreeNode: React.FC<{ 
  node: any; 
  onContextMenu: (e: React.MouseEvent, node: any) => void;
  renamingPath: string | null;
  onRenameComplete: () => void;
  onCreateRequest: (type: "file" | "folder", dir: string, name: string) => void;
}> = ({ node, onContextMenu, renamingPath, onRenameComplete, onCreateRequest }) => {
  const expandedPaths = useWorkspaceStore((state) => state.expandedPaths);
  const togglePathExpanded = useWorkspaceStore((state) => state.togglePathExpanded);
  const setPathExpanded = useWorkspaceStore((state) => state.setPathExpanded);
  const openTab = useWorkspaceStore((state) => state.openTab);
  const gitStatus = useWorkspaceStore((state) => state.gitStatus);
  const editorGroups = useWorkspaceStore((state) => state.editorGroups);
  const activeGroupId = useWorkspaceStore((state) => state.activeGroupId);
  const activeGroup = editorGroups.find((g) => g.id === activeGroupId);
  const activeTabId = activeGroup ? activeGroup.activeTabId : null;

  const [tempName, setTempName] = useState(node.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const isRenaming = renamingPath === node.path;

  const isOpen = !!expandedPaths[node.path];
  const gitState = getGitState(node, gitStatus);
  const isActiveFile = activeTabId === `file_${node.path.replace(/[^a-zA-Z0-9]/g, "_")}`;

  useEffect(() => {
    if (isRenaming) {
      setTempName(node.name);
      if (renameInputRef.current) {
        renameInputRef.current.focus();
        const dotIdx = node.name.lastIndexOf(".");
        if (dotIdx > 0 && !node.is_dir) {
          renameInputRef.current.setSelectionRange(0, dotIdx);
        } else {
          renameInputRef.current.select();
        }
      }
    }
  }, [isRenaming, node.name, node.is_dir]);

  const handleDragStart = (e: React.DragEvent) => {
    const payload = { path: node.path, name: node.name, isDir: !!node.is_dir };
    e.dataTransfer.setData("text/plain", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDoubleClick = async () => {
    if (node.path.includes("/.axiom/canvas/") && node.path.endsWith(".json")) {
      try {
        const { canvasFileService } = await import("./tabs/canvas/services/canvasFileService");
        const parsedData = await canvasFileService.loadCanvasFromFile(node.path);
        useWorkspaceStore.getState().loadCanvasTab(parsedData);
      } catch (err: any) {
        notify("Canvas error", `Failed to load canvas: ${err.message || err}`, "error");
      }
      return;
    }
    openTab({
      id: `file_${node.path.replace(/[^a-zA-Z0-9]/g, "_")}`,
      type: "file",
      title: node.name,
      key: node.path
    });
  };

  const handleRename = async () => {
    const newName = tempName.trim();
    if (!newName || newName === node.name) {
      onRenameComplete();
      return;
    }
    const parentPath = node.path.substring(0, node.path.lastIndexOf("/"));
    const newPath = `${parentPath}/${newName}`;
    try {
      await invoke("move_file_or_dir", { src: node.path, dest: newPath });
      await refreshTree();
      const state = useWorkspaceStore.getState();
      state.closeTab(`file_${node.path.replace(/[^a-zA-Z0-9]/g, "_")}`);
      // Track for undo
      state.setLastRename({ originalPath: node.path, newPath });
      state.loadGitStatus();
    } catch (err: any) {
      notify("Rename failed", `Rename failed: ${err}`, "error");
    }
    onRenameComplete();
  };

  const handleCreateFile = () => {
    onCreateRequest("file", node.path, node.name);
  };

  const handleCreateDirectory = () => {
    onCreateRequest("folder", node.path, node.name);
  };

  const handleDropOnNode = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!node.is_dir) return;
    try {
      const dataStr = e.dataTransfer.getData("text/plain");
      if (!dataStr) return;
      const dragData = JSON.parse(dataStr);
      if (!dragData.path) return;
      const srcPath = dragData.path;
      if (srcPath === node.path) return;
      const fileName = srcPath.split("/").pop() || "";
      const destPath = `${node.path}/${fileName}`;
      if (srcPath === destPath) return;
      await invoke("move_file_or_dir", { src: srcPath, dest: destPath });
      await refreshTree();
      setPathExpanded(node.path, true);
    } catch (err: any) {
      notify("Move failed", `Move failed: ${err}`, "error");
    }
  };

  const renameInput = (
    <input
      ref={renameInputRef}
      type="text"
      value={tempName}
      onChange={(e) => setTempName(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleRename();
        if (e.key === "Escape") onRenameComplete();
      }}
      onBlur={handleRename}
      className="nodrag bg-[var(--bg-app)] border border-[var(--accent-color)] rounded px-1 py-0 text-xs text-[var(--text-light)] focus:outline-none w-full"
    />
  );

  if (node.is_dir) {
    return (
      <div className="w-full">
        <div
          draggable={true}
          onDragStart={handleDragStart}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDropOnNode}
          onClick={() => !isRenaming && togglePathExpanded(node.path)}
          onContextMenu={(e) => onContextMenu(e, node)}
          style={{ WebkitUserDrag: "element" } as React.CSSProperties}
          className={`group relative flex items-center justify-between py-0.5 px-1 hover:bg-[var(--accent-bg)] active:bg-[var(--border-color)]/60 cursor-grab active:cursor-grabbing hover:text-[var(--text-light)] transition-colors font-sans text-xs w-full border border-transparent hover:border-[var(--border-color)]/20 ${gitState ? gitState.colorClass : "text-[var(--text-normal)]"}`}
        >
          <div className="flex items-center min-w-0 flex-1 mr-14">
            <span className="mr-0.5 text-[var(--text-muted)] flex-shrink-0">
              {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>
            <span className="mr-1 text-[var(--accent-color)] flex-shrink-0">
              {isOpen ? <FolderOpen size={13} className={gitState ? gitState.colorClass : ""} /> : <Folder size={13} className={gitState ? gitState.colorClass : ""} />}
            </span>
            {isRenaming ? (
              renameInput
            ) : (
              <span className="truncate pr-2">{node.name}</span>
            )}
          </div>

          <div className="flex items-center space-x-1 mr-1">
            {gitState && (
              <span className="text-[12px] font-mono font-bold opacity-85 select-none" title={gitState.label}>
                {gitState.char}
              </span>
            )}
          </div>

          {/* Folder Actions */}
          {!isRenaming && (
            <div className="absolute right-1 top-0 bottom-0 opacity-0 group-hover:opacity-100 flex items-center space-x-1.5 bg-[var(--accent-bg)] pl-2 transition-opacity">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleCreateFile(); }}
                className="p-0.5 rounded hover:bg-[var(--accent-color)]/20 text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer"
                title="New File"
              >
                <Plus size={11} />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleCreateDirectory(); }}
                className="p-0.5 rounded hover:bg-[var(--accent-color)]/20 text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer"
                title="New Folder"
              >
                <FolderPlus size={11} />
              </button>
            </div>
          )}
        </div>
        {isOpen && node.children && (
          <div className="pl-2 border-l border-[var(--border-color)]/60 ml-1.5 mt-[1px] space-y-[1px]">
            {node.children.map((child: any) => (
              <FileTreeNode key={child.path} node={child} onContextMenu={onContextMenu} renamingPath={renamingPath} onRenameComplete={onRenameComplete} onCreateRequest={onCreateRequest} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      draggable={true}
      onDragStart={handleDragStart}
      onDoubleClick={isRenaming ? undefined : handleDoubleClick}
      onContextMenu={(e) => onContextMenu(e, node)}
      style={{ WebkitUserDrag: "element" } as React.CSSProperties}
      className={`group relative flex items-center justify-between py-1 px-1.5 pl-[18px] transition-all cursor-grab active:cursor-grabbing font-sans text-xs w-full border rounded-md ${
        isActiveFile 
          ? "bg-zinc-800/40 border-zinc-700/30 text-[var(--text-light)] font-medium shadow-sm"
          : "hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] border-transparent hover:border-[var(--border-color)]/20 " + (gitState ? gitState.colorClass : "text-[var(--text-normal)]")
      }`}
    >
      <div className="flex items-center min-w-0 flex-1 mr-6">
        <FileIcon fileName={node.name} size={13} className="mr-1.5 flex-shrink-0" />
        {isRenaming ? (
          renameInput
        ) : (
          <span className="truncate pr-2">{node.name}</span>
        )}
      </div>

      <div className="flex items-center space-x-1 mr-1">
        {gitState && (
          <span className="text-[10px] font-mono font-bold opacity-90 select-none" title={gitState.label}>
            {gitState.char}
          </span>
        )}
      </div>
    </div>
  );
};