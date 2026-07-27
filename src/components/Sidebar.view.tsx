import React from "react";
import { ChevronLeft, FoldHorizontal, RefreshCw } from "lucide-react";
import { FileTree } from "./FileTree";
import { SourceControl } from "./SourceControl";
import type {
  SidebarHelpers,
  SidebarIconItem,
  SidebarStoreState,
} from "./sidebar/SidebarPresenter";
import styles from "./Sidebar.module.css";

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
      className={`${styles.root} side-pane`}
      style={{ width: `${isExplorerOpen ? sidebarWidth : 56}px` }}
    >
      {/* 1. Left Icon Dock (Activity Bar) */}
      <div className={`${styles.dock} ${!isExplorerOpen ? styles.dockCollapsed : ""}`}>
        <div className={styles.dockGroup}>
          {topIcons.map((item) => {
            const Icon = item.icon;
            const active = isItemActive(item.id);
            const badge = item.badgeCount ? item.badgeCount(store) : 0;
            const badgeText = item.badgeText?.(store);
            return (
              <button
                key={item.id}
                id={`sidebar-${item.id}`}
                type="button"
                onClick={() => item.onClick(store, helpers)}
                className={`${styles.dockButton} ${active ? styles.dockButtonActive : ""}`}
                aria-label={item.label}
              >
                <Icon size={20} />
                {badge > 0 && (
                  <span className={styles.badge}>
                    {badge}
                  </span>
                )}
                {badgeText && (
                  <span className={styles.badgeText}>
                    {badgeText}
                  </span>
                )}
                <span className={styles.tooltip}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Bottom General Settings Icon */}
        <div className={`${styles.dockGroup} ${styles.dockBottom}`}>
          {[helpIcon, settingsIcon].filter((item): item is SidebarIconItem => !!item).map((item) => {
            const Icon = item.icon;
            const active = isItemActive(item.id);
            return (
              <button
                key={item.id}
                id={`sidebar-${item.id}`}
                type="button"
                onClick={() => item.onClick(store, helpers)}
                className={`${styles.dockButton} ${active ? styles.dockButtonActive : ""}`}
                aria-label={item.label}
              >
                <Icon size={20} />
                <span className={styles.tooltip}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Sidebar View Panel Container */}
      {isExplorerOpen && (
        <div className={styles.panel}>
          {sidebarView === "explorer" ? (
            <>
              {/* Dynamic Explorer Sidebar Tree */}
              <div className={styles.explorer}>
                <div className={styles.explorerHeader}>
                  <span className={styles.title}>Project Explorer</span>
                  <div className={styles.tools}>
                    <button
                      id="explorer-refresh"
                      type="button"
                      onClick={handleRefreshExplorer}
                      className={styles.toolButton}
                      title="Refresh Explorer"
                    >
                      <RefreshCw size={12} />
                    </button>
                    <button
                      id="explorer-collapse-all"
                      type="button"
                      onClick={handleCollapseAllFolders}
                      className={styles.toolButton}
                      title="Collapse All Folders"
                    >
                      <FoldHorizontal size={12} />
                    </button>
                    <button
                      id="explorer-collapse-sidebar"
                      type="button"
                      onClick={handleCollapseSidebar}
                      className={styles.toolButton}
                      title="Collapse Sidebar"
                    >
                      <ChevronLeft size={12} />
                    </button>
                  </div>
                </div>
                {fileTree.length === 0 ? (
                  <div className={styles.empty}>
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
          className={styles.resizer}
        />
      )}
    </div>
  );
};
