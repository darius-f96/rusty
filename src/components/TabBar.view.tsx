import React, { RefObject } from "react";
import { X, Cpu, Settings, GitCommit, ChevronDown, FolderOpen, Columns, Wand2, BookOpen } from "lucide-react";
import { FileIcon } from "../services/fileTypeService";
import { RustyIcon } from "./RustyIcon";
import styles from "./TabBar.module.css";

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
      className={`${styles.bar} ${activeGroupId === groupId ? styles.focused : ""}`}
    >
      {/* Scrollable Tab Container */}
      <div
        ref={tabsContainerRef}
        className={`${styles.tabs} scrollbar-none tabs-container`}
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
              className={`${styles.tab} ${
                isActive ? (tab.type === "canvas" ? styles.activeCanvas : styles.activeEditor) : ""
              }`}
            >
              {/* Top Accent Line for Active Tab of Active Group */}
              {isActive && (
                <div className={`${styles.accent} ${isFocusedGroup ? styles.accentFocused : ""}`} />
              )}

              {tab.type === "canvas" && (
                <RustyIcon
                  size={11}
                  className={
                    isActive
                      ? styles.iconActive
                      : styles.icon
                  }
                />
              )}
              {tab.type === "file" && (
                <FileIcon
                  fileName={tab.title}
                  size={11}
                  className={styles.icon}
                />
              )}
              {tab.type === "task" && (
                <Cpu
                  size={11}
                  className={
                    isActive
                      ? styles.iconActive
                      : styles.icon
                  }
                />
              )}
              {tab.type === "llm-setup" && (
                <Cpu
                  size={11}
                  className={
                    isActive
                      ? styles.iconActive
                      : styles.icon
                  }
                />
              )}
              {tab.type === "skills" && (
                <Wand2
                  size={11}
                  className={
                    isActive
                      ? styles.iconActive
                      : styles.icon
                  }
                />
              )}
              {tab.type === "settings" && (
                <Settings
                  size={11}
                  className={
                    isActive
                      ? styles.iconActive
                      : styles.icon
                  }
                />
              )}
              {tab.type === "git-history" && (
                <GitCommit
                  size={11}
                  className={
                    isActive
                      ? styles.iconActive
                      : styles.icon
                  }
                />
              )}
              {tab.type === "git-diff" && (
                <GitCommit
                  size={11}
                  className={
                    isActive
                      ? styles.iconActive
                      : styles.icon
                  }
                />
              )}
              {tab.type === "workspace" && (
                <FolderOpen
                  size={11}
                  className={
                    isActive
                      ? styles.iconActive
                      : styles.icon
                  }
                />
              )}
              {tab.type === "onboarding" && (
                <BookOpen
                  size={11}
                  className={isActive ? styles.iconActive : styles.icon}
                />
              )}

              <span className={styles.title}>{tab.title}</span>

              <div className={styles.tabActions}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    splitTab(tab.id, groupId);
                  }}
                  className={styles.iconButton}
                  title="Split editor"
                >
                  <Columns size={10} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id, groupId);
                  }}
                  className={styles.iconButton}
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
      <div className={styles.switcher}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setDropdownOpen(!dropdownOpen);
          }}
          className={styles.iconButton}
          title="Open Editors"
        >
          <ChevronDown size={14} />
        </button>

        {dropdownOpen && (
          <>
            {/* Click-away backdrop overlay */}
            <div
              className={styles.backdrop}
              onClick={() => setDropdownOpen(false)}
            />
            <div className={styles.menu}>
              <div className={styles.menuTitle}>
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
                    className={`${styles.menuRow} ${isActive ? styles.menuRowActive : ""}`}
                  >
                    <div className={styles.menuIdentity}>
                      {tab.type === "canvas" && <RustyIcon size={11} />}
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
                      <span className={styles.title}>{tab.title}</span>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id, groupId);
                        if (openTabs.length <= 1) {
                          setDropdownOpen(false);
                        }
                      }}
                      className={`${styles.iconButton} ${styles.menuClose}`}
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
