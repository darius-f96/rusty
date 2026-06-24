import React, { useState } from "react";
import { Folder, Cpu, Settings, FolderOpen } from "lucide-react";
import { useWorkspaceStore } from "../store";
import { FileTree } from "./FileTree";
import { invoke } from "@tauri-apps/api/core";
import { AxiomIcon } from "./AxiomIcon";

interface SidebarProps {
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  onSidebarMouseDown: (e: React.MouseEvent) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sidebarWidth,
  setSidebarWidth,
  onSidebarMouseDown,
}) => {
  const setRootPath = useWorkspaceStore((state) => state.setRootPath);
  const fileTree = useWorkspaceStore((state) => state.fileTree);
  const setFileTree = useWorkspaceStore((state) => state.setFileTree);
  const openTab = useWorkspaceStore((state) => state.openTab);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);

  const [isExplorerOpen, setIsExplorerOpen] = useState(true);
  const [lastWidth, setLastWidth] = useState(320);

  const loadDirectory = async (path: string) => {
    try {
      const tree: any[] = await invoke("get_directory_structure", { rootDir: path });
      setFileTree(tree);
      setRootPath(path);
    } catch (e) {
      console.error("Failed to load project directory structure:", e);
    }
  };

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
        loadDirectory(selected);
        setIsExplorerOpen(true);
      }
    } catch (err: any) {
      console.error("Failed to open directory dialog:", err);
    }
  };

  const toggleExplorer = () => {
    if (isExplorerOpen) {
      setLastWidth(sidebarWidth);
      setSidebarWidth(56); // Collapse to only activity bar width
      setIsExplorerOpen(false);
    } else {
      setSidebarWidth(lastWidth);
      setIsExplorerOpen(true);
    }
  };

  const handleAxiomClick = () => {
    openTab({
      id: "canvas",
      type: "canvas",
      title: "Axiom",
      key: "canvas",
    });
  };

  const handleLlmSetupClick = () => {
    openTab({
      id: "llm_setup",
      type: "llm-setup",
      title: "LLM Integrations",
      key: "llm-setup",
    });
  };

  const handleSettingsClick = () => {
    openTab({
      id: "settings",
      type: "settings",
      title: "Settings",
      key: "settings",
    });
  };

  return (
    <div
      className="flex h-full z-10 relative bg-[var(--bg-sidebar)] border-r border-[var(--border-color)] flex-shrink-0"
      style={{ width: `${isExplorerOpen ? sidebarWidth : 56}px` }}
    >
      {/* 1. Left Icon Dock (Activity Bar) */}
      <div className="w-14 bg-black/15 flex flex-col items-center py-4 justify-between h-full border-r border-[var(--border-color)] flex-shrink-0">
        <div className="flex flex-col items-center space-y-4 w-full">
          {/* Project Explorer Toggle */}
          <button
            onClick={toggleExplorer}
            className={`p-2.5 rounded-lg transition-all cursor-pointer relative group ${isExplorerOpen
              ? "text-[var(--accent-color)] bg-[var(--accent-bg)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--accent-bg)]/50"
              }`}
            title="Toggle File Explorer"
          >
            <Folder size={20} />
            <span className="absolute left-16 top-1/2 -translate-y-1/2 bg-zinc-950 text-[var(--text-light)] text-[10px] font-mono px-2 py-1 rounded opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-xl border border-zinc-800 whitespace-nowrap">
              File Explorer
            </span>
          </button>

          {/* Axiom Canvas */}
          <button
            onClick={handleAxiomClick}
            className={`p-2.5 rounded-lg transition-all cursor-pointer relative group ${activeTabId === "canvas"
              ? "text-[var(--accent-color)] bg-[var(--accent-bg)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--accent-bg)]/50"
              }`}
            title="Open Axiom"
          >
            <AxiomIcon size={20} />
            <span className="absolute left-16 top-1/2 -translate-y-1/2 bg-zinc-950 text-[var(--text-light)] text-[10px] font-mono px-2 py-1 rounded opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-xl border border-zinc-800 whitespace-nowrap">
              Axiom
            </span>
          </button>

          {/* LLM Integrations Setup */}
          <button
            onClick={handleLlmSetupClick}
            className={`p-2.5 rounded-lg transition-all cursor-pointer relative group ${activeTabId === "llm_setup"
              ? "text-[var(--accent-color)] bg-[var(--accent-bg)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--accent-bg)]/50"
              }`}
            title="LLM Integrations"
          >
            <Cpu size={20} />
            <span className="absolute left-16 top-1/2 -translate-y-1/2 bg-zinc-950 text-[var(--text-light)] text-[10px] font-mono px-2 py-1 rounded opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-xl border border-zinc-800 whitespace-nowrap">
              LLM Integrations
            </span>
          </button>
        </div>

        {/* Bottom General Settings Icon */}
        <button
          onClick={handleSettingsClick}
          className={`p-2.5 rounded-lg transition-all cursor-pointer relative group ${activeTabId === "settings"
            ? "text-[var(--accent-color)] bg-[var(--accent-bg)]"
            : "text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--accent-bg)]/50"
            }`}
          title="General Settings"
        >
          <Settings size={20} />
          <span className="absolute left-16 top-1/2 -translate-y-1/2 bg-zinc-950 text-[var(--text-light)] text-[10px] font-mono px-2 py-1 rounded opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-xl border border-zinc-800 whitespace-nowrap">
            General Settings
          </span>
        </button>
      </div>

      {/* 2. Explorer Panel (Toggles) */}
      {isExplorerOpen && (
        <div className="flex-1 flex flex-col h-full min-w-0">
          {/* Workspace selector */}
          <div className="p-4 border-b border-[var(--border-color)] space-y-3">
            <div className="flex items-center justify-between text-zinc-400">
              <div className="flex items-center space-x-2">
                <FolderOpen size={15} className="text-[var(--accent-color)] animate-pulse" />
                <span className="text-[10px] uppercase tracking-wider font-mono font-bold">Workspace</span>
              </div>
            </div>
            <div className="flex flex-col space-y-2">
              <button
                onClick={handleOpenWorkspace}
                className="w-full bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 text-white font-mono font-bold text-[10px] py-1.5 rounded-lg transition-colors shadow-lg cursor-pointer flex items-center justify-center space-x-1.5"
              >
                <FolderOpen size={12} />
                <span>Open Folder</span>
              </button>
            </div>
          </div>

          {/* Dynamic Explorer Sidebar Tree */}
          <div className="flex-1 overflow-auto px-4 py-3 min-w-0">
            <div className="flex items-center justify-between mb-3 text-zinc-400">
              <span className="text-[10px] uppercase tracking-wider font-mono font-bold">Project Explorer</span>
              <span className="text-[9px] text-[var(--text-muted)] font-mono">// Drag to canvas</span>
            </div>
            {fileTree.length === 0 ? (
              <div className="text-center py-8 text-[10px] text-[var(--text-muted)] font-mono leading-relaxed">
                No workspace loaded.
              </div>
            ) : (
              <FileTree entries={fileTree} />
            )}
          </div>
        </div>
      )}

      {/* Resizer Handle */}
      {isExplorerOpen && (
        <div
          onMouseDown={onSidebarMouseDown}
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--accent-color)]/50 active:bg-[var(--accent-color)] hover:w-1.5 transition-all z-20"
        />
      )}
    </div>
  );
};
