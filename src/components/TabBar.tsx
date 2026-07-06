import React, { useState, useEffect, useRef } from "react";
import { useWorkspaceStore } from "../store";
import { TabBarView } from "./TabBar.view";

interface TabBarProps {
  groupId: string;
  onCloseTab?: (tabId: string, groupId: string) => void;
}

export const TabBar: React.FC<TabBarProps> = ({ groupId, onCloseTab }) => {
  const group = useWorkspaceStore((state) => state.editorGroups.find((g) => g.id === groupId));
  const openTabs = group ? group.openTabs : [];
  const activeTabId = group ? group.activeTabId : null;

  const setActiveTabId = useWorkspaceStore((state) => state.setActiveTabId);
  const closeTab = useWorkspaceStore((state) => state.closeTab);
  const splitTab = useWorkspaceStore((state) => state.splitTab);
  const moveTab = useWorkspaceStore((state) => state.moveTab);
  const activeGroupId = useWorkspaceStore((state) => state.activeGroupId);
  const setActiveGroupId = useWorkspaceStore((state) => state.setActiveGroupId);

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
    <TabBarView
      groupId={groupId}
      openTabs={openTabs}
      activeTabId={activeTabId}
      activeGroupId={activeGroupId}
      dropdownOpen={dropdownOpen}
      setDropdownOpen={setDropdownOpen}
      setActiveTabId={setActiveTabId}
      setActiveGroupId={setActiveGroupId}
      closeTab={onCloseTab || closeTab}
      splitTab={splitTab}
      moveTab={moveTab}
      tabsContainerRef={tabsContainerRef}
    />
  );
};
