import React from "react";
import { ChevronDown, FolderOpen } from "lucide-react";
import { useWorkspaceStore } from "../store";
import { AxiomIcon } from "./AxiomIcon";

export const Header: React.FC = () => {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const folderName = rootPath ? rootPath.split(/[/\\]/).pop() || rootPath : "Select Workspace...";

  const handleOpenWorkspace = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Workspace Folder",
      });
      if (selected && typeof selected === "string") {
        console.log("Selected workspace directory:", selected);
        
        const { invoke } = await import("@tauri-apps/api/core");
        const tree: any[] = await invoke("get_directory_structure", { rootDir: selected });
        
        const store = useWorkspaceStore.getState();
        store.setFileTree(tree);
        store.setRootPath(selected);
      }
    } catch (err: any) {
      console.error("Failed to open directory dialog:", err);
    }
  };

  return (
    <header className="w-full h-14 px-6 flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-app)] select-none z-30 flex-shrink-0">
      {/* Left Area: Logo and Workspace Select */}
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-lg bg-[var(--bg-sidebar)] border border-[var(--border-color)] flex items-center justify-center text-[var(--accent-color)] shadow-md transition-all">
            <AxiomIcon size={18} className="animate-spin-slow" />
          </div>
          <span className="text-sm font-black tracking-wider text-[var(--text-light)] font-sans">
            Axiom
          </span>
        </div>

        <div 
          onClick={handleOpenWorkspace}
          className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-[var(--bg-sidebar)] border border-[var(--border-color)] hover:border-[var(--border-active)] text-xs text-[var(--text-normal)] hover:text-[var(--text-light)] font-mono transition-all cursor-pointer shadow-sm select-none"
        >
          <FolderOpen size={13} className="text-[var(--accent-color)]" />
          <span className="max-w-[200px] truncate font-medium">{folderName}</span>
          <ChevronDown size={12} className="text-[var(--text-muted)]" />
        </div>
      </div>
    </header>
  );
};
