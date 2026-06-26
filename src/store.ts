import { create } from "zustand";
import {
  Node,
  Edge,
  Connection,
  addEdge,
  OnNodesChange,
  OnEdgesChange,
  applyNodeChanges,
  applyEdgeChanges,
} from "@xyflow/react";
import { invoke } from "@tauri-apps/api/core";
import { themes, applyThemeProperties, defineMonacoTheme } from "./theme";
import { loader } from "@monaco-editor/react";

export interface CustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiType: string;
  models: { id: string; name: string }[];
}

export interface DevLog {
  id: string;
  type: "log" | "error" | "warn" | "system";
  text: string;
  timestamp: string;
}

export interface GitFileStatus {
  path: string;
  name: string;
  status_type: "modified" | "added" | "deleted" | "untracked";
}

export interface GitStatusResult {
  isRepo: boolean;
  currentBranch: string;
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
}

export interface Tab {
  id: string;
  type: "canvas" | "file" | "task" | "settings" | "llm-setup" | "git-diff" | "git-history" | "workspace";
  title: string;
  key: string;
  diffType?: "staged" | "unstaged" | "commit";
  commitHash?: string;
}

export interface EditorGroup {
  id: string;
  openTabs: Tab[];
  activeTabId: string | null;
}

export interface GlobalChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
}

export interface WorkspaceState {
  rootPath: string;
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  fileTree: any[];
  nodeLogs: Record<string, string[]>;
  globalContextSummary: string;
  globalChatHistory: Record<string, GlobalChatMessage[]>;
  nodeStatus: Record<string, "idle" | "running" | "success" | "error">;
  customProviders: CustomProvider[];
  activeCustomProviderId: string | null;
  activeModel: string;
  gitStatus: GitStatusResult | null;
  collapseAllTrigger?: number;
  expandedPaths: Record<string, boolean>;
  selectedEdgeId: string | null;
  edgeReconciliationStatus: Record<string, "idle" | "unreconciled" | "reconciled">;
  
  activeThemeId: string;
  setActiveThemeId: (themeId: string) => void;
  
  setRootPath: (path: string) => void;
  setGitStatus: (status: GitStatusResult | null) => void;
  loadGitStatus: () => Promise<void>;
  setFileTree: (tree: any[]) => void;
  setSelectedNodeId: (id: string | null) => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: (connection: Connection) => void;
  
  addContextNode: (x: number, y: number, fileContext?: { path: string; name: string; isDir: boolean }) => void;
  addTaskNode: (x: number, y: number) => void;
  addGlobalChatNode: (x: number, y: number) => void;
  updateTaskNode: (id: string, data: any) => void;
  deleteNode: (id: string) => void;
  addLog: (nodeId: string, message: string) => void;
  clearLogs: (nodeId: string) => void;
  setNodeStatus: (nodeId: string, status: "idle" | "running" | "success" | "error") => void;
  setGlobalContextSummary: (summary: string) => void;
  addGlobalChatMessage: (nodeId: string, message: GlobalChatMessage) => void;
  clearGlobalChatHistory: (nodeId: string) => void;
  
  addCustomProvider: (provider: CustomProvider) => void;
  updateProviderSettings: (providerId: string, settings: { apiKey?: string; baseUrl?: string; name?: string; models?: { id: string; name: string }[] }) => void;
  setActiveCustomProviderId: (id: string | null) => void;
  setActiveModel: (model: string) => void;
  
  devLogs: DevLog[];
  showDevConsole: boolean;
  addDevLog: (type: "log" | "error" | "warn" | "system", text: string) => void;
  clearDevLogs: () => void;
  setShowDevConsole: (show: boolean) => void;

  editorGroups: EditorGroup[];
  activeGroupId: string;
  groupSizes: number[];
  openTab: (tab: Tab, groupId?: string) => void;
  closeTab: (id: string, groupId?: string) => void;
  setActiveTabId: (id: string | null, groupId?: string) => void;
  splitTab: (id: string, fromGroupId: string) => void;
  moveTab: (id: string, fromGroupId: string, toGroupId: string) => void;
  setGroupSizes: (sizes: number[]) => void;
  setActiveGroupId: (id: string) => void;
  
  setPathExpanded: (path: string, expanded: boolean) => void;
  togglePathExpanded: (path: string) => void;
  collapseAllFolders: () => void;
  addAndConnectContextNode: (x: number, y: number, taskId: string, taskHandleId: string) => void;
  getGlobalChatHistory: (nodeId: string) => GlobalChatMessage[];
  setSelectedEdgeId: (id: string | null) => void;
  setEdgeStatus: (edgeId: string, status: "idle" | "unreconciled" | "reconciled") => void;
  getSequenceEdges: () => Edge[];
  saveSecureConfig: () => Promise<void>;
  loadSecureConfig: () => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  rootPath: "",
  nodes: [],
  edges: [],
  selectedNodeId: null,
  fileTree: [],
  nodeLogs: {},
  nodeStatus: {},
  expandedPaths: {},
  globalContextSummary: "",
  globalChatHistory: {},
  selectedEdgeId: null,
  edgeReconciliationStatus: {},
  customProviders: [
    {
      id: "opencode",
      name: "Opencode",
      baseUrl: "https://opencode.ai/zen/v1",
      apiKey: "",
      apiType: "openai-completions",
      models: []
    },
    {
      id: "anthropic",
      name: "Anthropic",
      baseUrl: "",
      apiKey: "",
      apiType: "anthropic",
      models: [
        { id: "anthropic/claude-3-5-sonnet", name: "Claude 3.5 Sonnet" },
        { id: "anthropic/claude-3-haiku", name: "Claude 3 Haiku" }
      ]
    },
    {
      id: "openai",
      name: "OpenAI",
      baseUrl: "",
      apiKey: "",
      apiType: "openai-completions",
      models: [
        { id: "openai/gpt-4o", name: "GPT-4o" },
        { id: "openai/gpt-4o-mini", name: "GPT-4o Mini" }
      ]
    }
  ],
  activeCustomProviderId: "opencode",
  activeModel: "",
  gitStatus: null,
  devLogs: [],
  showDevConsole: false,
  editorGroups: [
    { id: "group_0", openTabs: [{ id: "canvas", type: "canvas" as const, title: "Axiom", key: "canvas" }], activeTabId: "canvas" }
  ],
  activeGroupId: "group_0",
  groupSizes: [1.0],
  activeThemeId: localStorage.getItem("selected_theme") || "dark",
  setActiveThemeId: (themeId) => {
    const t = themes[themeId] || themes.dark;
    applyThemeProperties(t);
    localStorage.setItem("selected_theme", themeId);
    set({ activeThemeId: themeId });
    loader.init().then((monaco) => {
      defineMonacoTheme(monaco, t);
      monaco.editor.setTheme("axiom-custom-theme");
    }).catch(e => {
      console.warn("Failed to update monaco theme:", e);
    });
    setTimeout(() => useWorkspaceStore.getState().saveSecureConfig(), 0);
  },

  setRootPath: (path) => {
    if (path) {
      try {
        const stored = localStorage.getItem("previous_workspaces");
        const list: string[] = stored ? JSON.parse(stored) : [];
        const filtered = list.filter((p) => p !== path);
        filtered.unshift(path);
        if (filtered.length > 10) filtered.pop();
        localStorage.setItem("previous_workspaces", JSON.stringify(filtered));
      } catch (e) {
        console.error("Failed to update previous workspaces history:", e);
      }
    }
    set({
      rootPath: path,
      editorGroups: [
        { id: "group_0", openTabs: [{ id: "canvas", type: "canvas" as const, title: "Axiom", key: "canvas" }], activeTabId: "canvas" }
      ],
      activeGroupId: "group_0",
      groupSizes: [1.0],
      expandedPaths: {},
      nodes: [],
      edges: [],
      selectedNodeId: null,
      nodeLogs: {},
      nodeStatus: {}
    });
    useWorkspaceStore.getState().loadGitStatus();
    setTimeout(() => useWorkspaceStore.getState().saveSecureConfig(), 0);
  },
  setGitStatus: (status) => set({ gitStatus: status }),
  loadGitStatus: async () => {
    const rootPath = useWorkspaceStore.getState().rootPath;
    if (!rootPath) {
      set({ gitStatus: null });
      return;
    }
    try {
      const res: any = await invoke("git_status", { rootDir: rootPath });
      const mappedStatus: GitStatusResult = {
        isRepo: res.is_repo,
        currentBranch: res.current_branch,
        staged: (res.staged || []).map((f: any) => ({
          path: f.path,
          name: f.name,
          status_type: f.status_type
        })),
        unstaged: (res.unstaged || []).map((f: any) => ({
          path: f.path,
          name: f.name,
          status_type: f.status_type
        }))
      };
      set({ gitStatus: mappedStatus });
    } catch (err) {
      console.error("Failed to load git status:", err);
    }
  },
  setFileTree: (tree) => set({ fileTree: tree }),
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  
  onNodesChange: (changes) => set((state) => ({
    nodes: applyNodeChanges(changes, state.nodes),
  })),
  
  onEdgesChange: (changes) => set((state) => ({
    edges: applyEdgeChanges(changes, state.edges),
  })),
  
  onConnect: (connection) => set((state) => {
    const isContext = connection.source?.startsWith("context");
    const edgeStyle = isContext ? { stroke: "#10b981", strokeWidth: 2 } : undefined;
    const newEdge = {
      ...connection,
      style: edgeStyle
    };
    return {
      edges: addEdge(newEdge, state.edges),
    };
  }),

  addContextNode: (x, y, fileContext) => set((state) => {
    const id = `context_${Date.now()}`;
    
    // Prevent overlapping nodes by shifting coordinates if another node is placed too close (within 60px)
    let finalX = x;
    let finalY = y;
    let attempts = 0;
    while (
      state.nodes.some(
        (n) => Math.abs(n.position.x - finalX) < 60 && Math.abs(n.position.y - finalY) < 60
      ) &&
      attempts < 100
    ) {
      finalX += 50;
      finalY += 50;
      attempts++;
    }

    const name = fileContext ? `Context: ${fileContext.name}` : "";
    const newNode: Node = {
      id,
      type: "contextNode",
      position: { x: finalX, y: finalY },
      data: {
        id,
        name,
        description: "",
        path: fileContext?.path || "",
        fileName: fileContext?.name || "",
        isDir: fileContext?.isDir || false
      }
    };
    return { nodes: [...state.nodes, newNode] };
  }),

  addTaskNode: (x, y) => set((state) => {
    const id = `task_${Date.now()}`;
    
    // Prevent overlapping nodes by shifting coordinates if another node is placed too close (within 60px)
    let finalX = x;
    let finalY = y;
    let attempts = 0;
    while (
      state.nodes.some(
        (n) => Math.abs(n.position.x - finalX) < 60 && Math.abs(n.position.y - finalY) < 60
      ) &&
      attempts < 100
    ) {
      finalX += 50;
      finalY += 50;
      attempts++;
    }

    const newNode: Node = {
      id,
      type: "taskNode",
      position: { x: finalX, y: finalY },
      data: {
        id,
        name: "AI Executor Node",
        prompt: "",
        model: state.activeModel,
        status: "idle"
      }
    };
    return { nodes: [...state.nodes, newNode] };
  }),

  addGlobalChatNode: (x, y) => set((state) => {
    const id = `global_chat_${Date.now()}`;

    // Prevent overlapping nodes
    let finalX = x;
    let finalY = y;
    let attempts = 0;
    while (
      state.nodes.some(
        (n) => Math.abs(n.position.x - finalX) < 60 && Math.abs(n.position.y - finalY) < 60
      ) &&
      attempts < 100
    ) {
      finalX += 50;
      finalY += 50;
      attempts++;
    }

    const newNode: Node = {
      id,
      type: "globalChatNode",
      position: { x: finalX, y: finalY },
      data: {
        id,
        name: "Global Explorer",
        status: "idle",
        summary: "",
        width: 384,
        height: 220
      }
    };
    return { nodes: [...state.nodes, newNode] };
  }),

  updateTaskNode: (id, data) => set((state) => ({
    nodes: state.nodes.map((node) => {
      if (node.id === id) {
        return { ...node, data: { ...node.data, ...data } };
      }
      return node;
    })
  })),

  deleteNode: (id) => set((state) => {
    const newNodes = state.nodes.filter((node) => node.id !== id);
    const newEdges = state.edges.filter((edge) => edge.source !== id && edge.target !== id);
    const newNodeLogs = { ...state.nodeLogs };
    delete newNodeLogs[id];
    const newNodeStatus = { ...state.nodeStatus };
    delete newNodeStatus[id];
    return {
      nodes: newNodes,
      edges: newEdges,
      nodeLogs: newNodeLogs,
      nodeStatus: newNodeStatus,
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId
    };
  }),

  addLog: (nodeId, message) => set((state) => {
    const currentLogs = state.nodeLogs[nodeId] || [];
    return {
      nodeLogs: {
        ...state.nodeLogs,
        [nodeId]: [...currentLogs, `[${new Date().toLocaleTimeString()}] ${message}`]
      }
    };
  }),

  clearLogs: (nodeId) => set((state) => ({
    nodeLogs: { ...state.nodeLogs, [nodeId]: [] }
  })),

  setNodeStatus: (nodeId, status) => set((state) => ({
    nodeStatus: { ...state.nodeStatus, [nodeId]: status }
  })),

  setGlobalContextSummary: (summary) => set({ globalContextSummary: summary }),

  addGlobalChatMessage: (nodeId, message) => set((state) => {
    const history = state.globalChatHistory[nodeId] || [];
    return {
      globalChatHistory: {
        ...state.globalChatHistory,
        [nodeId]: [...history, message]
      }
    };
  }),

  clearGlobalChatHistory: (nodeId) => set((state) => ({
    globalChatHistory: { ...state.globalChatHistory, [nodeId]: [] }
  })),

  addCustomProvider: (provider) => set((state) => {
    const updated = [...state.customProviders.filter(p => p.id !== provider.id), provider];
    setTimeout(() => useWorkspaceStore.getState().saveSecureConfig(), 0);
    return { customProviders: updated };
  }),

  updateProviderSettings: (providerId, settings) => set((state) => {
    const updated = state.customProviders.map((p) => {
      if (p.id === providerId) {
        return { ...p, ...settings };
      }
      return p;
    });
    setTimeout(() => useWorkspaceStore.getState().saveSecureConfig(), 0);
    return { customProviders: updated };
  }),

  setActiveCustomProviderId: (id) => {
    set({ activeCustomProviderId: id });
    setTimeout(() => useWorkspaceStore.getState().saveSecureConfig(), 0);
  },
  setActiveModel: (model) => {
    set({ activeModel: model });
    setTimeout(() => useWorkspaceStore.getState().saveSecureConfig(), 0);
  },
  
  addDevLog: (type, text) => set((state) => {
    const newLog: DevLog = {
      id: `dev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      text,
      timestamp: new Date().toLocaleTimeString()
    };
    const slicedLogs = state.devLogs.slice(-499);
    return { devLogs: [...slicedLogs, newLog] };
  }),
  clearDevLogs: () => set({ devLogs: [] }),
  setShowDevConsole: (show) => set({ showDevConsole: show }),

  openTab: (tab, groupId) => set((state) => {
    const targetGroupId = groupId || state.activeGroupId;
    const exists = state.editorGroups.some((g) => g.id === targetGroupId);
    
    let newGroups = state.editorGroups.map((group) => {
      if (group.id === targetGroupId) {
        const hasTab = group.openTabs.some((t) => t.id === tab.id);
        const newTabs = hasTab ? group.openTabs : [...group.openTabs, tab];
        return { ...group, openTabs: newTabs, activeTabId: tab.id };
      }
      return group;
    });

    if (!exists || newGroups.length === 0) {
      const newGroup = {
        id: targetGroupId || `group_${Date.now()}`,
        openTabs: [tab],
        activeTabId: tab.id
      };
      newGroups = [newGroup];
      return {
        editorGroups: newGroups,
        activeGroupId: newGroup.id,
        groupSizes: [1.0]
      };
    }

    return {
      editorGroups: newGroups,
      activeGroupId: targetGroupId
    };
  }),
  closeTab: (id, groupId) => set((state) => {
    const targetGroup = state.editorGroups.find(
      (g) => groupId ? g.id === groupId : g.openTabs.some((t) => t.id === id)
    );
    if (!targetGroup) return {};

    if (id === "canvas" && state.editorGroups.length === 1 && targetGroup.openTabs.length === 1) {
      return {};
    }

    const groupIndex = state.editorGroups.indexOf(targetGroup);
    const remainingTabs = targetGroup.openTabs.filter((t) => t.id !== id);

    if (remainingTabs.length > 0) {
      let nextActiveTabId = targetGroup.activeTabId;
      if (targetGroup.activeTabId === id) {
        nextActiveTabId = remainingTabs[remainingTabs.length - 1].id;
      }
      const updatedGroups = state.editorGroups.map((g) =>
        g.id === targetGroup.id ? { ...g, openTabs: remainingTabs, activeTabId: nextActiveTabId } : g
      );
      return { editorGroups: updatedGroups };
    } else {
      if (state.editorGroups.length === 1) {
        const fallbackGroup = {
          id: targetGroup.id,
          openTabs: [{ id: "canvas", type: "canvas" as const, title: "Axiom", key: "canvas" }],
          activeTabId: "canvas"
        };
        return {
          editorGroups: [fallbackGroup],
          activeGroupId: fallbackGroup.id,
          groupSizes: [1.0]
        };
      } else {
        const updatedGroups = state.editorGroups.filter((g) => g.id !== targetGroup.id);
        const oldSize = state.groupSizes[groupIndex];
        const newSizes = [...state.groupSizes];
        newSizes.splice(groupIndex, 1);
        
        const neighborIndex = groupIndex > 0 ? groupIndex - 1 : 0;
        newSizes[neighborIndex] = (newSizes[neighborIndex] || 0) + oldSize;

        let nextActiveGroupId = state.activeGroupId;
        if (state.activeGroupId === targetGroup.id) {
          nextActiveGroupId = updatedGroups[neighborIndex].id;
        }

        return {
          editorGroups: updatedGroups,
          groupSizes: newSizes,
          activeGroupId: nextActiveGroupId
        };
      }
    }
  }),
  setActiveTabId: (id, groupId) => set((state) => {
    const targetGroupId = groupId || state.activeGroupId;
    const updatedGroups = state.editorGroups.map((g) => {
      if (g.id === targetGroupId) {
        return { ...g, activeTabId: id };
      }
      return g;
    });
    return {
      editorGroups: updatedGroups,
      activeGroupId: targetGroupId
    };
  }),
  splitTab: (id, fromGroupId) => set((state) => {
    const fromGroupIndex = state.editorGroups.findIndex((g) => g.id === fromGroupId);
    if (fromGroupIndex === -1) return {};
    
    const fromGroup = state.editorGroups[fromGroupIndex];
    const tabToSplit = fromGroup.openTabs.find((t) => t.id === id);
    if (!tabToSplit) return {};

    const newGroupId = `group_${Date.now()}`;
    const newGroup = {
      id: newGroupId,
      openTabs: [tabToSplit],
      activeTabId: tabToSplit.id
    };

    const updatedGroups = [...state.editorGroups];
    updatedGroups.splice(fromGroupIndex + 1, 0, newGroup);

    const oldSize = state.groupSizes[fromGroupIndex];
    const newSizes = [...state.groupSizes];
    newSizes[fromGroupIndex] = oldSize / 2;
    newSizes.splice(fromGroupIndex + 1, 0, oldSize / 2);

    return {
      editorGroups: updatedGroups,
      groupSizes: newSizes,
      activeGroupId: newGroupId
    };
  }),
  moveTab: (id, fromGroupId, toGroupId) => set((state) => {
    if (fromGroupId === toGroupId) return {};

    const fromGroupIndex = state.editorGroups.findIndex((g) => g.id === fromGroupId);
    const toGroupIndex = state.editorGroups.findIndex((g) => g.id === toGroupId);
    if (fromGroupIndex === -1 || toGroupIndex === -1) return {};

    const fromGroup = state.editorGroups[fromGroupIndex];
    const tabToMove = fromGroup.openTabs.find((t) => t.id === id);
    if (!tabToMove) return {};

    const remainingTabs = fromGroup.openTabs.filter((t) => t.id !== id);
    let updatedGroups = [...state.editorGroups];
    let newSizes = [...state.groupSizes];
    let nextActiveGroupId = state.activeGroupId;

    if (remainingTabs.length > 0) {
      let nextActiveTabId = fromGroup.activeTabId;
      if (fromGroup.activeTabId === id) {
        nextActiveTabId = remainingTabs[remainingTabs.length - 1].id;
      }
      updatedGroups[fromGroupIndex] = {
        ...fromGroup,
        openTabs: remainingTabs,
        activeTabId: nextActiveTabId
      };
    } else {
      if (state.editorGroups.length === 1) {
        // Should not happen as we have a valid toGroup
      } else {
        updatedGroups.splice(fromGroupIndex, 1);
        const oldSize = state.groupSizes[fromGroupIndex];
        newSizes.splice(fromGroupIndex, 1);
        
        const neighborIndex = fromGroupIndex > 0 ? fromGroupIndex - 1 : 0;
        newSizes[neighborIndex] = (newSizes[neighborIndex] || 0) + oldSize;

        if (state.activeGroupId === fromGroupId) {
          nextActiveGroupId = updatedGroups[neighborIndex].id;
        }
      }
    }

    const targetToGroupIndex = updatedGroups.findIndex((g) => g.id === toGroupId);
    if (targetToGroupIndex !== -1) {
      const targetGroup = updatedGroups[targetToGroupIndex];
      const hasTab = targetGroup.openTabs.some((t) => t.id === id);
      const newTabs = hasTab ? targetGroup.openTabs : [...targetGroup.openTabs, tabToMove];
      
      updatedGroups[targetToGroupIndex] = {
        ...targetGroup,
        openTabs: newTabs,
        activeTabId: id
      };
      nextActiveGroupId = toGroupId;
    }

    return {
      editorGroups: updatedGroups,
      groupSizes: newSizes,
      activeGroupId: nextActiveGroupId
    };
  }),
  setGroupSizes: (sizes) => set({ groupSizes: sizes }),
  setActiveGroupId: (id) => set({ activeGroupId: id }),
  setPathExpanded: (path, expanded) => set((state) => ({
    expandedPaths: { ...state.expandedPaths, [path]: expanded }
  })),
  togglePathExpanded: (path) => set((state) => ({
    expandedPaths: { ...state.expandedPaths, [path]: !state.expandedPaths[path] }
  })),
  collapseAllFolders: () => set({
    expandedPaths: {},
    collapseAllTrigger: Date.now()
  }),
  addAndConnectContextNode: (x, y, taskId, taskHandleId) => set((state) => {
    const ctxId = `context_${Date.now()}`;
    const newContextNode = {
      id: ctxId,
      type: "contextNode",
      position: { x: x - 100, y: y - 50 },
      data: {
        id: ctxId,
        name: "",
        description: "",
        path: "",
        fileName: "",
        isDir: false
      }
    };

    const newEdge = {
      id: `edge_${Date.now()}`,
      source: ctxId,
      sourceHandle: taskHandleId === "context-in-top" ? "context-out-bottom" : "context-out-top",
      target: taskId,
      targetHandle: taskHandleId,
      style: { stroke: "#10b981", strokeWidth: 2 }
    };

    return {
      nodes: [...state.nodes, newContextNode],
      edges: [...state.edges, newEdge]
    };
  }),
  getGlobalChatHistory: (nodeId): GlobalChatMessage[] => {
    return useWorkspaceStore.getState().globalChatHistory[nodeId] || [];
  },
  setSelectedEdgeId: (id) => set({ selectedEdgeId: id }),
  setEdgeStatus: (edgeId, status) => set((state) => ({
    edgeReconciliationStatus: { ...state.edgeReconciliationStatus, [edgeId]: status }
  })),
  getSequenceEdges: (): Edge[] => {
    const state = useWorkspaceStore.getState();
    return state.edges.filter(
      (e) => e.sourceHandle === "task-out" && e.targetHandle === "task-in"
    );
  },

  saveSecureConfig: async () => {
    const state = useWorkspaceStore.getState();
    const { SecureStorageService } = await import("./services/secureStorageService");
    await SecureStorageService.saveSecureData("axiom_secure_config", {
      customProviders: state.customProviders,
      activeCustomProviderId: state.activeCustomProviderId,
      activeModel: state.activeModel,
      activeThemeId: state.activeThemeId,
      lastWorkspacePath: state.rootPath,
    });
  },

  loadSecureConfig: async () => {
    const { SecureStorageService } = await import("./services/secureStorageService");
    const config = await SecureStorageService.loadSecureData<{
      customProviders?: CustomProvider[];
      activeCustomProviderId?: string | null;
      activeModel?: string;
      activeThemeId?: string;
      lastWorkspacePath?: string;
    }>("axiom_secure_config");

    if (config) {
      const updates: Partial<WorkspaceState> = {};
      if (config.customProviders) updates.customProviders = config.customProviders;
      if (config.activeCustomProviderId !== undefined) updates.activeCustomProviderId = config.activeCustomProviderId;
      if (config.activeModel) updates.activeModel = config.activeModel;

      if (config.activeThemeId) {
        updates.activeThemeId = config.activeThemeId;
        localStorage.setItem("selected_theme", config.activeThemeId);
        const themeId = config.activeThemeId;
        const { themes, applyThemeProperties, defineMonacoTheme } = await import("./theme");
        const t = themes[themeId] || themes.dark;
        applyThemeProperties(t);

        const { loader } = await import("@monaco-editor/react");
        loader.init().then((monaco) => {
          defineMonacoTheme(monaco, t);
          monaco.editor.setTheme("axiom-custom-theme");
        }).catch(e => console.warn("Failed to set monaco theme:", e));
      }

      set(updates);

      if (config.lastWorkspacePath) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const tree: any[] = await invoke("get_directory_structure", { rootDir: config.lastWorkspacePath });
          set({
            rootPath: config.lastWorkspacePath,
            fileTree: tree
          });
          await useWorkspaceStore.getState().loadGitStatus();
        } catch (err) {
          console.error("Failed to load last workspace folder:", err);
        }
      }
    }
  }
}));
