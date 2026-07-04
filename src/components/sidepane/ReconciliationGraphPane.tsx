import React, { useState, useEffect, useRef, useMemo } from "react";
import { GitMerge, Play, Loader2, Settings, FileCode, MessageSquare, X } from "lucide-react";
import { useWorkspaceStore } from "../../store";
import { invoke } from "@tauri-apps/api/core";
import { notify } from "../../notificationStore";
import { EdgeDiffTabContent } from "../edgeinspector/components/EdgeDiffTabContent";
import { useResizable } from "./useResizable";
import { CustomSelect } from "../CustomSelect";

interface ReconciliationGraphPaneProps {
  onClose: () => void;
  tabId: string;
}

export const ReconciliationGraphPane: React.FC<ReconciliationGraphPaneProps> = ({ onClose, tabId }) => {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);

  // Resize hook
  const { width, containerRef, startResizing } = useResizable(500, "reconciliation_graph_pane_width");

  // States
  const [selectedModel, setSelectedModel] = useState(activeModel || "anthropic/claude-3-5-sonnet");
  const [activeTab, setActiveTab] = useState<"logs" | "files">("logs");
  const [isReconciling, setIsReconciling] = useState(false);
  const [logs, setLogs] = useState<{ role: string; content: string }[]>([]);
  const [showSettings, setShowSettings] = useState(true);

  // Diff states
  const [diffFile, setDiffFile] = useState<string>("");
  const [originalCode, setOriginalCode] = useState("// Click a file to load diff");
  const [modifiedCode, setModifiedCode] = useState("// Click a file to load diff");
  const [isDiffLoading, setIsDiffLoading] = useState(false);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);

  // Resolve canvas context task nodes
  const canvasNodes = useWorkspaceStore((state) => state.canvasContexts[tabId]?.nodes || []);
  const canvasEdges = useWorkspaceStore((state) => state.canvasContexts[tabId]?.edges || []);
  const setEdgeStatus = useWorkspaceStore((state) => state.setEdgeStatus);
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

  // Sync scroll on logs update
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Auto-select first diff file if none selected
  useEffect(() => {
    if (allModifiedFiles.length > 0 && !diffFile) {
      setDiffFile(allModifiedFiles[0]);
    }
  }, [allModifiedFiles, diffFile]);

  // Load VFS and Disk file diff contents
  const loadDiffContent = async (filePath: string) => {
    if (!filePath) return;
    setIsDiffLoading(true);
    try {
      const modified: string = await invoke("read_file_vfs", { path: filePath, tabId });
      let original = "";
      try {
        original = await invoke("read_file_disk", { path: filePath });
      } catch {
        original = "[New file generated during execution - not present on disk]";
      }
      setOriginalCode(original);
      setModifiedCode(modified);
    } catch (err: any) {
      console.error("[ReconciliationGraphPane] Diff failed:", err);
      setOriginalCode(`// Error: ${err.message || String(err)}`);
      setModifiedCode(`// Error: ${err.message || String(err)}`);
    } finally {
      setIsDiffLoading(false);
    }
  };

  useEffect(() => {
    if (diffFile) {
      loadDiffContent(diffFile);
    }
  }, [diffFile]);

  const startReconciliation = () => {
    if (isReconciling) return;
    setIsReconciling(true);
    setShowSettings(false);
    setActiveTab("logs");
    setLogs([{ role: "system", content: "Connecting to agent sidecar..." }]);

    let socket: WebSocket;
    try {
      socket = new WebSocket("ws://localhost:4000");
      socketRef.current = socket;
    } catch (err: any) {
      console.error("Failed to construct WebSocket:", err);
      setLogs((prev) => [...prev, { role: "system", content: `Connection failed: ${err.message || String(err)}` }]);
      setIsReconciling(false);
      return;
    }

    socket.onopen = () => {
      setLogs((prev) => [...prev, { role: "system", content: "Connected! Gaining spatial canvas context & files..." }]);
      const provider = customProviders.find((p) => p.id === activeCustomProviderId);

      socket.send(
        JSON.stringify({
          type: "reconciliate_graph",
          tabId,
          model: selectedModel,
          nodes: formattedNodes,
          workspaceRoot: rootPath,
          customProvider: provider && (provider.id !== "anthropic" && provider.id !== "openai" || !!provider.apiKey) ? provider : null,
        })
      );
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "read_file") {
          console.log(`[ReconciliateGraph] Sidecar reading file: ${msg.path}`);
          invoke("read_file_vfs", { path: msg.path, tabId })
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
          invoke("write_file_vfs", { path: msg.path, content: msg.content, tabId })
            .then(() => {
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "write_file_response", requestId: msg.requestId }));
              }
              // Refresh diff viewer
              if (diffFile === msg.path) {
                loadDiffContent(msg.path);
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
          setLogs((prev) => [...prev, { role: "assistant", content: msg.response || "Graph reconciliation complete." }]);
          setIsReconciling(false);

          // Mark all sequence wires (task-out to task-in) as reconciled
          const sequenceEdges = canvasEdges.filter(
            (e) => e.sourceHandle === "task-out" && e.targetHandle === "task-in"
          );
          sequenceEdges.forEach((edge) => {
            setEdgeStatus(edge.id, "reconciled");
          });

          notify("Reconciliation Complete", "Graph-wide code alignment completed successfully.", "success");
          if (diffFile) loadDiffContent(diffFile);
          socket.close();
        }

        if (msg.type === "reconciliation_graph_error") {
          setLogs((prev) => [...prev, { role: "assistant", content: `Error: ${msg.error}` }]);
          setIsReconciling(false);
          notify("Reconciliation Failed", `Error aligning graph: ${msg.error}`, "error");
          socket.close();
        }
      } catch (err: any) {
        console.error("[ReconciliationGraph] parse error:", err);
      }
    };

    socket.onerror = (error) => {
      console.error("[ReconciliationGraph] WebSocket error:", error);
      setLogs((prev) => [...prev, { role: "system", content: "Error: WebSocket connection failed." }]);
      setIsReconciling(false);
    };

    socket.onclose = () => {
      setIsReconciling(false);
    };
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

  return (
    <div
      ref={containerRef}
      style={{ width: `${width}px` }}
      className="border-l border-[var(--border-color)] bg-[var(--bg-app)]/95 flex flex-col h-full text-[var(--text-normal)] font-sans shadow-2xl relative z-[40]"
    >
      {/* Resizer Handle */}
      <div
        onMouseDown={startResizing}
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-violet-500/50 active:bg-violet-500 transition-colors z-50"
        style={{ transform: "translateX(-50%)" }}
      />
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] bg-gradient-to-r from-violet-500/10 to-transparent flex-shrink-0">
        <div className="flex flex-col">
          <span className="font-mono text-xs text-violet-400 uppercase tracking-wider flex items-center space-x-1.5">
            <GitMerge size={12} />
            <span>Graph Reconciliation</span>
          </span>
          <span className="font-semibold text-sm truncate">
            Aligning changes across {taskNodes.length} task(s)
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors p-1 rounded-lg hover:bg-[var(--bg-sidebar)] cursor-pointer"
        >
          <X size={16} />
        </button>
      </div>

      {/* Tabs Menu */}
      <div className="flex border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 px-2 flex-shrink-0">
        <button
          onClick={() => setActiveTab("logs")}
          className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-mono font-semibold transition-all border-b-2 hover:text-[var(--text-light)] cursor-pointer ${
            activeTab === "logs" ? "border-violet-500 text-violet-400" : "border-transparent text-[var(--text-muted)]"
          }`}
        >
          <MessageSquare size={13} />
          <span>Execution Logs</span>
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
        {activeTab === "logs" && (
          <div className="flex-1 flex flex-col overflow-hidden p-4">
            {/* Settings Card */}
            {showSettings && (
              <div className="mb-4 p-3 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl flex flex-col space-y-3 shadow-md">
                <div className="flex items-center justify-between text-xs font-mono text-[var(--text-light)] font-semibold border-b border-[var(--border-color)] pb-2">
                  <div className="flex items-center space-x-1.5">
                    <Settings size={13} className="text-violet-400" />
                    <span>Reconciliation Settings</span>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-[var(--text-muted)] mb-1">
                    Select Agent Model
                  </label>
                  <CustomSelect
                    value={selectedModel}
                    onChange={(val) => setSelectedModel(val)}
                    options={modelOptions}
                    placeholder="Select Model"
                    className="w-full text-xs"
                    direction="down"
                  />
                </div>
              </div>
            )}

            {/* Logs Area */}
            <div className="flex-1 bg-black/20 border border-[var(--border-color)] rounded-xl p-3 font-mono text-[11px] leading-relaxed overflow-y-auto select-text scrollbar-thin">
              {logs.length === 0 ? (
                <div className="text-[var(--text-muted)] h-full flex flex-col items-center justify-center text-center px-4">
                  <GitMerge size={24} className="text-violet-500/35 mb-2 animate-pulse" />
                  <span>No execution log records found. Click Reconciliate below to start resolving conflicts across the graph.</span>
                </div>
              ) : (
                <div className="space-y-3">
                  {logs.map((log, idx) => (
                    <div
                      key={idx}
                      className={`p-2 rounded-lg border ${
                        log.role === "system"
                          ? "bg-violet-900/10 border-violet-500/20 text-violet-300"
                          : "bg-[var(--bg-sidebar)] border-[var(--border-color)] text-[var(--text-normal)]"
                      }`}
                    >
                      <div className="text-[10px] text-[var(--text-muted)] uppercase mb-1 font-bold">
                        {log.role === "system" ? "System Router" : "Reconciliation Agent"}
                      </div>
                      <div className="whitespace-pre-wrap">{log.content}</div>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "files" && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {allModifiedFiles.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-[var(--text-muted)]">
                <FileCode size={28} className="text-[var(--text-muted)]/30 mb-2" />
                <span className="text-xs">No modified VFS files detected in this canvas tab graph. Run tasks first.</span>
              </div>
            ) : (
              <div className="flex-1 flex overflow-hidden">
                {/* File Sidebar */}
                <div className="w-1/3 border-r border-[var(--border-color)] overflow-y-auto bg-[var(--bg-sidebar)]/10">
                  {allModifiedFiles.map((file) => {
                    const parts = file.split("/");
                    const name = parts[parts.length - 1];
                    const dir = parts.slice(0, -1).join("/");
                    return (
                      <button
                        key={file}
                        onClick={() => setDiffFile(file)}
                        className={`w-full text-left p-2.5 border-b border-[var(--border-color)] flex flex-col space-y-0.5 transition-all cursor-pointer ${
                          diffFile === file ? "bg-violet-500/10 border-l-2 border-l-violet-500" : "hover:bg-[var(--bg-sidebar)]/35"
                        }`}
                      >
                        <span className="font-semibold text-xs text-[var(--text-normal)] truncate">{name}</span>
                        {dir && <span className="text-[9px] text-[var(--text-muted)] truncate">{dir}</span>}
                      </button>
                    );
                  })}
                </div>

                {/* Diff Viewer Area */}
                <div className="w-2/3 flex flex-col overflow-hidden relative">
                  {isDiffLoading ? (
                    <div className="flex-1 flex flex-col items-center justify-center bg-black/10">
                      <Loader2 className="animate-spin text-violet-500 mb-2" size={24} />
                      <span className="text-xs text-[var(--text-muted)]">Loading file diff...</span>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col overflow-hidden">
                      <div className="px-3 py-1.5 border-b border-[var(--border-color)] bg-black/10 flex items-center justify-between flex-shrink-0">
                        <span className="text-[10px] font-mono text-[var(--text-muted)] truncate max-w-[200px]">
                          Viewing: {diffFile.split("/").pop()}
                        </span>
                      </div>
                      <div className="flex-1 overflow-hidden relative">
                        <EdgeDiffTabContent
                          sourceModifiedFiles={allModifiedFiles}
                          diffFile={diffFile}
                          setDiffFile={setDiffFile}
                          loadDiffContent={loadDiffContent}
                          originalCode={originalCode}
                          modifiedCode={modifiedCode}
                          tabId={tabId}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 flex items-center justify-between flex-shrink-0">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`p-2 rounded-lg border border-[var(--border-color)] transition-all cursor-pointer ${
            showSettings ? "bg-violet-500/10 text-violet-400 border-violet-500/20" : "text-[var(--text-muted)] hover:text-[var(--text-light)]"
          }`}
          title="Toggle reconciliation configuration settings"
        >
          <Settings size={14} />
        </button>

        <button
          onClick={startReconciliation}
          disabled={isReconciling || taskNodes.length === 0}
          className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-mono font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all shadow-md cursor-pointer"
        >
          {isReconciling ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              <span>Reconciling...</span>
            </>
          ) : (
            <>
              <Play size={13} />
              <span>Run Reconciliate</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
