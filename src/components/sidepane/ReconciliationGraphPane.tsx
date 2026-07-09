import React, { useState, useEffect, useRef, useMemo } from "react";
import { GitMerge, Play, Loader2, FileCode, MessageSquare, X, Send, AlertTriangle, Maximize2, Minimize2, Terminal } from "lucide-react";
import { useWorkspaceStore } from "../../store";
import { VfsRegistry } from "../../services/vfs";
import { notify } from "../../notificationStore";
import { PRDiffView } from "./components/PRDiffView";
import { useResizable } from "./useResizable";
import { CustomSelect } from "../CustomSelect";
import { queryDuplicateTrackedFiles } from "../../services/vfs/orchestrators/queryOrchestrator";
import { processResponse } from "../../services/responseProcessingService";
import { ConsoleTabContent } from "./components/ConsoleTabContent";

interface ReconciliationGraphPaneProps {
  onClose: () => void;
  tabId: string;
  isOpen?: boolean;
}

const getReconciliationStreamId = (tabId: string) => `__reconciliation__:${tabId}`;

export const ReconciliationGraphPane: React.FC<ReconciliationGraphPaneProps> = ({ onClose, tabId, isOpen = true }) => {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);

  // Resize hook
  const { width, containerRef, startResizing } = useResizable(500, "reconciliation_graph_pane_width");

  // States
  const [selectedModel, setSelectedModel] = useState(activeModel || "anthropic/claude-3-5-sonnet");
  const [activeTab, setActiveTab] = useState<"overview" | "chat" | "console" | "files">("overview");
  const [isReconciling, setIsReconciling] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isMaximized, setIsMaximized] = useState(false);
  const [duplicateFiles, setDuplicateFiles] = useState<Record<string, string[]>>({});

  const chatEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconciliationStreamId = getReconciliationStreamId(tabId);
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
    return Array.from(files);
  }, [formattedNodes]);

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
  }, [chatMessages]);

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

  const handleStopReconciliation = () => {
    addConsoleLog("Stop requested by user.");
    setConsoleStatus("idle");
    if (socketRef.current) {
      socketRef.current.close(1000, "User requested stop");
      socketRef.current = null;
    }
    setIsReconciling(false);
    appendChatMessage({ role: "system", content: "Reconciliation stopped by user." });
  };

  useEffect(() => {
    const globalChat = useWorkspaceStore.getState().canvasContexts[tabId]?.globalChatHistory || {};
    const storedMessages = globalChat["__reconciliation__"] || [];
    setChatMessages(storedMessages.map(m => ({ role: m.role, content: m.content })));

    return () => {
      if (socketRef.current) {
        socketRef.current.close(1000, "Pane unmounted");
      }
    };
  }, [tabId]);

  const startReconciliation = (userMsgText?: string) => {
    if (isReconciling) return;
    setIsReconciling(true);
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
      const provider = customProviders.find((p) => p.id === activeCustomProviderId);
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
          customProvider: provider && (provider.id !== "anthropic" && provider.id !== "openai" || !!provider.apiKey) ? provider : null,
        })
      );
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "log") {
          addConsoleLog(msg.message);
          return;
        }

        if (msg.type === "read_file") {
          console.log(`[ReconciliateGraph] Sidecar reading file: ${msg.path}`);
          VfsRegistry.getOrCreate(tabId).readFile(msg.path)
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
          const firstNode = taskNodes[0];
          const nodeId = firstNode?.id;

          VfsRegistry.getOrCreate(tabId).writeFile(msg.path, msg.content, nodeId)
            .then(() => {
              if (nodeId) {
                const currentModified = (firstNode.data?.modifiedFiles as string[]) || [];
                if (!currentModified.includes(msg.path)) {
                  useWorkspaceStore.getState().updateTaskNode(nodeId, {
                    modifiedFiles: [...currentModified, msg.path]
                  });
                }
              }
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
          addConsoleLog("Reconciliation completed successfully.");
          setConsoleStatus("success");
          appendChatMessage({ role: "assistant", content: msg.response || "Reconciliation complete." });
          setIsReconciling(false);
          notify("Reconciliation Complete", "Code alignment completed successfully.", "success");
          loadDuplicates();
          socket.close();
        }

        if (msg.type === "reconciliation_graph_error") {
          addConsoleLog(`Reconciliation failed: ${msg.error}`);
          setConsoleStatus("error");
          appendChatMessage({ role: "assistant", content: `Error: ${msg.error}` });
          setIsReconciling(false);
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
    startReconciliation(text);
  };

  // Compile list of available models
  const availableModels = useMemo(() => {
    const defaultModels = ["anthropic/claude-3-5-sonnet", "openai/gpt-4o", "openai/gpt-4o-mini"];
    const customModels = customProviders.flatMap((p) => (p.models || []).map((m: any) => typeof m === "string" ? m : m.id));
    return Array.from(new Set([...defaultModels, ...customModels]));
  }, [customProviders]);

  const modelOptions = useMemo(() => {
    return availableModels.map((m) => ({ id: m, name: m }));
  }, [availableModels]);

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
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-violet-500/50 active:bg-violet-500 transition-colors z-50"
          style={{ transform: "translateX(-50%)" }}
        />
      )}
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] bg-gradient-to-r from-violet-500/10 to-transparent flex-shrink-0">
        <div className="flex flex-col">
          <span className="font-mono text-xs text-violet-400 uppercase tracking-wider flex items-center space-x-1.5">
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
            activeTab === "overview" ? "border-violet-500 text-violet-400" : "border-transparent text-[var(--text-muted)]"
          }`}
        >
          <GitMerge size={13} />
          <span>Overview</span>
        </button>
        <button
          onClick={() => setActiveTab("chat")}
          className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-mono font-semibold transition-all border-b-2 hover:text-[var(--text-light)] cursor-pointer ${
            activeTab === "chat" ? "border-violet-500 text-violet-400" : "border-transparent text-[var(--text-muted)]"
          }`}
        >
          <MessageSquare size={13} />
          <span>Adjustment Chat</span>
        </button>
        <button
          onClick={() => setActiveTab("console")}
          className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-mono font-semibold transition-all border-b-2 hover:text-[var(--text-light)] cursor-pointer relative ${
            activeTab === "console" ? "border-violet-500 text-violet-400" : "border-transparent text-[var(--text-muted)]"
          }`}
        >
          <Terminal size={13} />
          <span>Console Stream</span>
          {isReconciling && (
            <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-violet-400 animate-ping" />
          )}
        </button>
        <button
          onClick={() => setActiveTab("files")}
          className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-mono font-semibold transition-all border-b-2 hover:text-[var(--text-light)] cursor-pointer ${
            activeTab === "files" ? "border-violet-500 text-violet-400" : "border-transparent text-[var(--text-muted)]"
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
                <AlertTriangle size={12} className="text-amber-400" />
                <span>Overlapping File Modifications ({duplicateFilesEntries.length})</span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-3 select-none pr-1">
                {duplicateFilesEntries.length === 0 ? (
                  <div className="text-[var(--text-muted)] h-full flex flex-col items-center justify-center text-center px-4">
                    <GitMerge size={24} className="text-violet-500/25 mb-2" />
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
                          <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[9px] font-mono font-bold px-2 py-0.5 rounded-full uppercase">
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
                                className="bg-violet-500/10 text-violet-400 border border-violet-500/20 text-[9px] font-mono px-2 py-0.5 rounded-md"
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
                  <MessageSquare size={24} className="text-violet-500/35 mb-2" />
                  <span>Interactive chat with the reconciler. Run Reconciliate first to generate proposals.</span>
                </div>
              ) : (
                chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col rounded-xl p-3 w-full space-y-1 text-left ${
                      msg.role === "user"
                        ? "bg-violet-500/10 border border-violet-500/20"
                        : msg.role === "system"
                        ? "bg-[var(--bg-sidebar)]/30 border border-[var(--border-color)]/50 text-[var(--text-muted)] italic"
                        : "bg-[var(--bg-sidebar)] border border-[var(--border-color)]"
                    }`}
                  >
                    <span
                      className={`font-mono text-[9px] uppercase font-bold ${
                        msg.role === "user"
                          ? "text-violet-400"
                          : msg.role === "system"
                          ? "text-[var(--text-muted)]"
                          : "text-emerald-400"
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
              <div ref={chatEndRef} />
            </div>

            {/* Input area */}
            <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendChat();
                }}
                className="flex items-center space-x-2 bg-[var(--bg-app)] border border-[var(--border-color)] p-1.5 rounded-lg focus-within:border-violet-500"
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
                  className="bg-violet-600 hover:bg-violet-500 disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] text-white text-xs font-mono font-bold px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-all cursor-pointer"
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
            tabId={tabId}
            modifiedFiles={allModifiedFiles}
          />
        )}
      </div>

      {/* Footer Actions */}
      <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 flex items-center justify-end flex-shrink-0">
        {isReconciling ? (
          <button
            onClick={() => handleStopReconciliation()}
            className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-mono font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all shadow-md cursor-pointer animate-pulse"
          >
            <Loader2 size={13} className="animate-spin" />
            <span>Stop Execution</span>
          </button>
        ) : (
          <button
            onClick={() => startReconciliation()}
            disabled={duplicateFilesEntries.length === 0}
            className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-mono font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all shadow-md cursor-pointer"
          >
            <Play size={13} />
            <span>Run Reconciliate</span>
          </button>
        )}
      </div>
    </div>
  );
};
