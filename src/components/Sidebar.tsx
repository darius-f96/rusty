import React from "react";
import { useWorkspaceStore } from "../store";
import { useShallow } from "zustand/react/shallow";
import { invoke } from "@tauri-apps/api/core";
import { SIDEBAR_ICONS, SidebarHelpers } from "./sidebar/SidebarPresenter";
import { SidebarView } from "./Sidebar.view";

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
      case "onboarding":
        return activeTab?.type === "onboarding";
      default:
        return false;
    }
  };

  const store = useWorkspaceStore(useShallow((state) => ({
    openTab: state.openTab,
    createCanvasTab: state.createCanvasTab,
    createAgentTab: state.createAgentTab,
    gitStatus: state.gitStatus,
  })));
  const topIcons = SIDEBAR_ICONS.filter((item) => item.id !== "settings" && item.id !== "onboarding");
  const helpIcon = SIDEBAR_ICONS.find((item) => item.id === "onboarding");
  const settingsIcon = SIDEBAR_ICONS.find((item) => item.id === "settings");

  return (
    <SidebarView
      sidebarWidth={sidebarWidth}
      isExplorerOpen={isExplorerOpen}
      sidebarView={sidebarView}
      fileTree={fileTree}
      containerRef={containerRef}
      topIcons={topIcons}
      helpIcon={helpIcon}
      settingsIcon={settingsIcon}
      store={store}
      helpers={helpers}
      isItemActive={isItemActive}
      handleRefreshExplorer={handleRefreshExplorer}
      handleCollapseAllFolders={handleCollapseAllFolders}
      handleCollapseSidebar={handleCollapseSidebar}
      onSidebarMouseDown={onSidebarMouseDown}
    />
  );
};
