import React, { useState, useEffect, useRef, useMemo } from "react";
import { GitMerge, Play, Loader2, FileCode, MessageSquare, X, Send, AlertTriangle, Maximize2, Minimize2, Terminal, Octagon, RotateCcw } from "lucide-react";
import { useWorkspaceStore } from "../../store";
import { VfsRegistry } from "../../services/vfs";
import { notify } from "../../notificationStore";
import { PRDiffView } from "./components/PRDiffView";
import { useResizable } from "./useResizable";
import { CustomSelect } from "../CustomSelect";
import { queryDuplicateTrackedFiles } from "../../services/vfs/orchestrators/queryOrchestrator";
import { processResponse } from "../../services/responseProcessingService";
import { ConsoleTabContent } from "./components/ConsoleTabContent";
import { commandPermissionService, handleCommandPermissionMessage } from "../../services/commandPermissionService";
import { AgentActivityCard } from "../ui/SubagentActivityPanel";
import type { SubagentActivity } from "../ui/Chat";
import { useConfirm } from "../useConfirm";
import {
  reconciliationOverlayService,
  RECONCILIATION_OVERLAY_CHANGED_EVENT,
} from "../../services/reconciliationOverlayService";

interface ReconciliationGraphPaneProps {
  onClose: () => void;
  tabId: string;
  isOpen?: boolean;
}

const getReconciliationStreamId = (tabId: string) => `__reconciliation__:${tabId}`;
const EMPTY_RECONCILIATION_LOGS: string[] = [];

type IncomingSubagent = SubagentActivity & { previousId?: string; appendLog?: string };

const mergeSubagentUpdate = (current: SubagentActivity[], incoming: IncomingSubagent): SubagentActivity[] => {
  const index = current.findIndex((subagent) =>
    subagent.id === incoming.id || (!!incoming.previousId && subagent.id === incoming.previousId)
  );
  const incomingLogs = [
    ...(Array.isArray(incoming.logs) ? incoming.logs : []),
    ...(incoming.appendLog ? [incoming.appendLog] : []),
  ];
  const cleanIncoming = { ...incoming, result: undefined, error: undefined };
  delete cleanIncoming.previousId;
  delete cleanIncoming.appendLog;

  if (index < 0) {
    return [...current, { ...cleanIncoming, logs: incomingLogs }];
  }

  const next = [...current];
  const mergedLogs = [...(next[index].logs || [])];
  for (const log of incomingLogs) {
    if (log && mergedLogs[mergedLogs.length - 1] !== log) mergedLogs.push(log);
  }
  next[index] = { ...next[index], ...cleanIncoming, id: incoming.id, logs: mergedLogs.slice(-200) };
  return next;
};

export const ReconciliationGraphPane: React.FC<ReconciliationGraphPaneProps> = ({ onClose, tabId, isOpen = true }) => {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);

  // Resize hook
  const { width, containerRef, startResizing } = useResizable(500, "reconciliation_graph_pane_width");

  // States
  const [selectedModel, setSelectedModel] = useState(activeModel || "");
  const [activeTab, setActiveTab] = useState<"overview" | "chat" | "console" | "files">("overview");
  const [isReconciling, setIsReconciling] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isMaximized, setIsMaximized] = useState(false);
  const [duplicateFiles, setDuplicateFiles] = useState<Record<string, string[]>>({});
  const [subagents, setSubagents] = useState<SubagentActivity[]>([]);
  const [rollbackAvailable, setRollbackAvailable] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [reconciledFiles, setReconciledFiles] = useState<string[]>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const { confirm, ConfirmModalComponent } = useConfirm();
  const reconciliationStreamId = getReconciliationStreamId(tabId);
  const reconciliationVfsId = reconciliationOverlayService.getOverlayTabId(tabId);
  const reconciliationLogs = useWorkspaceStore(
    (state) => state.canvasContexts[tabId]?.nodeLogs[reconciliationStreamId] ?? EMPTY_RECONCILIATION_LOGS
  );
  const addConsoleLog = (message: string) => useWorkspaceStore.getState().addLog(reconciliationStreamId, message);
  const clearConsoleLog = () => useWorkspaceStore.getState().clearLogs(reconciliationStreamId);
  const setConsoleStatus = (status: "idle" | "running" | "success" | "error") => {
    useWorkspaceStore.getState().setNodeStatus(reconciliationStreamId, status);
  };

  // Resolve canvas context task nodes
  const canvasNodes = useWorkspaceStore((state) => state.canvasContexts[tabId]?.nodes || []);
  const taskNodes = useMemo(() => canvasNodes.filter((n) => n.type === "taskNode"), [canvasNodes]);
  const globalChatHistory = useWorkspaceStore((state) => state.canvasContexts[tabId]?.globalChatHistory || {});

  const formattedNodes = useMemo(() => {
    return taskNodes.map((node) => ({
      id: node.id,
      name: node.data?.name || "Unnamed Task",
      prompt: node.data?.prompt || "",
      chatHistory: globalChatHistory[node.id] || [],
      modifiedFiles: (node.data?.modifiedFiles as string[]) || [],
    }));
  }, [taskNodes, globalChatHistory]);

  const allModifiedFiles = useMemo(() => {
    const files = new Set<string>();
    formattedNodes.forEach((n) => {
      n.modifiedFiles.forEach((f) => files.add(f));
    });
    reconciledFiles.forEach((filePath) => files.add(filePath));
    return Array.from(files);
  }, [formattedNodes, reconciledFiles]);

  // Load duplicates from VFS
  const loadDuplicates = async () => {
    try {
      const dups = await queryDuplicateTrackedFiles(tabId);
      setDuplicateFiles(dups);
    } catch (err) {
      console.error("[ReconciliationGraphPane] Failed to query duplicates:", err);
    }
  };

  useEffect(() => {
    loadDuplicates();
  }, [tabId, allModifiedFiles]);

  // Sync scroll on chat messages update
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, subagents]);

  const saveChatHistory = (messages: { role: string; content: string }[]) => {
    const canvasContext = useWorkspaceStore.getState().canvasContexts[tabId];
    if (canvasContext) {
      const globalChat = canvasContext.globalChatHistory || {};
      const formatMessages = messages.map((m, idx) => ({
        id: `recon-${idx}`,
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
        timestamp: new Date().toISOString()
      }));
      useWorkspaceStore.getState().updateCanvasContext(tabId, {
        globalChatHistory: {
          ...globalChat,
          "__reconciliation__": formatMessages
        }
      });
      import("../tabs/canvas/services/canvasFileService").then(({ canvasFileService }) => {
        canvasFileService.autoSaveCanvas(tabId);
      }).catch(err => console.error("Failed to auto-save canvas:", err));
    }
  };

  const appendChatMessage = (message: { role: string; content: string }) => {
    setChatMessages((prev) => {
      const updated = [...prev, message];
      saveChatHistory(updated);
      return updated;
    });
  };

  const ensureReconciliationOverlay = async (): Promise<boolean> => {
    try {
      await reconciliationOverlayService.ensureSession(
        tabId,
        !!useWorkspaceStore.getState().canvasContexts[tabId]?.isPipelineApplied
      );
      const changedPaths = reconciliationOverlayService.getChangedPaths(tabId);
      setReconciledFiles(changedPaths);
      setRollbackAvailable(changedPaths.length > 0);
      return true;
    } catch (err: any) {
      console.error("[ReconciliationGraph] Failed to create reconciliation overlay:", err);
      notify(
        "Reconciliation Not Started",
        `Could not create an isolated reconciliation version: ${err.message || String(err)}`,
        "error"
      );
      return false;
    }
  };

  const handleRollbackReconciliation = async () => {
    const changedPaths = reconciliationOverlayService.getChangedPaths(tabId);
    if (changedPaths.length === 0 || isReconciling || isRollingBack) return;

    const confirmed = await confirm({
      title: "Rollback reconciliation?",
      message: `Discard the reconciled version of ${changedPaths.length} file${changedPaths.length === 1 ? "" : "s"}? All task-owned code will remain intact.`,
      confirmLabel: "Rollback",
      kind: "warning",
    });
    if (!confirmed) return;

    setIsRollingBack(true);
    try {
      const wasPipelineApplied = reconciliationOverlayService.wasPipelineApplied(tabId);
      await reconciliationOverlayService.discard(tabId);
      useWorkspaceStore.getState().updateCanvasContext(tabId, { isPipelineApplied: wasPipelineApplied });
      setReconciledFiles([]);
      setRollbackAvailable(false);
      addConsoleLog(`Discarded the reconciled version of ${changedPaths.length} file${changedPaths.length === 1 ? "" : "s"}. Task code was not changed.`);
      appendChatMessage({
        role: "system",
        content: `Reconciliation rolled back. Discarded ${changedPaths.length} reconciled file version${changedPaths.length === 1 ? "" : "s"}; task-owned code remains unchanged.`,
      });
      await loadDuplicates();

      const { canvasFileService } = await import("../tabs/canvas/services/canvasFileService");
      await canvasFileService.autoSaveCanvas(tabId);
      notify("Reconciliation Rolled Back", "The isolated reconciled version was discarded. Task code was preserved.", "success");
    } catch (err: any) {
      console.error("[ReconciliationGraph] Rollback failed:", err);
      notify("Rollback Failed", err.message || String(err), "error");
    } finally {
      setIsRollingBack(false);
    }
  };

  const handleStopReconciliation = () => {
    addConsoleLog("Stop requested by user.");
    setConsoleStatus("idle");
    if (socketRef.current) {
      const socket = socketRef.current;
      if (socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "agent_chat_stop", tabId: reconciliationStreamId }));
      }
      socketRef.current.close(1000, "User requested stop");
      commandPermissionService.removeForSocket(socket);
      socketRef.current = null;
    }
    setIsReconciling(false);
    setSubagents((current) => current.map((subagent) =>
      subagent.status === "queued" || subagent.status === "running" || subagent.status === "background"
        ? { ...subagent, status: "stopped", updatedAt: new Date().toISOString() }
        : subagent
    ));
    appendChatMessage({ role: "system", content: "Reconciliation stopped by user." });
  };

  useEffect(() => {
    const globalChat = useWorkspaceStore.getState().canvasContexts[tabId]?.globalChatHistory || {};
    const storedMessages = globalChat["__reconciliation__"] || [];
    setChatMessages(storedMessages.map(m => ({ role: m.role, content: m.content })));
    setSubagents([]);
    const changedPaths = reconciliationOverlayService.getChangedPaths(tabId);
    setReconciledFiles(changedPaths);
    setRollbackAvailable(changedPaths.length > 0);

    return () => {
      if (socketRef.current) {
        const socket = socketRef.current;
        socket.close(1000, "Pane unmounted");
        commandPermissionService.removeForSocket(socket);
      }
    };
  }, [tabId]);

  useEffect(() => {
    const handleOverlayChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ tabId: string; changedPaths: string[] }>).detail;
      if (detail?.tabId !== tabId) return;
      setReconciledFiles(detail.changedPaths || []);
      setRollbackAvailable((detail.changedPaths || []).length > 0);
    };
    window.addEventListener(RECONCILIATION_OVERLAY_CHANGED_EVENT, handleOverlayChanged);
    return () => window.removeEventListener(RECONCILIATION_OVERLAY_CHANGED_EVENT, handleOverlayChanged);
  }, [tabId]);

  const startReconciliation = async (userMsgText?: string) => {
    if (isReconciling || isRollingBack) return;
    if (!(await ensureReconciliationOverlay())) return;
    setIsReconciling(true);
    setSubagents([]);
    if (!userMsgText) {
      clearConsoleLog();
    }
    setConsoleStatus("running");
    addConsoleLog(userMsgText ? "Sending reconciliation follow-up message..." : "Starting graph reconciliation...");

    let nextMessages = [...chatMessages];
    if (userMsgText) {
      nextMessages.push({ role: "user", content: userMsgText });
      setChatMessages(nextMessages);
      saveChatHistory(nextMessages);
    } else {
      nextMessages = [{ role: "system", content: "Checking duplicate file changes across tasks..." }];
      setChatMessages(nextMessages);
      saveChatHistory(nextMessages);
      setActiveTab("console");
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket("ws://localhost:4000");
      socketRef.current = socket;
    } catch (err: any) {
      console.error("Failed to construct WebSocket:", err);
      addConsoleLog(`Connection failed: ${err.message || String(err)}`);
      setConsoleStatus("error");
      appendChatMessage({ role: "system", content: `Connection failed: ${err.message || String(err)}` });
      setIsReconciling(false);
      return;
    }

    socket.onopen = () => {
      const provider = customProviders.find((candidate) =>
        candidate.models.some((candidateModel) => candidateModel.id === selectedModel)
      ) || customProviders.find((candidate) => candidate.id === activeCustomProviderId);
      addConsoleLog(`Connected to sidecar. Dispatching ${formattedNodes.length} task nodes with ${Object.keys(duplicateFiles).length} overlapping file groups.`);

      socket.send(
        JSON.stringify({
          type: "reconciliate_graph",
          tabId,
          model: selectedModel,
          nodes: formattedNodes,
          workspaceRoot: rootPath,
          duplicateFiles,
          chatHistory: nextMessages.map(m => ({ role: m.role, content: m.content })),
          userMessage: userMsgText || "",
          customProvider: provider || null,
        })
      );
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (handleCommandPermissionMessage(msg, socket)) return;

        if (msg.type === "command_output" && msg.sessionId === reconciliationStreamId) {
          const output = String(msg.content || "").trimEnd();
          if (output) addConsoleLog(output);
          return;
        }

        if (msg.type === "command_complete" && msg.sessionId === reconciliationStreamId) {
          if (msg.error) addConsoleLog(`Build command error: ${msg.error}`);
          return;
        }

        if (msg.type === "log") {
          addConsoleLog(msg.message);
          return;
        }

        if (msg.type === "subagent_update" && msg.tabId === reconciliationStreamId && msg.subagent?.id) {
          setSubagents((current) => mergeSubagentUpdate(current, {
            ...msg.subagent,
            updatedAt: msg.subagent.updatedAt || new Date().toISOString(),
          } as IncomingSubagent));
          return;
        }

        if (msg.type === "read_file") {
          console.log(`[ReconciliateGraph] Sidecar reading file: ${msg.path}`);
          VfsRegistry.getOrCreate(reconciliationVfsId).readFile(msg.path)
            .then((content) => {
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "read_file_response", requestId: msg.requestId, content }));
              }
            })
            .catch((err) => {
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "read_file_response", requestId: msg.requestId, error: err.message || String(err) }));
              }
            });
          return;
        }

        if (msg.type === "write_file") {
          console.log(`[ReconciliateGraph] Sidecar writing file: ${msg.path}`);
          VfsRegistry.getOrCreate(reconciliationVfsId).writeFile(msg.path, msg.content)
            .then(() => {
              reconciliationOverlayService.markChanged(tabId, msg.path);
              useWorkspaceStore.getState().updateCanvasContext(tabId, { isPipelineApplied: false });
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "write_file_response", requestId: msg.requestId }));
              }
            })
            .catch((err) => {
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "write_file_response", requestId: msg.requestId, error: err.message || String(err) }));
              }
            });
          return;
        }

        if (msg.type === "reconciliation_graph_complete") {
          const verificationStatus = msg.verification?.status;
          if (verificationStatus === "failed") {
            addConsoleLog(`Reconciliation completed, but build verification failed: ${msg.verification?.reason || "unknown failure"}`);
            setConsoleStatus("error");
          } else if (verificationStatus === "skipped") {
            addConsoleLog(`Reconciliation completed; build verification skipped: ${msg.verification?.reason || "no reason provided"}`);
            setConsoleStatus("success");
          } else {
            addConsoleLog("Reconciliation and build verification completed successfully.");
            setConsoleStatus("success");
          }
          appendChatMessage({ role: "assistant", content: msg.response || "Reconciliation complete." });
          setIsReconciling(false);
          if (verificationStatus === "failed") {
            notify("Build Verification Failed", msg.verification?.reason || "The reconciled code did not build.", "error");
          } else if (verificationStatus === "skipped") {
            notify("Reconciliation Complete", "Code alignment completed; build verification was skipped.", "info");
          } else {
            notify("Reconciliation Complete", "Code alignment and temporary build verification passed.", "success");
          }
          loadDuplicates();
          socket.close();
        }

        if (msg.type === "reconciliation_graph_error") {
          addConsoleLog(`Reconciliation failed: ${msg.error}`);
          setConsoleStatus("error");
          appendChatMessage({ role: "assistant", content: `Error: ${msg.error}` });
          setIsReconciling(false);
          setSubagents((current) => current.map((subagent) =>
            subagent.status === "queued" || subagent.status === "running" || subagent.status === "background"
              ? { ...subagent, status: "error", updatedAt: new Date().toISOString() }
              : subagent
          ));
          notify("Reconciliation Failed", `Error aligning: ${msg.error}`, "error");
          socket.close();
        }
      } catch (err: any) {
        console.error("[ReconciliationGraph] parse error:", err);
        addConsoleLog(`Message parse error: ${err.message || String(err)}`);
      }
    };

    socket.onerror = (error) => {
      console.error("[ReconciliationGraph] WebSocket error:", error);
      addConsoleLog("WebSocket connection failed.");
      setConsoleStatus("error");
      appendChatMessage({ role: "system", content: "Error: WebSocket connection failed." });
      setIsReconciling(false);
    };

    socket.onclose = () => {
      commandPermissionService.removeForSocket(socket);
      const currentStatus = useWorkspaceStore.getState().canvasContexts[tabId]?.nodeStatus[reconciliationStreamId];
      if (currentStatus === "running") {
        addConsoleLog("Connection closed before reconciliation completed.");
        setConsoleStatus("error");
      }
      setIsReconciling(false);
    };
  };

  const handleSendChat = () => {
    if (!chatInput.trim() || isReconciling) return;
    const text = chatInput.trim();
    setChatInput("");
    void startReconciliation(text);
  };

  // Compile list of available models
  const availableModels = useMemo(() => {
    const configuredModels = customProviders.flatMap((provider) =>
      (provider.models || [])
        .filter((model) => model.supported !== false)
        .map((model) => model.id)
    );
    return Array.from(new Set([activeModel, ...configuredModels].filter(Boolean)));
  }, [activeModel, customProviders]);

  const modelOptions = useMemo(() => {
    return availableModels.map((m) => ({ id: m, name: m }));
  }, [availableModels]);

  useEffect(() => {
    if ((!selectedModel || !availableModels.includes(selectedModel)) && activeModel) {
      setSelectedModel(activeModel);
    }
  }, [activeModel, availableModels, selectedModel]);

  const duplicateFilesEntries = Object.entries(duplicateFiles);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      style={{ width: isMaximized ? "100%" : `${width}px` }}
      className={`border-l border-[var(--border-color)] bg-[var(--bg-app)]/95 flex flex-col h-full text-[var(--text-normal)] font-sans shadow-2xl z-[40] max-w-full ${
        isMaximized ? "absolute inset-0" : "absolute right-0 top-0 bottom-0"
      }`}
    >
      {/* Resizer Handle */}
      {!isMaximized && (
        <div
          onMouseDown={startResizing}
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[var(--color-status-danger-bg)] active:bg-[var(--color-status-danger-solid)] transition-colors z-50"
          style={{ transform: "translateX(-50%)" }}
        />
      )}
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] bg-gradient-to-r from-[var(--color-status-danger-bg)] to-transparent flex-shrink-0">
        <div className="flex flex-col">
          <span className="font-mono text-xs text-[var(--color-status-danger)] uppercase tracking-wider flex items-center space-x-1.5">
            <GitMerge size={12} />
            <span>Reconciliation Tool</span>
          </span>
          <span className="font-semibold text-sm truncate">
            Resolving overlapping file modifications
          </span>
        </div>
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 text-xs">
            <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider">
              Model:
            </span>
            <CustomSelect
              value={selectedModel}
              onChange={(val) => setSelectedModel(val)}
              options={modelOptions}
              placeholder="Select Model"
              className="w-40 text-xs font-mono"
              direction="down"
            />
          </div>
          <div className="h-5 w-[1px] bg-[var(--border-color)] flex-shrink-0" />
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors p-1 rounded-lg hover:bg-[var(--bg-sidebar)] cursor-pointer"
            title={isMaximized ? "Restore size" : "Maximize to fullscreen"}
          >
            {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors p-1 rounded-lg hover:bg-[var(--bg-sidebar)] cursor-pointer"
            title="Hide reconciliation pane"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Tabs Menu */}
      <div className="flex border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 px-2 flex-shrink-0">
        <button
          onClick={() => setActiveTab("overview")}
          className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-mono font-semibold transition-all border-b-2 hover:text-[var(--text-light)] cursor-pointer ${
            activeTab === "overview" ? "border-[var(--color-status-danger-border)] text-[var(--color-status-danger)]" : "border-transparent text-[var(--text-muted)]"
          }`}
        >
          <GitMerge size={13} />
          <span>Overview</span>
        </button>
        <button
          onClick={() => setActiveTab("chat")}
          className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-mono font-semibold transition-all border-b-2 hover:text-[var(--text-light)] cursor-pointer ${
            activeTab === "chat" ? "border-[var(--color-status-danger-border)] text-[var(--color-status-danger)]" : "border-transparent text-[var(--text-muted)]"
          }`}
        >
          <MessageSquare size={13} />
          <span>Adjustment Chat</span>
        </button>
        <button
          onClick={() => setActiveTab("console")}
          className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-mono font-semibold transition-all border-b-2 hover:text-[var(--text-light)] cursor-pointer relative ${
            activeTab === "console" ? "border-[var(--color-status-danger-border)] text-[var(--color-status-danger)]" : "border-transparent text-[var(--text-muted)]"
          }`}
        >
          <Terminal size={13} />
          <span>Console Stream</span>
          {isReconciling && (
            <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-[var(--color-status-danger-solid)] animate-ping" />
          )}
        </button>
        <button
          onClick={() => setActiveTab("files")}
          className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-mono font-semibold transition-all border-b-2 hover:text-[var(--text-light)] cursor-pointer ${
            activeTab === "files" ? "border-[var(--color-status-danger-border)] text-[var(--color-status-danger)]" : "border-transparent text-[var(--text-muted)]"
          }`}
        >
          <FileCode size={13} />
          <span>Reconciled Files ({allModifiedFiles.length})</span>
        </button>
      </div>

      {/* Tab Contents */}
      <div className="flex-1 overflow-hidden relative flex flex-col bg-[var(--bg-app)]">
        {activeTab === "overview" && (
          <div className="flex-1 flex flex-col overflow-hidden p-4">


            {/* Overlapping modifications list */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="font-mono text-[10px] text-[var(--text-muted)] uppercase mb-2 font-bold flex items-center space-x-1">
                <AlertTriangle size={12} className="text-[var(--color-status-warning)]" />
                <span>Overlapping File Modifications ({duplicateFilesEntries.length})</span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-3 select-none pr-1">
                {duplicateFilesEntries.length === 0 ? (
                  <div className="text-[var(--text-muted)] h-full flex flex-col items-center justify-center text-center px-4">
                    <GitMerge size={24} className="text-[var(--color-status-danger)] mb-2" />
                    <span>No duplicate file modifications detected. Ensure multiple tasks write to the same files in VFS.</span>
                  </div>
                ) : (
                  duplicateFilesEntries.map(([filePath, taskIds]) => {
                    const parts = filePath.split("/");
                    const name = parts[parts.length - 1];
                    const dir = parts.slice(0, -1).join("/");
                    return (
                      <div
                        key={filePath}
                        className="p-3 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl flex flex-col space-y-2 shadow-sm"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex flex-col">
                            <span className="font-semibold text-xs text-[var(--text-light)] truncate max-w-[280px]">
                              {name}
                            </span>
                            {dir && <span className="text-[9px] text-[var(--text-muted)] truncate max-w-[280px]">{dir}</span>}
                          </div>
                          <span className="bg-[var(--color-status-danger-bg)] text-[var(--color-status-danger)] border border-[var(--color-status-danger-border)] text-[9px] font-mono font-bold px-2 py-0.5 rounded-full uppercase">
                            Collision
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[9px] text-[var(--text-muted)] font-mono">Modified by:</span>
                          {taskIds.map((tid) => {
                            const taskName = String(formattedNodes.find((n) => n.id === tid)?.name || tid);
                            return (
                              <span
                                key={tid}
                                className="bg-[var(--color-status-danger-bg)] text-[var(--color-status-danger)] border border-[var(--color-status-danger-border)] text-[9px] font-mono px-2 py-0.5 rounded-md"
                              >
                                {taskName}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "chat" && (
          <div className="flex-1 flex flex-col overflow-hidden relative">
            {/* Chat Messages */}
            <div className="flex-1 p-4 space-y-3 overflow-y-auto text-xs">
              {chatMessages.length === 0 ? (
                <div className="text-[var(--text-muted)] h-full flex flex-col items-center justify-center text-center px-4">
                  <MessageSquare size={24} className="text-[var(--color-status-danger)] mb-2" />
                  <span>Interactive chat with the reconciler. Run Reconciliate first to generate proposals.</span>
                </div>
              ) : (
                chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col rounded-xl p-3 w-full space-y-1 text-left ${
                      msg.role === "user"
                        ? "bg-[var(--color-status-danger-bg)] border border-[var(--color-status-danger-border)]"
                        : msg.role === "system"
                        ? "bg-[var(--bg-sidebar)]/30 border border-[var(--border-color)]/50 text-[var(--text-muted)] italic"
                        : "bg-[var(--bg-sidebar)] border border-[var(--border-color)]"
                    }`}
                  >
                    <span
                      className={`font-mono text-[9px] uppercase font-bold ${
                        msg.role === "user"
                          ? "text-[var(--color-status-danger)]"
                          : msg.role === "system"
                          ? "text-[var(--text-muted)]"
                          : "text-[var(--color-status-success)]"
                      }`}
                    >
                      {msg.role === "user" ? "You" : msg.role === "system" ? "System Router" : "Reconciliation Agent"}
                    </span>
                    <div className="leading-relaxed whitespace-pre-wrap text-[var(--text-normal)]">
                      {msg.role === "system" ? msg.content : processResponse(msg.content)}
                    </div>
                  </div>
                ))
              )}
              {(isReconciling || reconciliationLogs.length > 0 || subagents.length > 0) && (
                <AgentActivityCard
                  content={reconciliationLogs.join("\n")}
                  isStreaming={isReconciling}
                  subagents={subagents}
                />
              )}
              {isReconciling && (
                <div className="flex items-center gap-2 px-3 py-2 text-[11px] font-mono text-[var(--text-muted)]" aria-live="polite">
                  <Loader2 size={14} className="animate-spin text-[var(--color-status-danger)]" />
                  <span>Reconciliation model is thinking…</span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input area */}
            <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendChat();
                }}
                className="flex items-center space-x-2 bg-[var(--bg-app)] border border-[var(--border-color)] p-1.5 rounded-lg focus-within:border-[var(--color-status-danger-border)]"
              >
                <input
                  type="text"
                  placeholder="Ask changes or tweaks to current reconciliations..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={isReconciling || duplicateFilesEntries.length === 0}
                  className="flex-1 bg-transparent border-none outline-none text-xs px-2 py-1 focus:ring-0 text-[var(--text-normal)]"
                />
                <button
                  type="submit"
                  disabled={isReconciling || !chatInput.trim() || duplicateFilesEntries.length === 0}
                  className="bg-[var(--color-status-danger-solid)] hover:bg-[var(--color-status-danger-solid)] disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] text-[var(--color-status-danger-solid-foreground)] text-xs font-mono font-bold px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-all cursor-pointer"
                >
                  {isReconciling ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  <span>Send</span>
                </button>
              </form>
            </div>
          </div>
        )}

        {activeTab === "console" && (
          <ConsoleTabContent selectedNodeId={reconciliationStreamId} tabId={tabId} />
        )}

        {activeTab === "files" && (
          <PRDiffView
            tabId={reconciliationOverlayService.hasSession(tabId) ? reconciliationVfsId : tabId}
            modifiedFiles={allModifiedFiles}
          />
        )}
      </div>

      {/* Footer Actions */}
      <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 flex items-center justify-between gap-3 flex-shrink-0">
        <button
          onClick={() => void handleRollbackReconciliation()}
          disabled={!rollbackAvailable || isReconciling || isRollingBack}
          title={rollbackAvailable ? "Discard the isolated reconciled version" : "No reconciliation changes to roll back"}
          className="border border-[var(--color-status-warning-border)] bg-[var(--color-status-warning-bg)] hover:bg-[var(--color-status-warning-bg)] disabled:opacity-40 disabled:cursor-not-allowed text-[var(--color-status-warning)] text-xs font-mono font-bold px-3 py-2 rounded-lg flex items-center space-x-1.5 transition-all cursor-pointer"
        >
          {isRollingBack ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
          <span>{isRollingBack ? "Rolling Back" : "Rollback"}</span>
        </button>
        {isReconciling ? (
          <button
            onClick={() => handleStopReconciliation()}
            className="bg-[var(--color-status-danger-solid)] hover:bg-[var(--color-status-danger-solid)] text-[var(--color-status-danger-solid-foreground)] text-xs font-mono font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all shadow-md cursor-pointer animate-pulse"
          >
            <Octagon size={13} />
            <span>Stop Execution</span>
          </button>
        ) : (
          <button
            onClick={() => void startReconciliation()}
            disabled={duplicateFilesEntries.length === 0 || isRollingBack}
            className="bg-[var(--color-status-danger-solid)] hover:bg-[var(--color-status-danger-solid)] disabled:opacity-50 disabled:cursor-not-allowed text-[var(--color-status-danger-solid-foreground)] text-xs font-mono font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all shadow-md cursor-pointer"
          >
            <Play size={13} />
            <span>Run Reconciliate</span>
          </button>
        )}
      </div>
      {ConfirmModalComponent}
    </div>
  );
};
