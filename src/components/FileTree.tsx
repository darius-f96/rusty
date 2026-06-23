import React, { useState } from "react";
import { 
  Folder, 
  FolderOpen, 
  ChevronDown, 
  ChevronRight
} from "lucide-react";
import { useWorkspaceStore } from "../store";
import { FileIcon } from "../services/fileTypeService";

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
    <div className="space-y-[1px] select-none font-sans text-xs text-zinc-300 w-full min-w-max">
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
          className="flex items-center py-0.5 px-1 hover:bg-zinc-800/40 active:bg-zinc-800/60 cursor-pointer text-zinc-300 hover:text-zinc-200 transition-colors font-sans text-xs w-full"
        >
          <span className="mr-0.5 text-zinc-500 flex-shrink-0">
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
          <span className="mr-1 text-indigo-400 flex-shrink-0">
            {isOpen ? <FolderOpen size={13} /> : <Folder size={13} />}
          </span>
          <span className="truncate pr-2">{node.name}</span>
        </div>
        {isOpen && node.children && (
          <div className="pl-2 border-l border-zinc-800/60 ml-1.5 mt-[1px] space-y-[1px]">
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
      className="flex items-center py-0.5 px-1 pl-[18px] hover:bg-zinc-800/60 text-zinc-300 hover:text-white transition-colors cursor-grab active:cursor-grabbing font-sans text-xs w-full border border-transparent hover:border-zinc-800/20"
    >
      <FileIcon fileName={node.name} size={13} className="mr-1 flex-shrink-0" />
      <span className="truncate pr-2">{node.name}</span>
    </div>
  );
};
