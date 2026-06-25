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
  type: "canvas" | "file" | "task" | "settings" | "llm-setup" | "git-diff" | "git-history";
  title: string;
  key: string;
  diffType?: "staged" | "unstaged" | "commit";
  commitHash?: string;
}

export interface WorkspaceState {
  rootPath: string;
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  fileTree: any[];
  nodeLogs: Record<string, string[]>;
  nodeStatus: Record<string, "idle" | "running" | "success" | "error">;
  customProviders: CustomProvider[];
  activeCustomProviderId: string | null;
  activeModel: string;
  gitStatus: GitStatusResult | null;
  collapseAllTrigger?: number;
  expandedPaths: Record<string, boolean>;
  
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
  updateTaskNode: (id: string, data: any) => void;
  deleteNode: (id: string) => void;
  addLog: (nodeId: string, message: string) => void;
  clearLogs: (nodeId: string) => void;
  setNodeStatus: (nodeId: string, status: "idle" | "running" | "success" | "error") => void;
  
  addCustomProvider: (provider: CustomProvider) => void;
  setActiveCustomProviderId: (id: string | null) => void;
  setActiveModel: (model: string) => void;
  
  devLogs: DevLog[];
  showDevConsole: boolean;
  addDevLog: (type: "log" | "error" | "warn" | "system", text: string) => void;
  clearDevLogs: () => void;
  setShowDevConsole: (show: boolean) => void;

  openTabs: Tab[];
  activeTabId: string | null;
  openTab: (tab: Tab) => void;
  closeTab: (id: string) => void;
  setActiveTabId: (id: string | null) => void;
  
  setPathExpanded: (path: string, expanded: boolean) => void;
  togglePathExpanded: (path: string) => void;
  collapseAllFolders: () => void;
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
  customProviders: [
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
  activeCustomProviderId: "anthropic",
  activeModel: "anthropic/claude-3-5-sonnet",
  gitStatus: null,
  devLogs: [],
  showDevConsole: false,
  openTabs: [
    { id: "canvas", type: "canvas", title: "Axiom", key: "canvas" }
  ],
  activeTabId: "canvas",

  setRootPath: (path) => {
    set({
      rootPath: path,
      openTabs: [{ id: "canvas", type: "canvas", title: "Axiom", key: "canvas" }],
      activeTabId: "canvas",
      expandedPaths: {},
      nodes: [],
      edges: [],
      selectedNodeId: null,
      nodeLogs: {},
      nodeStatus: {}
    });
    useWorkspaceStore.getState().loadGitStatus();
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
  
  onConnect: (connection) => set((state) => ({
    edges: addEdge(connection, state.edges),
  })),

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

  addCustomProvider: (provider) => set((state) => ({
    customProviders: [...state.customProviders.filter(p => p.id !== provider.id), provider]
  })),

  setActiveCustomProviderId: (id) => set({ activeCustomProviderId: id }),
  setActiveModel: (model) => set({ activeModel: model }),
  
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

  openTab: (tab) => set((state) => {
    const exists = state.openTabs.some((t) => t.id === tab.id);
    const newTabs = exists ? state.openTabs : [...state.openTabs, tab];
    return { openTabs: newTabs, activeTabId: tab.id };
  }),
  closeTab: (id) => set((state) => {
    if (id === "canvas") return {};
    const remainingTabs = state.openTabs.filter((t) => t.id !== id);
    let nextActiveTabId = state.activeTabId;
    if (state.activeTabId === id) {
      nextActiveTabId = remainingTabs.length > 0 ? remainingTabs[remainingTabs.length - 1].id : null;
    }
    return { openTabs: remainingTabs, activeTabId: nextActiveTabId };
  }),
  setActiveTabId: (id) => set({ activeTabId: id }),
  setPathExpanded: (path, expanded) => set((state) => ({
    expandedPaths: { ...state.expandedPaths, [path]: expanded }
  })),
  togglePathExpanded: (path) => set((state) => ({
    expandedPaths: { ...state.expandedPaths, [path]: !state.expandedPaths[path] }
  })),
  collapseAllFolders: () => set({
    expandedPaths: {},
    collapseAllTrigger: Date.now()
  })
}));
