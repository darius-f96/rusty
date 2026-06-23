import React, { useState } from "react";
import { Folder, FolderOpen, FileCode, ChevronDown, ChevronRight } from "lucide-react";
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

export const FileTree: React.FC<FileTreeProps> = ({ entries }) => {
  return (
    <div className="space-y-1 select-none font-mono text-sm text-gray-300">
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
      <div>
        <div
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center px-2 py-1 rounded cursor-pointer hover:bg-zinc-800/50 transition-colors"
        >
          <span className="mr-1 text-gray-500">
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span className="mr-2 text-indigo-400">
            {isOpen ? <FolderOpen size={16} /> : <Folder size={16} />}
          </span>
          <span className="truncate">{node.name}</span>
        </div>
        {isOpen && node.children && (
          <div className="pl-4 border-l border-zinc-800/60 ml-3 mt-1 space-y-1">
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
      draggable
      onDragStart={handleDragStart}
      onDoubleClick={handleDoubleClick}
      className="flex items-center px-2 py-1 ml-5 rounded cursor-grab active:cursor-grabbing hover:bg-zinc-800/80 hover:text-white transition-colors border border-transparent hover:border-zinc-700/50"
    >
      <span className="mr-2 text-emerald-400">
        <FileCode size={16} />
      </span>
      <span className="truncate">{node.name}</span>
    </div>
  );
};
