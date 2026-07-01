import React from "react";
import { ChevronLeft, FoldHorizontal, RefreshCw } from "lucide-react";
import { useWorkspaceStore } from "../store";
import { FileTree } from "./FileTree";
import { invoke } from "@tauri-apps/api/core";
import { SourceControl } from "./SourceControl";
import { SIDEBAR_ICONS, SidebarHelpers } from "./sidebar/SidebarPresenter";

interface SidebarProps {
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  onSidebarMouseDown: (e: React.MouseEvent) => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  isExplorerOpen: boolean;
  setIsExplorerOpen: (open: boolean) => void;
  sidebarView: "explorer" | "git";
  setSidebarView: (view: "explorer" | "git") => void;
  lastWidth: number;
  setLastWidth: (width: number) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sidebarWidth,
  setSidebarWidth,
  onSidebarMouseDown,
  containerRef,
  isExplorerOpen,
  setIsExplorerOpen,
  sidebarView,
  setSidebarView,
  lastWidth,
  setLastWidth,
}) => {
  const fileTree = useWorkspaceStore((state) => state.fileTree);
  const setFileTree = useWorkspaceStore((state) => state.setFileTree);
  const editorGroups = useWorkspaceStore((state) => state.editorGroups);
  const activeGroupId = useWorkspaceStore((state) => state.activeGroupId);
  const activeGroup = editorGroups.find((g) => g.id === activeGroupId);
  const activeTabId = activeGroup ? activeGroup.activeTabId : null;
  const activeTab = activeGroup && activeGroup.openTabs.find((t) => t.id === activeTabId);
  const isActiveTabCanvas = activeTab?.type === "canvas" || activeTab?.type === "axiom";

  const helpers: SidebarHelpers = {
    isExplorerOpen,
    setIsExplorerOpen,
    sidebarView,
    setSidebarView,
    sidebarWidth,
    setSidebarWidth,
    lastWidth,
    setLastWidth,
  };

  const handleCollapseAllFolders = () => {
    useWorkspaceStore.getState().collapseAllFolders();
  };

  const handleRefreshExplorer = async () => {
    const rootPath = useWorkspaceStore.getState().rootPath;
    if (!rootPath) return;
    try {
      const tree: any[] = await invoke("get_directory_structure", { rootDir: rootPath });
      setFileTree(tree);
      await useWorkspaceStore.getState().loadGitStatus();
    } catch (err) {
      console.error("Failed to refresh explorer:", err);
    }
  };

  const handleCollapseSidebar = () => {
    setLastWidth(sidebarWidth);
    setSidebarWidth(56);
    setIsExplorerOpen(false);
  };

  const isItemActive = (id: string) => {
    switch (id) {
      case "workspace":
        return activeTabId === "workspace_select";
      case "explorer":
        return isExplorerOpen && sidebarView === "explorer";
      case "git":
        return isExplorerOpen && sidebarView === "git";
      case "axiom":
        return isActiveTabCanvas;
      case "agent":
        return activeTab?.type === "agent";
      case "llm-setup":
        return activeTabId === "llm_setup" || activeTabId === "llm-setup";
      case "skills":
        return activeTabId === "skills";
      case "mcp":
        return activeTabId === "mcp-integration";
      case "settings":
        return activeTabId === "settings";
      default:
        return false;
    }
  };

  const store = useWorkspaceStore();
  const topIcons = SIDEBAR_ICONS.filter((item) => item.id !== "settings");
  const settingsIcon = SIDEBAR_ICONS.find((item) => item.id === "settings");

  return (
    <div
      ref={containerRef}
      className="flex h-full z-10 relative bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-[20px] shadow-lg flex-shrink-0 side-pane"
      style={{ width: `${isExplorerOpen ? sidebarWidth : 56}px` }}
    >
      {/* 1. Left Icon Dock (Activity Bar) */}
      <div className={`w-14 bg-black/15 flex flex-col items-center py-4 justify-between h-full border-r border-[var(--border-color)] flex-shrink-0 rounded-l-[19px] relative z-20 ${!isExplorerOpen ? "rounded-r-[19px]" : ""}`}>
        <div className="flex flex-col items-center space-y-4 w-full">
          {topIcons.map((item) => {
            const Icon = item.icon;
            const active = isItemActive(item.id);
            const badge = item.badgeCount ? item.badgeCount(store) : 0;
            return (
              <button
                key={item.id}
                onClick={() => item.onClick(store, helpers)}
                className={`p-2.5 rounded-lg transition-all cursor-pointer relative group ${
                  active
                    ? "text-[var(--accent-color)] bg-[var(--accent-bg)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--accent-bg)]/50"
                }`}
              >
                <Icon size={20} />
                {badge > 0 && (
                  <span className="absolute top-1 right-1 bg-indigo-600 text-white font-mono text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border border-[var(--bg-sidebar)] shadow-md select-none">
                    {badge}
                  </span>
                )}
                <span className="absolute left-16 top-1/2 -translate-y-1/2 bg-zinc-950 text-[var(--text-light)] text-[10px] font-mono px-2 py-1 rounded opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-xl border border-zinc-800 whitespace-nowrap">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Bottom General Settings Icon */}
        {settingsIcon && (() => {
          const Icon = settingsIcon.icon;
          const active = isItemActive(settingsIcon.id);
          return (
            <button
              onClick={() => settingsIcon.onClick(store, helpers)}
              className={`p-2.5 rounded-lg transition-all cursor-pointer relative group ${
                active
                  ? "text-[var(--accent-color)] bg-[var(--accent-bg)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--accent-bg)]/50"
              }`}
            >
              <Icon size={20} />
              <span className="absolute left-16 top-1/2 -translate-y-1/2 bg-zinc-950 text-[var(--text-light)] text-[10px] font-mono px-2 py-1 rounded opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-xl border border-zinc-800 whitespace-nowrap">
                {settingsIcon.label}
              </span>
            </button>
          );
        })()}
      </div>

      {/* 2. Sidebar View Panel Container */}
      {isExplorerOpen && (
        <div className="flex-1 flex flex-col h-full min-w-0 rounded-r-[19px] overflow-hidden">
          {sidebarView === "explorer" ? (
            <>
              {/* Dynamic Explorer Sidebar Tree */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 min-w-0">
                <div className="sticky top-0 z-10 flex items-center justify-between mb-3 text-zinc-400 border-b border-[var(--border-color)]/30 pb-2 bg-[var(--bg-sidebar)]">
                  <span className="text-[10px] uppercase tracking-wider font-mono font-bold">Project Explorer</span>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handleRefreshExplorer}
                      className="p-1 rounded hover:bg-[var(--accent-bg)]/25 text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer"
                      title="Refresh Explorer"
                    >
                      <RefreshCw size={12} />
                    </button>
                    <button
                      onClick={handleCollapseAllFolders}
                      className="p-1 rounded hover:bg-[var(--accent-bg)]/25 text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer"
                      title="Collapse All Folders"
                    >
                      <FoldHorizontal size={12} />
                    </button>
                    <button
                      onClick={handleCollapseSidebar}
                      className="p-1 rounded hover:bg-[var(--accent-bg)]/25 text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer"
                      title="Collapse Sidebar"
                    >
                      <ChevronLeft size={12} />
                    </button>
                  </div>
                </div>
                {fileTree.length === 0 ? (
                  <div className="text-center py-8 text-[10px] text-[var(--text-muted)] font-mono leading-relaxed">
                    No workspace loaded.
                  </div>
                ) : (
                  <FileTree entries={fileTree} />
                )}
              </div>
            </>
          ) : (
            <SourceControl />
          )}
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
