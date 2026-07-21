import React, { RefObject } from "react";
import { X, Cpu, Settings, GitCommit, ChevronDown, FolderOpen, Columns, Wand2, BookOpen } from "lucide-react";
import { FileIcon } from "../services/fileTypeService";
import { AxiomIcon } from "./AxiomIcon";

interface TabBarViewProps {
  groupId: string;
  openTabs: any[];
  activeTabId: string | null;
  activeGroupId: string | null;
  dropdownOpen: boolean;
  setDropdownOpen: (open: boolean) => void;
  setActiveTabId: (tabId: string, groupId: string) => void;
  setActiveGroupId: (groupId: string) => void;
  closeTab: (tabId: string, groupId: string) => void;
  splitTab: (tabId: string, groupId: string) => void;
  moveTab: (tabId: string, fromGroupId: string, toGroupId: string) => void;
  tabsContainerRef: RefObject<HTMLDivElement | null>;
}

export const TabBarView: React.FC<TabBarViewProps> = ({
  groupId,
  openTabs,
  activeTabId,
  activeGroupId,
  dropdownOpen,
  setDropdownOpen,
  setActiveTabId,
  setActiveGroupId,
  closeTab,
  splitTab,
  moveTab,
  tabsContainerRef,
}) => {
  return (
    <div
      onClick={() => {
        if (activeGroupId !== groupId) {
          setActiveGroupId(groupId);
        }
      }}
      className={`flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-header)] h-9 select-none z-20 relative flex-shrink-0 w-full ${
        activeGroupId === groupId ? "shadow-[inset_0_-1px_0_var(--accent-color)]" : ""
      }`}
    >
      {/* Scrollable Tab Container */}
      <div
        ref={tabsContainerRef}
        className="flex-1 flex items-stretch h-full overflow-x-auto scrollbar-none scroll-smooth min-w-0 tabs-container"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const tabId = e.dataTransfer.getData("text/plain");
          const fromGroupId = e.dataTransfer.getData("from-group-id");
          if (tabId && fromGroupId && fromGroupId !== groupId) {
            moveTab(tabId, fromGroupId, groupId);
          }
        }}
      >
        {openTabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const activeTabStyles = tab.type === "canvas"
            ? "bg-[var(--bg-canvas)] border-b-[var(--bg-canvas)] text-[var(--text-light)] font-semibold"
            : "bg-[var(--bg-editor)] border-b-[var(--bg-editor)] text-[var(--text-light)] font-semibold";
          const isFocusedGroup = activeGroupId === groupId;

          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              onClick={(e) => {
                e.stopPropagation();
                setActiveTabId(tab.id, groupId);
                setActiveGroupId(groupId);
              }}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", tab.id);
                e.dataTransfer.setData("from-group-id", groupId);
              }}
              className={`group flex items-center space-x-2 px-4.5 h-[calc(100%+1px)] -mb-[1px] border-r border-[var(--border-color)] text-[11px] font-mono cursor-pointer select-none transition-all flex-shrink-0 rounded-t-xl relative z-10 ${
                isActive
                  ? `${activeTabStyles} border-b`
                  : "bg-[var(--bg-header)] text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--accent-bg)]/20 border-b border-b-transparent"
              }`}
            >
              {/* Top Accent Line for Active Tab of Active Group */}
              {isActive && (
                <div className={`absolute top-0 left-0 right-0 h-[2px] rounded-t-xl ${
                  isFocusedGroup ? "bg-[var(--accent-color)]" : "bg-[var(--border-color)]"
                }`} />
              )}

              {tab.type === "canvas" && (
                <AxiomIcon
                  size={11}
                  className={
                    isActive
                      ? "text-[var(--accent-color)]"
                      : "text-[var(--text-muted)]"
                  }
                />
              )}
              {tab.type === "file" && (
                <FileIcon
                  fileName={tab.title}
                  size={11}
                  className="flex-shrink-0"
                />
              )}
              {tab.type === "task" && (
                <Cpu
                  size={11}
                  className={
                    isActive
                      ? "text-[var(--accent-color)]"
                      : "text-[var(--text-muted)]"
                  }
                />
              )}
              {tab.type === "llm-setup" && (
                <Cpu
                  size={11}
                  className={
                    isActive
                      ? "text-[var(--accent-color)]"
                      : "text-[var(--text-muted)]"
                  }
                />
              )}
              {tab.type === "skills" && (
                <Wand2
                  size={11}
                  className={
                    isActive
                      ? "text-[var(--accent-color)]"
                      : "text-[var(--text-muted)]"
                  }
                />
              )}
              {tab.type === "settings" && (
                <Settings
                  size={11}
                  className={
                    isActive
                      ? "text-[var(--accent-color)]"
                      : "text-[var(--text-muted)]"
                  }
                />
              )}
              {tab.type === "git-history" && (
                <GitCommit
                  size={11}
                  className={
                    isActive
                      ? "text-[var(--accent-color)]"
                      : "text-[var(--text-muted)]"
                  }
                />
              )}
              {tab.type === "git-diff" && (
                <GitCommit
                  size={11}
                  className={
                    isActive
                      ? "text-[var(--accent-color)]"
                      : "text-[var(--text-muted)]"
                  }
                />
              )}
              {tab.type === "workspace" && (
                <FolderOpen
                  size={11}
                  className={
                    isActive
                      ? "text-[var(--accent-color)]"
                      : "text-[var(--text-muted)]"
                  }
                />
              )}
              {tab.type === "onboarding" && (
                <BookOpen
                  size={11}
                  className={isActive ? "text-[var(--accent-color)]" : "text-[var(--text-muted)]"}
                />
              )}

              <span className="truncate max-w-[120px]">{tab.title}</span>

              <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    splitTab(tab.id, groupId);
                  }}
                  className="p-0.5 rounded-sm hover:bg-[var(--border-color)]/80 text-[var(--text-muted)] hover:text-[var(--text-light)]"
                  title="Split editor"
                >
                  <Columns size={10} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id, groupId);
                  }}
                  className="p-0.5 rounded-sm hover:bg-[var(--border-color)]/80 text-[var(--text-muted)] hover:text-[var(--text-light)]"
                  title="Close tab"
                >
                  <X size={10} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Tab Switcher Dropdown */}
      <div className="relative flex items-center h-full px-2 border-l border-[var(--border-color)] bg-[var(--bg-header)] z-30 flex-shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setDropdownOpen(!dropdownOpen);
          }}
          className="p-1 rounded hover:bg-[var(--accent-bg)]/50 text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer"
          title="Open Editors"
        >
          <ChevronDown size={14} />
        </button>

        {dropdownOpen && (
          <>
            {/* Click-away backdrop overlay */}
            <div
              className="fixed inset-0 z-40 bg-transparent"
              onClick={() => setDropdownOpen(false)}
            />
            <div className="absolute right-2 top-8 w-64 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-2xl py-1.5 z-50 font-mono text-[11px] max-h-80 overflow-y-auto">
              <div className="px-3 py-1 text-[9px] uppercase tracking-wider font-bold text-[var(--text-muted)] border-b border-[var(--border-color)]/30 pb-1.5 mb-1.5">
                Open Editors
              </div>
              {openTabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                return (
                  <div
                    key={tab.id}
                    onClick={() => {
                      setActiveTabId(tab.id, groupId);
                      setDropdownOpen(false);
                    }}
                    className={`group flex items-center justify-between px-3 py-1.5 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] cursor-pointer transition-colors ${
                      isActive
                        ? "text-[var(--accent-color)] font-semibold bg-[var(--accent-bg)]/20"
                        : "text-[var(--text-normal)]"
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate mr-4">
                      {tab.type === "canvas" && <AxiomIcon size={11} />}
                      {tab.type === "file" && (
                        <FileIcon fileName={tab.title} size={11} />
                      )}
                      {tab.type === "task" && <Cpu size={11} />}
                      {tab.type === "llm-setup" && <Cpu size={11} />}
                      {tab.type === "settings" && <Settings size={11} />}
                      {tab.type === "git-history" && <GitCommit size={11} />}
                      {tab.type === "git-diff" && <GitCommit size={11} />}
                      {tab.type === "workspace" && <FolderOpen size={11} />}
                      {tab.type === "onboarding" && <BookOpen size={11} />}
                      <span className="truncate">{tab.title}</span>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id, groupId);
                        if (openTabs.length <= 1) {
                          setDropdownOpen(false);
                        }
                      }}
                      className="p-0.5 rounded-sm hover:bg-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--color-status-danger)] opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={10} />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
