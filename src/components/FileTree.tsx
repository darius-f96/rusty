import React from "react";
import { 
  Folder, 
  FolderOpen, 
  ChevronDown, 
  ChevronRight,
  Plus,
  FolderPlus,
  Trash2
} from "lucide-react";
import { useWorkspaceStore } from "../store";
import { FileIcon } from "../services/fileTypeService";
import { invoke } from "@tauri-apps/api/core";

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

const getGitState = (node: any, gitStatus: any): GitState | null => {
  if (!gitStatus) return null;
  
  if (node.is_dir) {
    const hasUnstaged = gitStatus.unstaged.some((f: any) => f.path.startsWith(node.path + "/"));
    const hasStaged = gitStatus.staged.some((f: any) => f.path.startsWith(node.path + "/"));
    
    if (hasUnstaged && hasStaged) {
      return {
        colorClass: "text-amber-400/80",
        char: "•",
        label: "Modified & Staged contents"
      };
    }
    if (hasUnstaged) {
      const isUntrackedOnly = !gitStatus.unstaged.some((f: any) => f.path.startsWith(node.path + "/") && f.status_type !== "untracked");
      if (isUntrackedOnly) {
        return {
          colorClass: "text-emerald-400/75",
          char: "•",
          label: "Untracked contents"
        };
      }
      return {
        colorClass: "text-amber-400/80",
        char: "•",
        label: "Modified contents"
      };
    }
    if (hasStaged) {
      return {
        colorClass: "text-emerald-400/75",
        char: "•",
        label: "Staged contents"
      };
    }
    return null;
  } else {
    const staged = gitStatus.staged.find((f: any) => f.path === node.path);
    const unstaged = gitStatus.unstaged.find((f: any) => f.path === node.path);

    if (staged && unstaged) {
      return {
        colorClass: "text-amber-400 font-bold",
        char: "M",
        label: "Staged & Modified"
      };
    }
    if (unstaged) {
      if (unstaged.status_type === "untracked") {
        return {
          colorClass: "text-emerald-400 opacity-90",
          char: "U",
          label: "Untracked"
        };
      }
      return {
        colorClass: "text-amber-400 font-semibold",
        char: "M",
        label: "Modified"
      };
    }
    if (staged) {
      if (staged.status_type === "added") {
        return {
          colorClass: "text-emerald-400 font-bold",
          char: "A",
          label: "Staged Added"
        };
      }
      return {
        colorClass: "text-sky-400 font-bold",
        char: "A",
        label: "Staged"
      };
    }
    return null;
  }
};

export const FileTree: React.FC<FileTreeProps> = ({ entries }) => {
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

      console.log(`FileTree: Moving ${srcPath} to root path ${destPath}`);
      await invoke("move_file_or_dir", { src: srcPath, dest: destPath });

      // Reload tree
      const state = useWorkspaceStore.getState();
      const tree: any[] = await invoke("get_directory_structure", { rootDir: state.rootPath });
      state.setFileTree(tree);
      state.loadGitStatus();
    } catch (err: any) {
      console.error("Failed to move file to root:", err);
      alert(`Move failed: ${err}`);
    }
  };

  return (
    <div 
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDropOnRoot}
      className="space-y-[1px] select-none font-sans text-xs text-[var(--text-normal)] w-full min-h-[300px] overflow-hidden"
    >
      {entries.map((entry) => (
        <FileTreeNode key={entry.path} node={entry} />
      ))}
    </div>
  );
};

const FileTreeNode: React.FC<{ node: any }> = ({ node }) => {
  const expandedPaths = useWorkspaceStore((state) => state.expandedPaths);
  const togglePathExpanded = useWorkspaceStore((state) => state.togglePathExpanded);
  const setPathExpanded = useWorkspaceStore((state) => state.setPathExpanded);
  const openTab = useWorkspaceStore((state) => state.openTab);
  const gitStatus = useWorkspaceStore((state) => state.gitStatus);
  const editorGroups = useWorkspaceStore((state) => state.editorGroups);
  const activeGroupId = useWorkspaceStore((state) => state.activeGroupId);
  const activeGroup = editorGroups.find((g) => g.id === activeGroupId);
  const activeTabId = activeGroup ? activeGroup.activeTabId : null;

  const isOpen = !!expandedPaths[node.path];
  const gitState = getGitState(node, gitStatus);
  const isActiveFile = activeTabId === `file_${node.path.replace(/[^a-zA-Z0-9]/g, "_")}`;

  const handleDragStart = (e: React.DragEvent) => {
    console.log("FileTree: handleDragStart started for:", node.name, "path:", node.path);
    const payload = {
      path: node.path,
      name: node.name,
      isDir: !!node.is_dir
    };
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
        console.error("Failed to load canvas from file:", err);
        alert(`Failed to load canvas: ${err.message || err}`);
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

  const handleDeleteNode = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmDelete = window.confirm(`Are you sure you want to permanently delete "${node.name}"? This will delete it from your disk.`);
    if (!confirmDelete) return;

    try {
      await invoke("delete_file_or_dir", { path: node.path });
      // Reload directory tree
      const state = useWorkspaceStore.getState();
      const tree: any[] = await invoke("get_directory_structure", { rootDir: state.rootPath });
      state.setFileTree(tree);
      state.loadGitStatus();
      
      // Close tab if open
      state.closeTab(`file_${node.path.replace(/[^a-zA-Z0-9]/g, "_")}`);
    } catch (err: any) {
      console.error("Failed to delete path:", err);
      alert(`Delete failed: ${err}`);
    }
  };

  const handleCreateFile = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const fileName = window.prompt(`Create new file inside "${node.name}":`);
    if (!fileName || !fileName.trim()) return;

    const newFilePath = `${node.path}/${fileName.trim()}`;
    try {
      await invoke("create_file", { path: newFilePath });
      // Reload directory tree
      const state = useWorkspaceStore.getState();
      const tree: any[] = await invoke("get_directory_structure", { rootDir: state.rootPath });
      state.setFileTree(tree);
      state.loadGitStatus();
      setPathExpanded(node.path, true); // Auto-expand folder
    } catch (err: any) {
      console.error("Failed to create file:", err);
      alert(`Create file failed: ${err}`);
    }
  };

  const handleCreateDirectory = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const dirName = window.prompt(`Create new folder inside "${node.name}":`);
    if (!dirName || !dirName.trim()) return;

    const newDirPath = `${node.path}/${dirName.trim()}`;
    try {
      await invoke("create_directory", { path: newDirPath });
      // Reload directory tree
      const state = useWorkspaceStore.getState();
      const tree: any[] = await invoke("get_directory_structure", { rootDir: state.rootPath });
      state.setFileTree(tree);
      state.loadGitStatus();
      setPathExpanded(node.path, true); // Auto-expand folder
    } catch (err: any) {
      console.error("Failed to create directory:", err);
      alert(`Create folder failed: ${err}`);
    }
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
      if (srcPath === node.path) return; // Can't drop onto itself

      const fileName = srcPath.split("/").pop() || "";
      const destPath = `${node.path}/${fileName}`;
      if (srcPath === destPath) return;

      console.log(`FileTree: Moving ${srcPath} to ${destPath}`);
      await invoke("move_file_or_dir", { src: srcPath, dest: destPath });

      // Reload tree
      const state = useWorkspaceStore.getState();
      const tree: any[] = await invoke("get_directory_structure", { rootDir: state.rootPath });
      state.setFileTree(tree);
      state.loadGitStatus();
      setPathExpanded(node.path, true); // Auto-expand target directory
    } catch (err: any) {
      console.error("Failed to move file to nested node:", err);
      alert(`Move failed: ${err}`);
    }
  };

  if (node.is_dir) {
    return (
      <div className="w-full">
        <div
          draggable={true}
          onDragStart={handleDragStart}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDropOnNode}
          onClick={() => togglePathExpanded(node.path)}
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
            <span className="truncate pr-2">{node.name}</span>
          </div>

          <div className="flex items-center space-x-1 mr-1">
            {gitState && (
              <span className="text-[12px] font-mono font-bold opacity-85 select-none" title={gitState.label}>
                {gitState.char}
              </span>
            )}
          </div>

          {/* Folder Actions (New File, New Folder, Delete) */}
          <div className="absolute right-1 top-0 bottom-0 opacity-0 group-hover:opacity-100 flex items-center space-x-1.5 bg-[var(--accent-bg)] pl-2 transition-opacity">
            <button
              type="button"
              onClick={handleCreateFile}
              className="p-0.5 rounded hover:bg-[var(--accent-color)]/20 text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer"
              title="New File Inside"
            >
              <Plus size={11} />
            </button>
            <button
              type="button"
              onClick={handleCreateDirectory}
              className="p-0.5 rounded hover:bg-[var(--accent-color)]/20 text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer"
              title="New Folder Inside"
            >
              <FolderPlus size={11} />
            </button>
            <button
              type="button"
              onClick={handleDeleteNode}
              className="p-0.5 rounded hover:bg-rose-500/20 text-[var(--text-muted)] hover:text-rose-400 transition-colors cursor-pointer"
              title="Delete Folder"
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>
        {isOpen && node.children && (
          <div className="pl-2 border-l border-[var(--border-color)]/60 ml-1.5 mt-[1px] space-y-[1px]">
            {node.children.map((child: any) => (
              <FileTreeNode key={child.path} node={child} />
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
      onDoubleClick={handleDoubleClick}
      style={{ WebkitUserDrag: "element" } as React.CSSProperties}
      className={`group relative flex items-center justify-between py-1 px-1.5 pl-[18px] transition-all cursor-grab active:cursor-grabbing font-sans text-xs w-full border rounded-md ${
        isActiveFile 
          ? "bg-zinc-800/40 border-zinc-700/30 text-[var(--text-light)] font-medium shadow-sm"
          : "hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] border-transparent hover:border-[var(--border-color)]/20 " + (gitState ? gitState.colorClass : "text-[var(--text-normal)]")
      }`}
    >
      <div className="flex items-center min-w-0 flex-1 mr-6">
        <FileIcon fileName={node.name} size={13} className="mr-1.5 flex-shrink-0" />
        <span className="truncate pr-2">{node.name}</span>
      </div>

      <div className="flex items-center space-x-1 mr-1">
        {gitState && (
          <span className="text-[10px] font-mono font-bold opacity-90 select-none" title={gitState.label}>
            {gitState.char}
          </span>
        )}
      </div>

      {/* File Actions (Delete) */}
      <div className="absolute right-1 top-0 bottom-0 opacity-0 group-hover:opacity-100 flex items-center bg-[var(--accent-bg)] pl-2 rounded-r-md transition-opacity">
        <button
          type="button"
          onClick={handleDeleteNode}
          className="p-0.5 rounded hover:bg-rose-500/20 text-[var(--text-muted)] hover:text-rose-400 transition-colors cursor-pointer"
          title="Delete File"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
};
