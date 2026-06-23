import React, { useState } from "react";
import { 
  Folder, 
  FolderOpen, 
  ChevronDown, 
  ChevronRight,
  File,
  FileCode,
  FileJson,
  FileText,
  FileImage,
  Settings,
  FileSpreadsheet
} from "lucide-react";
import { useWorkspaceStore } from "../store";

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
}

interface FileTreeProps {
  entries: FileEntry[];
}

// Map extensions to visual colors and icon sets
const getFileIcon = (fileName: string) => {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return { icon: FileCode, color: "text-sky-400" }; // TypeScript blue
    case "js":
    case "jsx":
      return { icon: FileCode, color: "text-amber-400" }; // JavaScript yellow
    case "json":
      return { icon: FileJson, color: "text-teal-400" }; // JSON cyan
    case "md":
      return { icon: FileText, color: "text-violet-400" }; // Markdown purple
    case "css":
    case "scss":
    case "less":
      return { icon: FileCode, color: "text-rose-400" }; // Stylesheets pink
    case "html":
      return { icon: FileCode, color: "text-orange-400" }; // HTML orange
    case "rs":
      return { icon: FileCode, color: "text-amber-600" }; // Rust orange-red
    case "svg":
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
      return { icon: FileImage, color: "text-fuchsia-400" }; // Images magenta
    case "toml":
    case "yaml":
    case "yml":
    case "env":
    case "config":
    case "conf":
    case "lock":
      return { icon: Settings, color: "text-zinc-400" }; // Config grey
    case "csv":
    case "xlsx":
      return { icon: FileSpreadsheet, color: "text-emerald-400" }; // Sheets emerald
    default:
      return { icon: File, color: "text-zinc-500" }; // Default grey
  }
};

export const FileTree: React.FC<FileTreeProps> = ({ entries }) => {
  return (
    <div className="space-y-0.5 select-none font-sans text-xs text-zinc-300 w-full min-w-max">
      {entries.map((entry) => (
        <FileTreeNode key={entry.path} node={entry} />
      ))}
    </div>
  );
};

const FileTreeNode: React.FC<{ node: any }> = ({ node }) => {
  const [isOpen, setIsOpen] = useState(false);
  const openTab = useWorkspaceStore((state) => state.openTab);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("application/reactflow-file-path", node.path);
    e.dataTransfer.setData("application/reactflow-file-name", node.name);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDoubleClick = () => {
    openTab({
      id: `file_${node.path.replace(/[^a-zA-Z0-9]/g, "_")}`,
      type: "file",
      title: node.name,
      key: node.path
    });
  };

  if (node.is_dir) {
    return (
      <div className="w-full">
        <div
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center py-1 px-1.5 hover:bg-zinc-800/40 active:bg-zinc-800/60 cursor-pointer text-zinc-300 hover:text-zinc-200 transition-colors font-sans text-xs w-full"
        >
          <span className="mr-1 text-zinc-500 flex-shrink-0">
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span className="mr-1.5 text-indigo-400 flex-shrink-0">
            {isOpen ? <FolderOpen size={14} /> : <Folder size={14} />}
          </span>
          <span className="truncate pr-2">{node.name}</span>
        </div>
        {isOpen && node.children && (
          <div className="pl-3 border-l border-zinc-800/60 ml-2 mt-0.5 space-y-0.5">
            {node.children.map((child: any) => (
              <FileTreeNode key={child.path} node={child} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const { icon: FileIcon, color: iconColor } = getFileIcon(node.name);

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDoubleClick={handleDoubleClick}
      className="flex items-center py-1 px-1.5 pl-6 hover:bg-zinc-800/60 text-zinc-300 hover:text-white transition-colors cursor-grab active:cursor-grabbing font-sans text-xs w-full border border-transparent hover:border-zinc-800/30"
    >
      <span className={`mr-1.5 flex-shrink-0 ${iconColor}`}>
        <FileIcon size={14} />
      </span>
      <span className="truncate pr-2">{node.name}</span>
    </div>
  );
};
