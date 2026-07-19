import type {
  Connection,
  Edge,
  Node,
  OnEdgesChange,
  OnNodesChange,
} from "@xyflow/react";
import type { McpServerConfig } from "../components/mcp/types";

export interface ProviderModel {
  id: string;
  name: string;
  remoteId?: string;
  apiType?: string;
  baseUrl?: string;
  supported?: boolean;
  capabilities?: string[];
  reasoning?: boolean;
  input?: Array<"text" | "image">;
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  compat?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface CustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiType: string;
  authType?: "bearer" | "anthropic" | "none" | "environment";
  catalogUrl?: string;
  models: ProviderModel[];
}

export interface GeneratedTaskNodeSpec {
  title: string;
  description: string;
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
  /** If true, this skill is for internal/system use and must not appear in user-facing dropdowns. */
  isInternal?: boolean;
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
  hasBeenSaved?: boolean;
}

export interface CanvasHistorySnapshot {
  nodes: Node[];
  edges: Edge[];
}

export interface CanvasHistory {
  past: CanvasHistorySnapshot[];
  future: CanvasHistorySnapshot[];
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
  canvasHistories: Record<string, CanvasHistory>;
  onNodesChangeForTab: (tabId: string, changes: any[]) => void;
  onEdgesChangeForTab: (tabId: string, changes: any[]) => void;
  onConnectForTab: (tabId: string, connection: Connection) => void;
  updateCanvasContext: (tabId: string, updates: Partial<CanvasContext>) => void;
  loadCanvasTab: (data: any) => string;
  createCanvasTab: (title?: string) => void;
  createAgentTab: (title?: string) => void;
  undoCanvasTab: (tabId: string) => void;
  redoCanvasTab: (tabId: string) => void;

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
  resetForBranchChange: () => void;
  setSelectedNodeId: (id: string | null) => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: (connection: Connection) => void;

  addContextNode: (x: number, y: number, fileContext?: { path: string; name: string; isDir: boolean }, tabId?: string) => void;
  addTaskNode: (x: number, y: number, tabId?: string) => void;
  addTaskNodesBatch: (tabId: string, anchorNodeId: string, tasks: GeneratedTaskNodeSpec[]) => string[];
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
  updateProviderSettings: (providerId: string, settings: Partial<Omit<CustomProvider, "id">>) => void;
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
