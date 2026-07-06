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
import { skillsService } from "./services/skillsService";
import { vfsService } from "./services/vfsService";
import { McpServerConfig } from "./components/mcp/types";

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
  type: "canvas" | "axiom" | "file" | "task" | "settings" | "llm-setup" | "git-diff" | "git-history" | "workspace" | "agent" | "skills" | "mcp-integration";
  title: string;
  key: string;
  diffType?: "staged" | "unstaged" | "commit";
  commitHash?: string;
  line?: number;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool-result" | "console";
  content: string;
  timestamp: string;
  toolCalls?: AgentToolCall[];
  attachments?: { path: string; name: string }[];
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
  status: "pending" | "approved" | "denied" | "executed" | "error";
  result?: string;
}

export interface AgentPermissionRequest {
  id: string;
  toolCall: AgentToolCall;
  description: string;
  timestamp: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  enabledTools: string[];
  preferredModel?: string;
  mcpServers: string[];
  isBuiltIn: boolean;
  icon?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EditorGroup {
  id: string;
  openTabs: Tab[];
  activeTabId: string | null;
}

export interface GlobalChatMessage {
  id?: string;
  role: "user" | "assistant" | "system" | "console";
  content: string;
  timestamp: string;
  attachments?: { path: string; name: string; isDir?: boolean }[];
}

export interface CanvasContext {
  nodes: Node[];
  edges: Edge[];
  nodeLogs: Record<string, string[]>;
  nodeStatus: Record<string, "idle" | "running" | "success" | "error">;
  globalChatHistory: Record<string, GlobalChatMessage[]>;
  edgeReconciliationStatus: Record<string, "idle" | "unreconciled" | "reconciled">;
  isPipelineApplied?: boolean;
  lastStickyColor?: string;
}

export interface LspServerConfig {
  serverPath: string;
  args: string[];
}

export interface LspSettings {
  enabled: boolean;
  servers: Record<string, LspServerConfig>;
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
  lastRename: { originalPath: string; newPath: string } | null;
  setLastRename: (rename: { originalPath: string; newPath: string } | null) => void;
  collapseAllTrigger?: number;
  expandedPaths: Record<string, boolean>;
  revealPath: string | null;
  selectedEdgeId: string | null;
  edgeReconciliationStatus: Record<string, "idle" | "unreconciled" | "reconciled">;
  
  canvasContexts: Record<string, CanvasContext>;
  onNodesChangeForTab: (tabId: string, changes: any[]) => void;
  onEdgesChangeForTab: (tabId: string, changes: any[]) => void;
  onConnectForTab: (tabId: string, connection: Connection) => void;
  updateCanvasContext: (tabId: string, updates: Partial<CanvasContext>) => void;
  loadCanvasTab: (data: any) => string;
  createCanvasTab: (title?: string) => void;
  createAgentTab: (title?: string) => void;

  agentChats: Record<string, AgentMessage[]>;
  agentStreams: Record<string, string>;
  agentPermissionRequests: Record<string, AgentPermissionRequest[]>;
  addAgentMessage: (tabId: string, message: AgentMessage) => void;
  updateAgentMessage: (tabId: string, messageId: string, content: string) => void;
  setAgentMessages: (tabId: string, messages: AgentMessage[]) => void;
  clearAgentMessages: (tabId: string) => void;
  updateAgentStream: (tabId: string, content: string) => void;
  clearAgentStream: (tabId: string) => void;
  addAgentPermissionRequest: (tabId: string, request: AgentPermissionRequest) => void;
  resolveAgentPermission: (tabId: string, requestId: string, approved: boolean) => void;

  skills: Skill[];
  activeSkillId: string | null;
  addSkill: (skill: Skill) => void;
  updateSkill: (id: string, updates: Partial<Skill>) => void;
  deleteSkill: (id: string) => void;
  setActiveSkill: (id: string | null) => void;
  loadSkills: () => Promise<void>;

  mcpServers: Record<string, McpServerConfig>;
  setMcpServers: (servers: Record<string, McpServerConfig>) => void;
  addMcpServer: (server: McpServerConfig) => void;
  updateMcpServer: (name: string, updates: Partial<McpServerConfig>) => void;
  removeMcpServer: (name: string) => void;

  activeThemeId: string;
  setActiveThemeId: (themeId: string) => void;
  
  setRootPath: (path: string) => void;
  setGitStatus: (status: GitStatusResult | null) => void;
  loadGitStatus: (rootDir?: string) => Promise<void>;
  setFileTree: (tree: any[]) => void;
  setSelectedNodeId: (id: string | null) => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: (connection: Connection) => void;
  
  addContextNode: (x: number, y: number, fileContext?: { path: string; name: string; isDir: boolean }, tabId?: string) => void;
  addTaskNode: (x: number, y: number, tabId?: string) => void;
  addGlobalChatNode: (x: number, y: number, tabId?: string) => void;
  addMcpNode: (x: number, y: number, tabId?: string) => void;
  addStickyNode: (x: number, y: number, tabId?: string, color?: string) => void;
  addBoundaryNode: (x: number, y: number, tabId?: string) => void;
  updateTaskNode: (id: string, data: any) => void;
  updateNodePosition: (id: string, x: number, y: number) => void;
  deleteNode: (id: string) => void;
  addLog: (nodeId: string, message: string) => void;
  clearLogs: (nodeId: string) => void;
  setNodeStatus: (nodeId: string, status: "idle" | "running" | "success" | "error") => void;
  setGlobalContextSummary: (summary: string) => void;
  addGlobalChatMessage: (nodeId: string, message: GlobalChatMessage) => void;
  updateGlobalChatMessage: (nodeId: string, messageId: string, content: string) => void;
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
  
  terminalTabs: { id: string; name: string; type: "dev-logs" | "local"; cwd?: string }[];
  activeTerminalTabId: string | null;
  initTerminalState: (isDev: boolean) => void;
  addTerminalTab: (type: "dev-logs" | "local", cwd?: string) => void;
  closeTerminalTab: (id: string) => void;
  setActiveTerminalTabId: (id: string) => void;

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
  revealFileInTree: (filePath: string) => void;
  clearRevealPath: () => void;
  addAndConnectContextNode: (x: number, y: number, taskId: string, taskHandleId: string, tabId?: string) => void;
  getGlobalChatHistory: (nodeId: string) => GlobalChatMessage[];
  setSelectedEdgeId: (id: string | null) => void;
  setEdgeStatus: (edgeId: string, status: "idle" | "unreconciled" | "reconciled") => void;
  getSequenceEdges: () => Edge[];
  updateTabTitle: (tabId: string, title: string) => void;
  lspSettings: LspSettings;
  updateLspSettings: (settings: Partial<LspSettings>) => void;
  saveSecureConfig: () => Promise<void>;
  loadSecureConfig: () => Promise<void>;
}

// Helper to find the active canvas tab ID from the editor groups
const getActiveCanvasTabId = (state: WorkspaceState): string => {
  const activeGroup = state.editorGroups.find((g) => g.id === state.activeGroupId);
  if (activeGroup && activeGroup.activeTabId) {
    const activeTab = activeGroup.openTabs.find((t) => t.id === activeGroup.activeTabId);
    if (activeTab && activeTab.type === "canvas") {
      return activeTab.id;
    }
  }
  for (const group of state.editorGroups) {
    const canvasTab = group.openTabs.find((t) => t.type === "canvas");
    if (canvasTab) return canvasTab.id;
  }
  return "canvas";
};

// Helper to get or create tab context
const getOrCreateContext = (state: WorkspaceState, tabId: string): CanvasContext => {
  if (!state.canvasContexts) {
    state.canvasContexts = {};
  }
  if (!state.canvasContexts[tabId]) {
    state.canvasContexts[tabId] = {
      nodes: [],
      edges: [],
      nodeLogs: {},
      nodeStatus: {},
      globalChatHistory: {},
      edgeReconciliationStatus: {},
      isPipelineApplied: false
    };
  }
  return state.canvasContexts[tabId];
};

// Helper to find tabId containing a node
const findTabIdByNodeId = (state: WorkspaceState, nodeId: string): string => {
  if (state.canvasContexts) {
    for (const tabId in state.canvasContexts) {
      const ctx = state.canvasContexts[tabId];
      if (ctx.nodes && ctx.nodes.some((n) => n.id === nodeId)) {
        return tabId;
      }
    }
  }
  return getActiveCanvasTabId(state);
};

// Helper to find tabId containing an edge
const findTabIdByEdgeId = (state: WorkspaceState, edgeId: string): string => {
  if (state.canvasContexts) {
    for (const tabId in state.canvasContexts) {
      const ctx = state.canvasContexts[tabId];
      if (ctx.edges && ctx.edges.some((e) => e.id === edgeId)) {
        return tabId;
      }
    }
  }
  return getActiveCanvasTabId(state);
};

// Helper to update context and sync to top-level state
const updateContextAndSync = (
  state: WorkspaceState,
  tabId: string,
  updater: (ctx: CanvasContext) => Partial<CanvasContext>
): Partial<WorkspaceState> => {
  const ctx = getOrCreateContext(state, tabId);
  const updates = updater(ctx);
  
  // Auto-reset applied status if graph structure is modified
  const shouldResetApplied = 
    ("nodes" in updates || "edges" in updates) && 
    !("isPipelineApplied" in updates);

  const newCanvasContexts = {
    ...state.canvasContexts,
    [tabId]: {
      ...ctx,
      ...updates,
      ...(shouldResetApplied ? { isPipelineApplied: false } : {})
    }
  };
  
  const tempState = {
    ...state,
    canvasContexts: newCanvasContexts
  };
  
  const activeTabId = getActiveCanvasTabId(tempState);
  const activeCtx = newCanvasContexts[activeTabId] || {
    nodes: [],
    edges: [],
    nodeLogs: {},
    nodeStatus: {},
    globalChatHistory: {},
    edgeReconciliationStatus: {},
    isPipelineApplied: false
  };
  
  return {
    canvasContexts: newCanvasContexts,
    nodes: activeCtx.nodes,
    edges: activeCtx.edges,
    nodeLogs: activeCtx.nodeLogs,
    nodeStatus: activeCtx.nodeStatus,
    globalChatHistory: activeCtx.globalChatHistory,
    edgeReconciliationStatus: activeCtx.edgeReconciliationStatus
  };
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  rootPath: "",
  nodes: [],
  edges: [],
  selectedNodeId: null,
  fileTree: [],
  nodeLogs: {},
  nodeStatus: {},
  expandedPaths: {},
  revealPath: null,
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
  lspSettings: {
    enabled: true,
    servers: {
      typescript: { serverPath: "typescript-language-server", args: ["--stdio"] },
      python: { serverPath: "pyright-langserver", args: ["--stdio"] },
      go: { serverPath: "gopls", args: [] },
      rust: { serverPath: "rust-analyzer", args: [] },
      java: { serverPath: "jdtls", args: [] },
      c: { serverPath: "clangd", args: [] },
      cpp: { serverPath: "clangd", args: [] },
      csharp: { serverPath: "csharp-ls", args: [] },
      ruby: { serverPath: "ruby-lsp", args: [] },
      php: { serverPath: "intelephense", args: ["--stdio"] },
      lua: { serverPath: "lua-language-server", args: [] },
      bash: { serverPath: "bash-language-server", args: ["start"] },
      json: { serverPath: "vscode-json-language-server", args: ["--stdio"] },
      yaml: { serverPath: "yaml-language-server", args: ["--stdio"] },
      html: { serverPath: "vscode-html-language-server", args: ["--stdio"] },
      css: { serverPath: "vscode-css-language-server", args: ["--stdio"] }
    }
  },
  updateLspSettings: (settings) => set((state) => {
    const updated = { ...state.lspSettings, ...settings };
    setTimeout(() => useWorkspaceStore.getState().saveSecureConfig(), 0);
    return { lspSettings: updated };
  }),
  gitStatus: null,
  lastRename: null,
  setLastRename: (rename) => set({ lastRename: rename }),
  devLogs: [],
  showDevConsole: false,
  terminalTabs: [],
  activeTerminalTabId: null,
  skills: [
    {
      id: "skill_build",
      name: "build",
      description: "Focus on implementing features, writing clean code, and running tests. Be action-oriented.",
      systemPrompt: "You are an AI coding agent specialized in building features and implementing code. Your focus is to take user requirements and turn them into working code as efficiently as possible.\n\nGuidelines:\n- Write clean, maintainable code\n- Follow the existing code style and patterns in the project\n- Break down complex tasks into manageable pieces\n- Test your changes when possible\n- Keep explanations concise but informative\n- When done, summarize what was implemented",
      enabledTools: ["read_file", "write_file", "list_files", "search_codebase"],
      mcpServers: [],
      isBuiltIn: true,
      icon: "hammer",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "skill_plan",
      name: "plan",
      description: "Analyze architecture, explore code, and propose plans. Read-only focus.",
      systemPrompt: "You are an AI coding agent specialized in analysis, architecture planning, and code exploration. Your focus is to deeply understand the codebase and help users plan their approach.\n\nGuidelines:\n- Read and analyze existing code thoroughly before making suggestions\n- Ask clarifying questions to understand the full context\n- Provide structured plans with clear steps\n- Identify potential issues or risks in proposed approaches\n- Suggest trade-offs and alternatives\n- Do NOT write code unless explicitly requested\n- When exploring, provide detailed findings about the code structure",
      enabledTools: ["read_file", "list_files", "search_codebase"],
      mcpServers: [],
      isBuiltIn: true,
      icon: "map",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "skill_grind_me",
      name: "grind-me",
      description: "Ask many clarifying questions before doing anything. Thoroughly understand requirements first.",
      systemPrompt: "You are an AI coding agent specialized in understanding requirements through dialogue. Before taking any action, you must thoroughly understand what the user wants to achieve.\n\nGuidelines:\n- Ask detailed clarifying questions about requirements\n- Break down the task into smaller, well-defined pieces\n- Understand the desired outcome before suggesting approaches\n- Explore the relevant parts of the codebase to ground your understanding\n- Confirm your understanding with the user before proceeding\n- Do not write any code until you have a thorough understanding\n- Use questions to uncover requirements, constraints, and priorities\n- Be thorough - it's better to ask more questions now than to misunderstand later\n- Once you fully understand the task, propose a clear action plan for user approval",
      enabledTools: ["read_file", "write_file", "list_files", "search_codebase"],
      mcpServers: [],
      isBuiltIn: true,
      icon: "help",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "skill_task_auditor",
      name: "task-auditor",
      description: "Analyze tasks and suggest changes, approaches, and execution plans. Do not write code.",
      systemPrompt: "You are an AI task auditing agent specialized in analyzing requirements, suggesting changes, and planning task execution. You do NOT write code or make changes - you only discuss, analyze, and propose.\n\nGuidelines:\n- Understand the task or goal through dialogue\n- Analyze the codebase to understand the current state\n- Identify what changes would be needed and where\n- Suggest alternative approaches and trade-offs\n- Break down tasks into clear, executable steps\n- Estimate effort and complexity for each step\n- Do NOT write, modify, or create any code\n- Do NOT execute commands or make file changes\n- Focus on planning, analysis, and recommendation\n- Ask clarifying questions to fully understand the desired outcome\n- Once you understand the task, provide a detailed execution plan\n\nContext Node Creation:\nWhen discussing files that are relevant to a task, you can request the system to automatically create ContextNodes on the canvas for those files. To do this, include the following marker in your response:\n\n[CREATE_CONTEXT_NODES]\n/full/path/to/file1.ts\n/full/path/to/file2.ts\n\nList each file path on a separate line. The system will create context nodes for these files next to the Task Auditor node on the canvas. Use absolute paths.",
      enabledTools: ["read_file", "list_files", "search_codebase"],
      mcpServers: [],
      isBuiltIn: true,
      icon: "lightbulb",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  activeSkillId: null,
  mcpServers: (() => {
    try {
      const raw = localStorage.getItem("axiom_mcp_config");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.mcpServers && typeof parsed.mcpServers === "object") {
          return parsed.mcpServers as Record<string, McpServerConfig>;
        }
      }
    } catch { /* ignore */ }
    return {};
  })(),
  editorGroups: [
    { id: "group_0", openTabs: [{ id: "canvas", type: "canvas" as const, title: "Axiom", key: "canvas" }], activeTabId: "canvas" }
  ],
  activeGroupId: "group_0",
  groupSizes: [1.0],
  canvasContexts: {
    canvas: {
      nodes: [],
      edges: [],
      nodeLogs: {},
      nodeStatus: {},
      globalChatHistory: {},
      edgeReconciliationStatus: {},
      isPipelineApplied: false
    }
  },
  activeThemeId: localStorage.getItem("selected_theme") || "spaceDust",
  setActiveThemeId: (themeId) => {
    const t = themes[themeId] || themes.spaceDust;
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
      canvasContexts: {
        canvas: {
          nodes: [],
          edges: [],
          nodeLogs: {},
          nodeStatus: {},
          globalChatHistory: {},
          edgeReconciliationStatus: {},
          isPipelineApplied: false
        }
      },
      expandedPaths: {},
  revealPath: null,
      nodes: [],
      edges: [],
      selectedNodeId: null,
      nodeLogs: {},
      nodeStatus: {}
    });
    useWorkspaceStore.getState().loadGitStatus();
    useWorkspaceStore.getState().loadSkills();
    setTimeout(() => useWorkspaceStore.getState().saveSecureConfig(), 0);
  },
  setGitStatus: (status) => set({ gitStatus: status }),
  loadGitStatus: async (rootDir) => {
    const rootPath = rootDir || useWorkspaceStore.getState().rootPath;
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
  loadSkills: async () => {
    const rootPath = useWorkspaceStore.getState().rootPath;
    if (!rootPath) return;
    try {
      const userSkills = await skillsService.loadSkills(rootPath);
      const builtInSkills = useWorkspaceStore.getState().skills.filter(s => s.isBuiltIn);
      const existingUserIds = new Set(builtInSkills.map(s => s.id));
      const newUserSkills = userSkills
        .filter((us: Skill) => !existingUserIds.has(us.id))
        .map((us: Skill) => ({ ...us, mcpServers: us.mcpServers || [] }));
      const allSkills = [...builtInSkills, ...newUserSkills];
      set({ skills: allSkills });
    } catch (e) {
      console.error("Failed to load skills:", e);
    }
  },
  setFileTree: (tree) => set({ fileTree: tree }),
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  
  onNodesChange: (changes) => set((state) => {
    const activeTabId = getActiveCanvasTabId(state);
    const structural = changes.some((c: any) => c.type === "add" || c.type === "remove");
    return updateContextAndSync(state, activeTabId, (ctx) => ({
      nodes: applyNodeChanges(changes, ctx.nodes),
      ...(!structural ? { isPipelineApplied: ctx.isPipelineApplied } : {})
    }));
  }),

  onEdgesChange: (changes) => set((state) => {
    const activeTabId = getActiveCanvasTabId(state);
    const structural = changes.some((c: any) => c.type === "add" || c.type === "remove");
    return updateContextAndSync(state, activeTabId, (ctx) => ({
      edges: applyEdgeChanges(changes, ctx.edges),
      ...(!structural ? { isPipelineApplied: ctx.isPipelineApplied } : {})
    }));
  }),
  
  onConnect: (connection) => set((state) => {
    const activeTabId = getActiveCanvasTabId(state);
    const isContext = connection.source?.startsWith("context");
    const edgeStyle = isContext ? { stroke: "#10b981", strokeWidth: 2 } : undefined;
    const newEdge = {
      ...connection,
      style: edgeStyle
    };
    return updateContextAndSync(state, activeTabId, (ctx) => ({
      edges: addEdge(newEdge, ctx.edges)
    }));
  }),

  onNodesChangeForTab: (tabId, changes) => set((state) => {
    const structural = changes.some((c: any) => c.type === "add" || c.type === "remove");
    return updateContextAndSync(state, tabId, (ctx) => ({
      nodes: applyNodeChanges(changes, ctx.nodes),
      ...(!structural ? { isPipelineApplied: ctx.isPipelineApplied } : {})
    }));
  }),

  onEdgesChangeForTab: (tabId, changes) => set((state) => {
    const structural = changes.some((c: any) => c.type === "add" || c.type === "remove");
    return updateContextAndSync(state, tabId, (ctx) => ({
      edges: applyEdgeChanges(changes, ctx.edges),
      ...(!structural ? { isPipelineApplied: ctx.isPipelineApplied } : {})
    }));
  }),

  onConnectForTab: (tabId, connection) => set((state) => {
    const isContext = connection.source?.startsWith("context");
    const isMcp = connection.source?.startsWith("mcp");
    const edgeStyle = isContext
      ? { stroke: "#10b981", strokeWidth: 2 }
      : isMcp
      ? { stroke: "#0ea5e9", strokeWidth: 2 }
      : undefined;
    const newEdge = {
      ...connection,
      style: edgeStyle
    };
    return updateContextAndSync(state, tabId, (ctx) => ({
      edges: addEdge(newEdge, ctx.edges)
    }));
  }),

  updateCanvasContext: (tabId, updates) => set((state) => {
    return updateContextAndSync(state, tabId, () => updates);
  }),

  loadCanvasTab: (data) => {
    const tabId = data.id || `canvas_${Date.now()}`;
    set((state) => {
      const title = data.title || "Untitled Pipeline";
      const newTab = {
        id: tabId,
        type: "canvas" as const,
        title: title,
        key: `canvas_${tabId}`
      };
      
      let tabExists = false;
      let targetGroupId = state.activeGroupId;
      
      for (const group of state.editorGroups) {
        if (group.openTabs.some((t) => t.id === tabId)) {
          tabExists = true;
          targetGroupId = group.id;
          break;
        }
      }
      
      let newGroups = state.editorGroups;
      let newCanvasContexts = state.canvasContexts;
      if (!tabExists) {
        newGroups = state.editorGroups.map((group) => {
          if (group.id === targetGroupId) {
            return {
              ...group,
              openTabs: [...group.openTabs, newTab],
              activeTabId: tabId
            };
          }
          return group;
        });
        newCanvasContexts = {
          ...state.canvasContexts,
          [tabId]: {
            nodes: data.nodes || [],
            edges: data.edges || [],
            nodeLogs: data.nodeLogs || {},
            nodeStatus: data.nodeStatus || {},
            globalChatHistory: data.globalChatHistory || {},
            edgeReconciliationStatus: data.edgeReconciliationStatus || {},
            isPipelineApplied: data.isPipelineApplied || false
          }
        };
      } else {
        newGroups = state.editorGroups.map((group) => {
          if (group.id === targetGroupId) {
            return {
              ...group,
              activeTabId: tabId
            };
          }
          return group;
        });
        newCanvasContexts = {
          ...state.canvasContexts,
          [tabId]: {
            nodes: data.nodes || [],
            edges: data.edges || [],
            nodeLogs: data.nodeLogs || {},
            nodeStatus: data.nodeStatus || {},
            globalChatHistory: data.globalChatHistory || {},
            edgeReconciliationStatus: data.edgeReconciliationStatus || {},
            isPipelineApplied: data.isPipelineApplied || false
          }
        };
      }
      
      const tempState = {
        ...state,
        editorGroups: newGroups,
        activeGroupId: targetGroupId,
        canvasContexts: newCanvasContexts
      };
      const activeCtx = getOrCreateContext(tempState, tabId);
      
      return {
        editorGroups: newGroups,
        activeGroupId: targetGroupId,
        canvasContexts: newCanvasContexts,
        nodes: activeCtx.nodes,
        edges: activeCtx.edges,
        nodeLogs: activeCtx.nodeLogs,
        nodeStatus: activeCtx.nodeStatus,
        globalChatHistory: activeCtx.globalChatHistory,
        edgeReconciliationStatus: activeCtx.edgeReconciliationStatus
      };
    });
    return tabId;
  },

  createCanvasTab: (title) => set((state) => {
    const tabId = `canvas_${Date.now()}`;
    const name = title || `Pipeline ${Object.keys(state.canvasContexts || {}).length + 1}`;
    const newTab = {
      id: tabId,
      type: "canvas" as const,
      title: name,
      key: `canvas_${tabId}`
    };
    
    const targetGroupId = state.activeGroupId;
    const newGroups = state.editorGroups.map((group) => {
      if (group.id === targetGroupId) {
        return {
          ...group,
          openTabs: [...group.openTabs, newTab],
          activeTabId: tabId
        };
      }
      return group;
    });
    
    const newCanvasContexts = {
      ...state.canvasContexts,
      [tabId]: {
        nodes: [],
        edges: [],
        nodeLogs: {},
        nodeStatus: {},
        globalChatHistory: {},
        edgeReconciliationStatus: {},
        isPipelineApplied: false
      }
    };
    
    return {
      editorGroups: newGroups,
      canvasContexts: newCanvasContexts,
      nodes: [],
      edges: [],
      nodeLogs: {},
      nodeStatus: {},
      globalChatHistory: {},
      edgeReconciliationStatus: {}
    };
  }),

  createAgentTab: (title) => set((state) => {
    const tabId = `agent_${Date.now()}`;
    const name = title || `Agent ${Object.keys(state.agentChats || {}).length + 1}`;
    const newTab = {
      id: tabId,
      type: "agent" as const,
      title: name,
      key: tabId
    };

    const targetGroupId = state.activeGroupId;
    const newGroups = state.editorGroups.map((group) => {
      if (group.id === targetGroupId) {
        return {
          ...group,
          openTabs: [...group.openTabs, newTab],
          activeTabId: tabId
        };
      }
      return group;
    });

    const newAgentChats = {
      ...state.agentChats,
      [tabId]: []
    };

    return {
      editorGroups: newGroups,
      agentChats: newAgentChats
    };
  }),

  agentChats: {},
  agentStreams: {},
  agentPermissionRequests: {},

  addAgentMessage: (tabId, message) => set((state) => {
    const currentMessages = state.agentChats[tabId] || [];
    return {
      agentChats: {
        ...state.agentChats,
        [tabId]: [...currentMessages, message]
      }
    };
  }),

  updateAgentMessage: (tabId, messageId, content) => set((state) => {
    const currentMessages = state.agentChats[tabId] || [];
    return {
      agentChats: {
        ...state.agentChats,
        [tabId]: currentMessages.map((m) => m.id === messageId ? { ...m, content } : m)
      }
    };
  }),

  setAgentMessages: (tabId, messages) => set((state) => ({
    agentChats: {
      ...state.agentChats,
      [tabId]: messages
    }
  })),

  clearAgentMessages: (tabId) => set((state) => ({
    agentChats: {
      ...state.agentChats,
      [tabId]: []
    }
  })),

  updateAgentStream: (tabId, content) => set((state) => {
    return {
      agentStreams: {
        ...state.agentStreams,
        [tabId]: content
      }
    };
  }),

  clearAgentStream: (tabId) => set((state) => {
    const newStreams = { ...state.agentStreams };
    delete newStreams[tabId];
    return { agentStreams: newStreams };
  }),

  addAgentPermissionRequest: (tabId, request) => set((state) => {
    const currentRequests = state.agentPermissionRequests[tabId] || [];
    return {
      agentPermissionRequests: {
        ...state.agentPermissionRequests,
        [tabId]: [...currentRequests, request]
      }
    };
  }),

  resolveAgentPermission: (tabId, requestId, approved) => set((state) => {
    const currentRequests = state.agentPermissionRequests[tabId] || [];
    const updatedRequests = currentRequests.map((req) => {
      if (req.id === requestId) {
        return {
          ...req,
          status: approved ? "approved" as const : "denied" as const
        };
      }
      return req;
    });
    return {
      agentPermissionRequests: {
        ...state.agentPermissionRequests,
        [tabId]: updatedRequests
      }
    };
  }),

  addSkill: (skill) => set((state) => {
    const existing = state.skills.find(s => s.id === skill.id);
    if (existing) {
      return { skills: state.skills.map(s => s.id === skill.id ? skill : s) };
    }
    return { skills: [...state.skills, skill] };
  }),

  updateSkill: (id, updates) => set((state) => ({
    skills: state.skills.map(s => s.id === id ? { ...s, ...updates, updatedAt: new Date().toISOString() } : s)
  })),

  deleteSkill: (id) => set((state) => ({
    skills: state.skills.filter(s => s.id !== id),
    activeSkillId: state.activeSkillId === id ? null : state.activeSkillId
  })),

  setActiveSkill: (id) => set({ activeSkillId: id }),

  setMcpServers: (servers) => {
    set({ mcpServers: servers });
    setTimeout(() => useWorkspaceStore.getState().saveSecureConfig(), 0);
  },
  addMcpServer: (server) => set((state) => {
    const next = { ...state.mcpServers, [server.name]: server };
    setTimeout(() => useWorkspaceStore.getState().saveSecureConfig(), 0);
    return { mcpServers: next };
  }),
  updateMcpServer: (name, updates) => set((state) => {
    const existing = state.mcpServers[name];
    if (!existing) return {};
    const next = { ...state.mcpServers, [name]: { ...existing, ...updates } };
    setTimeout(() => useWorkspaceStore.getState().saveSecureConfig(), 0);
    return { mcpServers: next };
  }),
  removeMcpServer: (name) => set((state) => {
    const next = { ...state.mcpServers };
    delete next[name];
    setTimeout(() => useWorkspaceStore.getState().saveSecureConfig(), 0);
    return { mcpServers: next };
  }),

  addContextNode: (x, y, fileContext, tabId) => set((state) => {
    const targetTabId = tabId || getActiveCanvasTabId(state);
    const id = `context_${Date.now()}`;
    const targetCtx = getOrCreateContext(state, targetTabId);
    
    let finalX = x;
    let finalY = y;
    let attempts = 0;
    while (
      targetCtx.nodes.some(
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
    return updateContextAndSync(state, targetTabId, (ctx) => ({
      nodes: [...ctx.nodes, newNode]
    }));
  }),

  addTaskNode: (x, y, tabId) => set((state) => {
    const targetTabId = tabId || getActiveCanvasTabId(state);
    const id = `task_${Date.now()}`;
    const targetCtx = getOrCreateContext(state, targetTabId);
    
    let finalX = x;
    let finalY = y;
    let attempts = 0;
    while (
      targetCtx.nodes.some(
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
    return updateContextAndSync(state, targetTabId, (ctx) => ({
      nodes: [...ctx.nodes, newNode]
    }));
  }),

  addGlobalChatNode: (x, y, tabId) => set((state) => {
    const targetTabId = tabId || getActiveCanvasTabId(state);
    const id = `global_chat_${Date.now()}`;
    const targetCtx = getOrCreateContext(state, targetTabId);

    let finalX = x;
    let finalY = y;
    let attempts = 0;
    while (
      targetCtx.nodes.some(
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
        name: "Task Auditor",
        status: "idle",
        summary: "",
        width: 384,
        height: 220,
        skillId: "skill_task_auditor"
      }
    };
    return updateContextAndSync(state, targetTabId, (ctx) => ({
      nodes: [...ctx.nodes, newNode]
    }));
  }),

  addMcpNode: (x, y, tabId) => set((state) => {
    const targetTabId = tabId || getActiveCanvasTabId(state);
    const id = `mcp_${Date.now()}`;
    const targetCtx = getOrCreateContext(state, targetTabId);

    let finalX = x;
    let finalY = y;
    let attempts = 0;
    while (
      targetCtx.nodes.some(
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
      type: "mcpNode",
      position: { x: finalX, y: finalY },
      data: {
        id,
        name: "MCP Context",
        mcpServerName: "",
        description: "",
      }
    };
    return updateContextAndSync(state, targetTabId, (ctx) => ({
      nodes: [...ctx.nodes, newNode]
    }));
  }),

  addStickyNode: (x, y, tabId, color) => set((state) => {
    const targetTabId = tabId || getActiveCanvasTabId(state);
    const id = `sticky_${Date.now()}`;
    const targetCtx = getOrCreateContext(state, targetTabId);

    const lastColor = color || targetCtx.lastStickyColor || "yellow";

    let finalX = x;
    let finalY = y;
    let attempts = 0;
    while (
      targetCtx.nodes.some(
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
      type: "stickyNode",
      position: { x: finalX, y: finalY },
      data: {
        id,
        color: lastColor,
        content: "",
        width: 200,
        height: 150
      }
    };
    return updateContextAndSync(state, targetTabId, (ctx) => ({
      nodes: [...ctx.nodes, newNode],
      lastStickyColor: lastColor
    }));
  }),

  addBoundaryNode: (x, y, tabId) => set((state) => {
    const targetTabId = tabId || getActiveCanvasTabId(state);
    const id = `boundary_${Date.now()}`;

    const newNode: Node = {
      id,
      type: "boundaryNode",
      position: { x, y },
      selectable: false,
      draggable: false,
      zIndex: 0,
      data: {
        id,
        name: "Boundary",
        width: 300,
        height: 200
      }
    };
    return updateContextAndSync(state, targetTabId, (ctx) => ({
      nodes: [...ctx.nodes, newNode]
    }));
  }),

  updateTaskNode: (id, data) => set((state) => {
    const targetTabId = findTabIdByNodeId(state, id);
    return updateContextAndSync(state, targetTabId, (ctx) => ({
      nodes: ctx.nodes.map((node) => {
        if (node.id === id) {
          return { ...node, data: { ...node.data, ...data } };
        }
        return node;
      }),
      isPipelineApplied: ctx.isPipelineApplied
    }));
  }),

  updateNodePosition: (id, x, y) => set((state) => {
    const targetTabId = findTabIdByNodeId(state, id);
    return updateContextAndSync(state, targetTabId, (ctx) => ({
      nodes: ctx.nodes.map((node) => {
        if (node.id === id) {
          return { ...node, position: { x, y } };
        }
        return node;
      }),
      isPipelineApplied: ctx.isPipelineApplied
    }));
  }),

  deleteNode: (id) => set((state) => {
    const targetTabId = findTabIdByNodeId(state, id);
    const updates = updateContextAndSync(state, targetTabId, (ctx) => {
      const nodeToDelete = ctx.nodes.find((node) => node.id === id);
      const isTaskNode = nodeToDelete?.type === "taskNode";

      if (isTaskNode) {
        vfsService.deleteNodeVfsFiles(id, targetTabId).catch(err => {
          console.error(`[store] Failed to delete VFS files for node ${id}:`, err);
        });
      }

      const newNodes = ctx.nodes.filter((node) => node.id !== id);
      const newEdges = ctx.edges.filter((edge) => edge.source !== id && edge.target !== id);
      const newNodeLogs = { ...ctx.nodeLogs };
      delete newNodeLogs[id];
      const newNodeStatus = { ...ctx.nodeStatus };
      delete newNodeStatus[id];
      return {
        nodes: newNodes,
        edges: newEdges,
        nodeLogs: newNodeLogs,
        nodeStatus: newNodeStatus
      };
    });
    return {
      ...updates,
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId
    };
  }),

  addLog: (nodeId, message) => set((state) => {
    const targetTabId = findTabIdByNodeId(state, nodeId);
    return updateContextAndSync(state, targetTabId, (ctx) => {
      const currentLogs = ctx.nodeLogs[nodeId] || [];
      return {
        nodeLogs: {
          ...ctx.nodeLogs,
          [nodeId]: [...currentLogs, `[${new Date().toLocaleTimeString()}] ${message}`]
        }
      };
    });
  }),

  clearLogs: (nodeId) => set((state) => {
    const targetTabId = findTabIdByNodeId(state, nodeId);
    return updateContextAndSync(state, targetTabId, (ctx) => ({
      nodeLogs: { ...ctx.nodeLogs, [nodeId]: [] }
    }));
  }),

  setNodeStatus: (nodeId, status) => set((state) => {
    const targetTabId = findTabIdByNodeId(state, nodeId);
    return updateContextAndSync(state, targetTabId, (ctx) => ({
      nodeStatus: { ...ctx.nodeStatus, [nodeId]: status }
    }));
  }),

  setGlobalContextSummary: (summary) => set({ globalContextSummary: summary }),

  addGlobalChatMessage: (nodeId, message) => set((state) => {
    const targetTabId = findTabIdByNodeId(state, nodeId);
    return updateContextAndSync(state, targetTabId, (ctx) => {
      const history = ctx.globalChatHistory[nodeId] || [];
      return {
        globalChatHistory: {
          ...ctx.globalChatHistory,
          [nodeId]: [...history, message]
        }
      };
    });
  }),

  updateGlobalChatMessage: (nodeId, messageId, content) => set((state) => {
    const targetTabId = findTabIdByNodeId(state, nodeId);
    return updateContextAndSync(state, targetTabId, (ctx) => {
      const history = ctx.globalChatHistory[nodeId] || [];
      return {
        globalChatHistory: {
          ...ctx.globalChatHistory,
          [nodeId]: history.map((m) =>
            m.id === messageId ? { ...m, content } : m
          )
        }
      };
    });
  }),

  clearGlobalChatHistory: (nodeId) => set((state) => {
    const targetTabId = findTabIdByNodeId(state, nodeId);
    return updateContextAndSync(state, targetTabId, (ctx) => ({
      globalChatHistory: { ...ctx.globalChatHistory, [nodeId]: [] }
    }));
  }),

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

  initTerminalState: (isDev) => set((state) => {
    if (state.terminalTabs.length > 0) return {};
    const tabs = [];
    if (isDev) {
      tabs.push({ id: "dev-logs", name: "Dev Logs", type: "dev-logs" as const });
    }
    tabs.push({ id: `terminal-${Date.now()}`, name: "Terminal 1", type: "local" as const });
    return {
      terminalTabs: tabs,
      activeTerminalTabId: tabs[0].id
    };
  }),

  addTerminalTab: (type, cwd) => set((state) => {
    const id = `terminal-${Date.now()}`;
    const localCount = state.terminalTabs.filter(t => t.type === 'local').length + 1;
    const name = type === 'dev-logs' ? 'Dev Logs' : `Terminal ${localCount}`;
    const newTab = { id, name, type, cwd };
    return {
      terminalTabs: [...state.terminalTabs, newTab],
      activeTerminalTabId: id,
      showDevConsole: true
    };
  }),

  closeTerminalTab: (id) => set((state) => {
    const tabs = state.terminalTabs.filter(t => t.id !== id);
    let activeId = state.activeTerminalTabId;
    if (activeId === id) {
      const idx = state.terminalTabs.findIndex(t => t.id === id);
      if (tabs.length > 0) {
        const nextIdx = Math.min(idx, tabs.length - 1);
        activeId = tabs[nextIdx].id;
      } else {
        activeId = null;
      }
    }
    return {
      terminalTabs: tabs,
      activeTerminalTabId: activeId
    };
  }),

  setActiveTerminalTabId: (id) => set({ activeTerminalTabId: id }),

  openTab: (tab, groupId) => set((state) => {
    const targetGroupId = groupId || state.activeGroupId;

    // Check if we should jump to an existing tab in any editor group
    let existingTabGroup: any = null;
    let existingTab: any = null;

    const isSingleton = tab.type === "llm-setup" || tab.type === "mcp-integration" || tab.type === "settings" || tab.type === "skills" || tab.type === "workspace";
    const isAxiomTab = tab.type === "canvas" || tab.type === "axiom";

    for (const group of state.editorGroups) {
      const found = group.openTabs.find((t) => {
        if (isSingleton && t.type === tab.type) return true;
        if (isAxiomTab && (t.type === "canvas" || t.type === "axiom") && t.key === tab.key) return true;
        return false;
      });
      if (found) {
        existingTabGroup = group;
        existingTab = found;
        break;
      }
    }

    if (existingTab && existingTabGroup) {
      const updatedGroups = state.editorGroups.map((g) => {
        if (g.id === existingTabGroup.id) {
          return { ...g, activeTabId: existingTab.id };
        }
        return g;
      });

      const tempState = {
        ...state,
        editorGroups: updatedGroups,
        activeGroupId: existingTabGroup.id
      };
      const activeTabId = getActiveCanvasTabId(tempState);
      const activeCtx = getOrCreateContext(tempState, activeTabId);

      return {
        editorGroups: updatedGroups,
        activeGroupId: existingTabGroup.id,
        nodes: activeCtx.nodes,
        edges: activeCtx.edges,
        nodeLogs: activeCtx.nodeLogs,
        nodeStatus: activeCtx.nodeStatus,
        globalChatHistory: activeCtx.globalChatHistory,
        edgeReconciliationStatus: activeCtx.edgeReconciliationStatus
      };
    }

    const exists = state.editorGroups.some((g) => g.id === targetGroupId);
    
    let newGroups = state.editorGroups.map((group) => {
      if (group.id === targetGroupId) {
        const hasTab = group.openTabs.some((t) => t.id === tab.id);
        const newTabs = group.openTabs.map((t) => {
          if (t.id === tab.id) {
            return { ...t, ...tab };
          }
          return t;
        });
        const finalTabs = hasTab ? newTabs : [...group.openTabs, tab];
        return { ...group, openTabs: finalTabs, activeTabId: tab.id };
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
      const tempState = {
        ...state,
        editorGroups: newGroups,
        activeGroupId: newGroup.id,
        groupSizes: [1.0]
      };
      const activeTabId = getActiveCanvasTabId(tempState);
      const activeCtx = getOrCreateContext(tempState, activeTabId);
      return {
        editorGroups: newGroups,
        activeGroupId: newGroup.id,
        groupSizes: [1.0],
        nodes: activeCtx.nodes,
        edges: activeCtx.edges,
        nodeLogs: activeCtx.nodeLogs,
        nodeStatus: activeCtx.nodeStatus,
        globalChatHistory: activeCtx.globalChatHistory,
        edgeReconciliationStatus: activeCtx.edgeReconciliationStatus
      };
    }

    const tempState = {
      ...state,
      editorGroups: newGroups,
      activeGroupId: targetGroupId
    };
    const activeTabId = getActiveCanvasTabId(tempState);
    const activeCtx = getOrCreateContext(tempState, activeTabId);
    return {
      editorGroups: newGroups,
      activeGroupId: targetGroupId,
      nodes: activeCtx.nodes,
      edges: activeCtx.edges,
      nodeLogs: activeCtx.nodeLogs,
      nodeStatus: activeCtx.nodeStatus,
      globalChatHistory: activeCtx.globalChatHistory,
      edgeReconciliationStatus: activeCtx.edgeReconciliationStatus
    };
  }),

  closeTab: (id, groupId) => set((state) => {
    const targetGroup = state.editorGroups.find(
      (g) => groupId ? g.id === groupId : g.openTabs.some((t) => t.id === id)
    );
    if (!targetGroup) return {};

    if (id === "workspace_select" && state.editorGroups.length === 1 && targetGroup.openTabs.length === 1) {
      return {};
    }

    const groupIndex = state.editorGroups.indexOf(targetGroup);
    const remainingTabs = targetGroup.openTabs.filter((t) => t.id !== id);

    let nextState: Partial<WorkspaceState> = {};

    if (remainingTabs.length > 0) {
      let nextActiveTabId = targetGroup.activeTabId;
      if (targetGroup.activeTabId === id) {
        nextActiveTabId = remainingTabs[remainingTabs.length - 1].id;
      }
      const updatedGroups = state.editorGroups.map((g) =>
        g.id === targetGroup.id ? { ...g, openTabs: remainingTabs, activeTabId: nextActiveTabId } : g
      );
      nextState = { editorGroups: updatedGroups };
    } else {
      if (state.editorGroups.length === 1) {
        const fallbackGroup = {
          id: targetGroup.id,
          openTabs: [{ id: "workspace_select", type: "workspace" as const, title: "Workspaces", key: "workspace" }],
          activeTabId: "workspace_select"
        };
        nextState = {
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

        nextState = {
          editorGroups: updatedGroups,
          groupSizes: newSizes,
          activeGroupId: nextActiveGroupId
        };
      }
    }

    const tempState = {
      ...state,
      ...nextState
    } as WorkspaceState;
    const activeTabId = getActiveCanvasTabId(tempState);
    const activeCtx = getOrCreateContext(tempState, activeTabId);

    return {
      ...nextState,
      nodes: activeCtx.nodes,
      edges: activeCtx.edges,
      nodeLogs: activeCtx.nodeLogs,
      nodeStatus: activeCtx.nodeStatus,
      globalChatHistory: activeCtx.globalChatHistory,
      edgeReconciliationStatus: activeCtx.edgeReconciliationStatus
    };
  }),

  setActiveTabId: (id, groupId) => set((state) => {
    const targetGroupId = groupId || state.activeGroupId;
    const updatedGroups = state.editorGroups.map((g) => {
      if (g.id === targetGroupId) {
        return { ...g, activeTabId: id };
      }
      return g;
    });
    
    const tempState = {
      ...state,
      editorGroups: updatedGroups,
      activeGroupId: targetGroupId
    };
    
    const activeTabId = getActiveCanvasTabId(tempState);
    const activeCtx = getOrCreateContext(tempState, activeTabId);
    
    return {
      editorGroups: updatedGroups,
      activeGroupId: targetGroupId,
      nodes: activeCtx.nodes,
      edges: activeCtx.edges,
      nodeLogs: activeCtx.nodeLogs,
      nodeStatus: activeCtx.nodeStatus,
      globalChatHistory: activeCtx.globalChatHistory,
      edgeReconciliationStatus: activeCtx.edgeReconciliationStatus
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

    const tempState = {
      ...state,
      editorGroups: updatedGroups,
      groupSizes: newSizes,
      activeGroupId: newGroupId
    };
    const activeTabId = getActiveCanvasTabId(tempState);
    const activeCtx = getOrCreateContext(tempState, activeTabId);

    return {
      editorGroups: updatedGroups,
      groupSizes: newSizes,
      activeGroupId: newGroupId,
      nodes: activeCtx.nodes,
      edges: activeCtx.edges,
      nodeLogs: activeCtx.nodeLogs,
      nodeStatus: activeCtx.nodeStatus,
      globalChatHistory: activeCtx.globalChatHistory,
      edgeReconciliationStatus: activeCtx.edgeReconciliationStatus
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

    const tempState = {
      ...state,
      editorGroups: updatedGroups,
      groupSizes: newSizes,
      activeGroupId: nextActiveGroupId
    };
    const activeTabId = getActiveCanvasTabId(tempState);
    const activeCtx = getOrCreateContext(tempState, activeTabId);

    return {
      editorGroups: updatedGroups,
      groupSizes: newSizes,
      activeGroupId: nextActiveGroupId,
      nodes: activeCtx.nodes,
      edges: activeCtx.edges,
      nodeLogs: activeCtx.nodeLogs,
      nodeStatus: activeCtx.nodeStatus,
      globalChatHistory: activeCtx.globalChatHistory,
      edgeReconciliationStatus: activeCtx.edgeReconciliationStatus
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
  revealFileInTree: (filePath) => set((state) => {
    const parts = filePath.split("/");
    const newExpanded: Record<string, boolean> = { ...state.expandedPaths };
    let currentPath = "";
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath += (i > 0 ? "/" : "") + parts[i];
      newExpanded[currentPath] = true;
    }
    
    // Switch sidebar explorer view and expand if needed
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("reveal-file-in-tree"));
    }, 0);
    
    return { expandedPaths: newExpanded, revealPath: filePath };
  }),
  clearRevealPath: () => set({ revealPath: null }),

  addAndConnectContextNode: (x, y, taskId, taskHandleId, tabId) => set((state) => {
    const targetTabId = tabId || findTabIdByNodeId(state, taskId);
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

    return updateContextAndSync(state, targetTabId, (ctx) => ({
      nodes: [...ctx.nodes, newContextNode],
      edges: [...ctx.edges, newEdge]
    }));
  }),

  getGlobalChatHistory: (nodeId): GlobalChatMessage[] => {
    const state = useWorkspaceStore.getState();
    const targetTabId = findTabIdByNodeId(state, nodeId);
    const ctx = state.canvasContexts[targetTabId];
    return ctx ? (ctx.globalChatHistory[nodeId] || []) : [];
  },

  setSelectedEdgeId: (id) => set({ selectedEdgeId: id }),

  setEdgeStatus: (edgeId, status) => set((state) => {
    const targetTabId = findTabIdByEdgeId(state, edgeId);
    return updateContextAndSync(state, targetTabId, (ctx) => ({
      edgeReconciliationStatus: {
        ...ctx.edgeReconciliationStatus,
        [edgeId]: status
      }
    }));
  }),

  getSequenceEdges: (): Edge[] => {
    const state = useWorkspaceStore.getState();
    const activeTabId = getActiveCanvasTabId(state);
    const ctx = state.canvasContexts[activeTabId] || { edges: [] };
    return ctx.edges.filter(
      (e) => e.sourceHandle === "task-out" && e.targetHandle === "task-in"
    );
  },

  updateTabTitle: (tabId, title) => set((state) => {
    const updatedGroups = state.editorGroups.map((g) => {
      const updatedTabs = g.openTabs.map((t) => {
        if (t.id === tabId) {
          return { ...t, title };
        }
        return t;
      });
      return { ...g, openTabs: updatedTabs };
    });
    return { editorGroups: updatedGroups };
  }),

  saveSecureConfig: async () => {
    const state = useWorkspaceStore.getState();
    const { SecureStorageService } = await import("./services/secureStorageService");
    await SecureStorageService.saveSecureData("axiom_secure_config", {
      customProviders: state.customProviders,
      activeCustomProviderId: state.activeCustomProviderId,
      activeModel: state.activeModel,
      activeThemeId: state.activeThemeId,
      lastWorkspacePath: state.rootPath,
      mcpServers: state.mcpServers,
      lspSettings: state.lspSettings,
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
      mcpServers?: Record<string, McpServerConfig>;
      lspSettings?: LspSettings;
    }>("axiom_secure_config");

    if (config) {
      const updates: Partial<WorkspaceState> = {};
      if (config.customProviders) updates.customProviders = config.customProviders;
      if (config.activeCustomProviderId !== undefined) updates.activeCustomProviderId = config.activeCustomProviderId;
      if (config.activeModel) updates.activeModel = config.activeModel;
      if (config.mcpServers) updates.mcpServers = config.mcpServers;
      if (config.lspSettings) updates.lspSettings = config.lspSettings;

      if (config.activeThemeId) {
        updates.activeThemeId = config.activeThemeId;
        localStorage.setItem("selected_theme", config.activeThemeId);
        const themeId = config.activeThemeId;
        const { themes, applyThemeProperties, defineMonacoTheme } = await import("./theme");
        const t = themes[themeId] || themes.spaceDust;
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
