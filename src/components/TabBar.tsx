import React, { useState, useEffect, useRef } from "react";
import { X, Cpu, Settings, GitCommit, ChevronDown } from "lucide-react";
import { useWorkspaceStore } from "../store";
import { FileIcon } from "../services/fileTypeService";
import { AxiomIcon } from "./AxiomIcon";

export const TabBar: React.FC = () => {
  const openTabs = useWorkspaceStore((state) => state.openTabs);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const setActiveTabId = useWorkspaceStore((state) => state.setActiveTabId);
  const closeTab = useWorkspaceStore((state) => state.closeTab);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const tabsContainerRef = useRef<HTMLDivElement>(null);

  // Scroll active tab into view when activeTabId changes
  useEffect(() => {
    if (activeTabId && tabsContainerRef.current) {
      const activeEl = tabsContainerRef.current.querySelector(
        `[data-tab-id="${activeTabId}"]`
      );
      if (activeEl) {
        activeEl.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest",
        });
      }
    }
  }, [activeTabId]);

  return (
    <div className="flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-header)] h-9 select-none z-20 relative flex-shrink-0 w-full">
      {/* Scrollable Tab Container */}
      <div
        ref={tabsContainerRef}
        className="flex-1 flex items-stretch h-full overflow-x-auto scrollbar-none scroll-smooth min-w-0"
      >
        {openTabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`group flex items-center space-x-2 px-4 h-full border-r border-[var(--border-color)] text-[11px] font-mono cursor-pointer select-none transition-all flex-shrink-0 ${
                isActive
                  ? "bg-[var(--bg-app)] text-[var(--text-light)] font-semibold border-t-2 border-t-[var(--accent-color)]"
                  : "bg-[var(--bg-header)] text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--accent-bg)]"
              }`}
            >
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

              <span className="truncate max-w-[120px]">{tab.title}</span>

              {tab.id !== "canvas" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className="p-0.5 rounded-sm hover:bg-[var(--border-color)]/80 text-[var(--text-muted)] hover:text-[var(--text-light)] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Tab Switcher Dropdown */}
      <div className="relative flex items-center h-full px-2 border-l border-[var(--border-color)] bg-[var(--bg-header)] z-30 flex-shrink-0">
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
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
                      setActiveTabId(tab.id);
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
                      <span className="truncate">{tab.title}</span>
                    </div>

                    {tab.id !== "canvas" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(tab.id);
                          if (openTabs.length <= 1) {
                            setDropdownOpen(false);
                          }
                        }}
                        className="p-0.5 rounded-sm hover:bg-[var(--border-color)] text-[var(--text-muted)] hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X size={10} />
                      </button>
                    )}
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
