import React from "react";
import { ChevronLeft, FoldHorizontal, RefreshCw } from "lucide-react";
import { FileTree } from "./FileTree";
import { SourceControl } from "./SourceControl";
import type {
  SidebarHelpers,
  SidebarIconItem,
  SidebarStoreState,
} from "./sidebar/SidebarPresenter";

interface SidebarViewProps {
  sidebarWidth: number;
  isExplorerOpen: boolean;
  sidebarView: "explorer" | "git";
  fileTree: any[];
  containerRef?: React.RefObject<HTMLDivElement | null>;
  topIcons: SidebarIconItem[];
  helpIcon?: SidebarIconItem;
  settingsIcon?: SidebarIconItem;
  store: SidebarStoreState;
  helpers: SidebarHelpers;
  isItemActive: (id: string) => boolean;
  handleRefreshExplorer: () => void;
  handleCollapseAllFolders: () => void;
  handleCollapseSidebar: () => void;
  onSidebarMouseDown: (e: React.MouseEvent) => void;
}

export const SidebarView: React.FC<SidebarViewProps> = ({
  sidebarWidth,
  isExplorerOpen,
  sidebarView,
  fileTree,
  containerRef,
  topIcons,
  helpIcon,
  settingsIcon,
  store,
  helpers,
  isItemActive,
  handleRefreshExplorer,
  handleCollapseAllFolders,
  handleCollapseSidebar,
  onSidebarMouseDown,
}) => {
  return (
    <div
      ref={containerRef}
      className="flex h-full z-10 relative bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-[20px] shadow-lg flex-shrink-0 side-pane"
      style={{ width: `${isExplorerOpen ? sidebarWidth : 56}px` }}
    >
      {/* 1. Left Icon Dock (Activity Bar) */}
      <div className={`w-14 bg-[var(--color-surface-sunken)] flex flex-col items-center py-4 justify-between h-full border-r border-[var(--border-color)] flex-shrink-0 rounded-l-[19px] relative z-20 ${!isExplorerOpen ? "rounded-r-[19px]" : ""}`}>
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
                  <span className="absolute top-1 right-1 bg-[var(--color-status-info-solid)] text-[var(--color-status-info-solid-foreground)] font-mono text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border border-[var(--bg-sidebar)] shadow-md select-none">
                    {badge}
                  </span>
                )}
                <span className="absolute left-16 top-1/2 -translate-y-1/2 bg-[var(--color-surface-sunken)] text-[var(--text-light)] text-[10px] font-mono px-2 py-1 rounded opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-xl border border-[var(--color-border-subtle)] whitespace-nowrap">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Bottom General Settings Icon */}
        <div className="flex flex-col items-center gap-2">
          {[helpIcon, settingsIcon].filter((item): item is SidebarIconItem => !!item).map((item) => {
            const Icon = item.icon;
            const active = isItemActive(item.id);
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
                <span className="absolute left-16 top-1/2 -translate-y-1/2 bg-[var(--color-surface-sunken)] text-[var(--text-light)] text-[10px] font-mono px-2 py-1 rounded opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-xl border border-[var(--color-border-subtle)] whitespace-nowrap">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Sidebar View Panel Container */}
      {isExplorerOpen && (
        <div className="flex-1 flex flex-col h-full min-w-0 rounded-r-[19px] overflow-hidden">
          {sidebarView === "explorer" ? (
            <>
              {/* Dynamic Explorer Sidebar Tree */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 min-w-0">
                <div className="sticky top-0 z-10 flex items-center justify-between mb-3 text-[var(--color-fg-default)] border-b border-[var(--border-color)]/30 pb-2 bg-[var(--bg-sidebar)]">
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
