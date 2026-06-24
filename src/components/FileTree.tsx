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
    <div className="space-y-[1px] select-none font-sans text-xs text-[var(--text-normal)] w-full min-w-max">
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
    console.log("FileTree: handleDragStart started for:", node.name, "path:", node.path);
    const payload = {
      path: node.path,
      name: node.name,
      isDir: !!node.is_dir
    };
    e.dataTransfer.setData("text/plain", JSON.stringify(payload));
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
          draggable={true}
          onDragStart={handleDragStart}
          onClick={() => setIsOpen(!isOpen)}
          style={{ WebkitUserDrag: "element" } as React.CSSProperties}
          className="flex items-center py-0.5 px-1 hover:bg-[var(--accent-bg)] active:bg-[var(--border-color)]/60 cursor-grab active:cursor-grabbing text-[var(--text-normal)] hover:text-[var(--text-light)] transition-colors font-sans text-xs w-full border border-transparent hover:border-[var(--border-color)]/20"
        >
          <span className="mr-0.5 text-[var(--text-muted)] flex-shrink-0">
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
          <span className="mr-1 text-[var(--accent-color)] flex-shrink-0">
            {isOpen ? <FolderOpen size={13} /> : <Folder size={13} />}
          </span>
          <span className="truncate pr-2">{node.name}</span>
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
      className="flex items-center py-0.5 px-1 pl-[18px] hover:bg-[var(--accent-bg)] text-[var(--text-normal)] hover:text-[var(--text-light)] transition-colors cursor-grab active:cursor-grabbing font-sans text-xs w-full border border-transparent hover:border-[var(--border-color)]/20"
    >
      <FileIcon fileName={node.name} size={13} className="mr-1 flex-shrink-0" />
      <span className="truncate pr-2">{node.name}</span>
    </div>
  );
};
