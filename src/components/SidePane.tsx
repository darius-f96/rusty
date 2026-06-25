import React, { useState, useEffect, useRef, useCallback } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { X, Terminal, MessageSquare, Code, Play, Sparkles, Globe, Send, Settings } from "lucide-react";
import { useWorkspaceStore } from "../store";
import { invoke } from "@tauri-apps/api/core";
import { CustomSelect } from "./CustomSelect";
import { processResponse } from "../services/responseProcessingService";

const EMPTY_ARRAY: any[] = [];

interface SidePaneProps {
  onClose: () => void;
  onExecuteNode: (nodeId: string) => void;
}

export const SidePane: React.FC<SidePaneProps> = ({ onClose, onExecuteNode }) => {
  const selectedNodeId = useWorkspaceStore((state) => state.selectedNodeId);
  const nodes = useWorkspaceStore((state) => state.nodes);
  const rawNodeLogs = useWorkspaceStore((state) => state.nodeLogs[selectedNodeId || ""]);
  const nodeLogs = rawNodeLogs || EMPTY_ARRAY;
  const nodeStatus = useWorkspaceStore((state) => state.nodeStatus[selectedNodeId || ""] || "idle");

  const [activeTab, setActiveTab] = useState<"diff" | "chat" | "console">("diff");
  const [chatMessage, setChatMessage] = useState("");
  const [originalCode, setOriginalCode] = useState("// Loading original content...");
  const [modifiedCode, setModifiedCode] = useState("// Loading modified content...");

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const modifiedFiles = (selectedNode?.data?.modifiedFiles as string[]) || EMPTY_ARRAY;
  const [activeDiffFile, setActiveDiffFile] = useState<string>("");

  // Resizable state
  const [width, setWidth] = useState(500);
  const isResizing = useRef(false);

  const handleMouseMove = useCallback((mouseMoveEvent: MouseEvent) => {
    if (!isResizing.current) return;
    const newWidth = window.innerWidth - mouseMoveEvent.clientX;
    if (newWidth > 300 && newWidth < 1000) {
      setWidth(newWidth);
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isResizing.current = false;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  }, []);

  const startResizing = useCallback((mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    isResizing.current = true;
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove, handleMouseUp]);

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // Explorer Chat State
  const [explorerInput, setExplorerInput] = useState("");
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const explorerSocketRef = useRef<WebSocket | null>(null);

  const addGlobalChatMessage = useWorkspaceStore((state) => state.addGlobalChatMessage);
  const setGlobalContextSummary = useWorkspaceStore((state) => state.setGlobalContextSummary);
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode);
  const addLog = useWorkspaceStore((state) => state.addLog);
  const setNodeStatus = useWorkspaceStore((state) => state.setNodeStatus);
  const globalChatHistory = useWorkspaceStore((state) => state.globalChatHistory[selectedNodeId || ""] || EMPTY_ARRAY);
  
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const providers = useWorkspaceStore((state) => state.customProviders);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);
  const activeProvider = providers.find((p) => p.id === activeCustomProviderId);
  const availableModels = activeProvider ? activeProvider.models : EMPTY_ARRAY;

  const exploreModel = (selectedNode?.data?.exploreModel as string) || activeModel;
  const summarizeModel = (selectedNode?.data?.summarizeModel as string) || activeModel;

  // Set default active tab based on selected node type
  useEffect(() => {
    if (!selectedNode) return;
    if (selectedNode.type === "globalChatNode") {
      setActiveTab("chat");
    } else {
      setActiveTab("diff");
    }
  }, [selectedNode?.id, selectedNode?.type]);

  useEffect(() => {
    return () => {
      if (explorerSocketRef.current) {
        explorerSocketRef.current.close();
      }
    };
  }, []);

  const handleExplorerSendMessage = () => {
    if (!selectedNode) return;
    const id = selectedNode.id;
    if (!explorerInput.trim() || nodeStatus === "running") return;

    const userMessage = {
      role: "user" as const,
      content: explorerInput.trim(),
      timestamp: new Date().toLocaleTimeString()
    };

    addGlobalChatMessage(id, userMessage);
    setExplorerInput("");
    setNodeStatus(id, "running");
    addLog(id, `User prompt: ${userMessage.content}`);

    console.log(`[SidePane] Connecting to ws://localhost:4000...`);
    const socket = new WebSocket("ws://localhost:4000");
    explorerSocketRef.current = socket;

    socket.onopen = () => {
      console.log(`[SidePane] WebSocket connected!`);
      addLog(id, "Connected to agent sidecar for global exploration...");

      const rootPath = useWorkspaceStore.getState().rootPath;
      const providers = useWorkspaceStore.getState().customProviders;
      const activeProviderId = useWorkspaceStore.getState().activeCustomProviderId;
      const provider = providers.find((p) => p.id === activeProviderId);
      const activeModel = useWorkspaceStore.getState().activeModel;
      const exploreModel = selectedNode.data.exploreModel || activeModel;
      const chatHistory = useWorkspaceStore.getState().globalChatHistory[id] || [];

      socket.send(JSON.stringify({
        type: "global_explore",
        nodeId: id,
        prompt: userMessage.content,
        workspaceRoot: rootPath,
        model: exploreModel,
        chatHistory: chatHistory.map((m) => ({ role: m.role, content: m.content })),
        customProvider:
          provider &&
          (provider.id !== "anthropic" && provider.id !== "openai" || !!provider.apiKey)
            ? provider
            : null,
      }));
    };

    socket.onmessage = (event) => {
      console.log(`[SidePane] Received message:`, event.data);
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "log" && msg.nodeId === id) {
          addLog(id, msg.message);
          return;
        }

        if (msg.type === "read_file") {
          console.log(`[SidePane] Tool request: read_file ${msg.path}`);
          invoke("read_file_vfs", { path: msg.path }).then((content: unknown) => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: "read_file_response",
                requestId: msg.requestId,
                content: content as string
              }));
            } else {
              console.warn(`[SidePane] Socket closed before read_file_response could be sent for ${msg.path}`);
            }
          }).catch((err: any) => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: "read_file_response",
                requestId: msg.requestId,
                error: err.message || String(err)
              }));
            } else {
              console.warn(`[SidePane] Socket closed before read_file error could be sent for ${msg.path}`);
            }
          });
          return;
        }

        if (msg.type === "global_explore_complete" && msg.nodeId === id) {
          console.log(`[SidePane] Exploration complete! Response length: ${msg.response?.length || 0}`);
          const assistantMsg = {
            role: "assistant" as const,
            content: msg.response || "Exploration complete.",
            timestamp: new Date().toLocaleTimeString()
          };
          addGlobalChatMessage(id, assistantMsg);

          if (msg.summary) {
            setGlobalContextSummary(msg.summary);
            updateNode(id, { summary: msg.summary });
            addLog(id, `Global context summary updated (${msg.summary.length} chars).`);
          }

          setNodeStatus(id, "success");
          addLog(id, "Global exploration completed successfully.");
          socket.close();
        }

        if (msg.type === "global_explore_error" && msg.nodeId === id) {
          console.log(`[SidePane] Exploration error: ${msg.error}`);
          const errorMsg = {
            role: "assistant" as const,
            content: `Error: ${msg.error}`,
            timestamp: new Date().toLocaleTimeString()
          };
          addGlobalChatMessage(id, errorMsg);
          setNodeStatus(id, "error");
          addLog(id, `Global exploration error: ${msg.error}`);
          socket.close();
        }
      } catch (err: any) {
        console.error(`[SidePane] Parse error:`, err);
        addLog(id, `Parse error: ${err.message}`);
      }
    };

    socket.onerror = (error) => {
      console.error(`[SidePane] Explorer WebSocket error:`, error);
      addLog(id, "Connection to sidecar failed. Ensure sidecar is running on port 4000.");
      setNodeStatus(id, "error");
      const errorMsg = {
        role: "assistant" as const,
        content: "Connection failed. Please ensure the agent sidecar is running.",
        timestamp: new Date().toLocaleTimeString()
      };
      addGlobalChatMessage(id, errorMsg);
    };

    socket.onclose = (event) => {
      console.log(`[SidePane] Explorer WebSocket closed (code: ${event.code}, reason: "${event.reason}", clean: ${event.wasClean})`);
      addLog(id, `Explorer WebSocket closed (code: ${event.code}, reason: "${event.reason || "none"}", clean: ${event.wasClean})`);
      
      const currentStatus = useWorkspaceStore.getState().nodeStatus[id];
      if (currentStatus === "running") {
        setNodeStatus(id, "error");
        const errorMsg = {
          role: "assistant" as const,
          content: `Connection lost unexpectedly (WebSocket close code: ${event.code}).`,
          timestamp: new Date().toLocaleTimeString()
        };
        addGlobalChatMessage(id, errorMsg);
      }
      explorerSocketRef.current = null;
    };
  };

  const handleExplorerSummarize = () => {
    if (!selectedNode) return;
    const id = selectedNode.id;
    const chatHistory = useWorkspaceStore.getState().globalChatHistory[id] || [];
    if (chatHistory.length === 0) {
      alert("No conversation to summarize.");
      return;
    }
    if (nodeStatus === "running" || isSummarizing) return;

    setIsSummarizing(true);
    setNodeStatus(id, "running");
    addLog(id, "Summarizing conversation...");

    const socket = new WebSocket("ws://localhost:4000");
    explorerSocketRef.current = socket;

    const conversationText = chatHistory.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");

    socket.onopen = () => {
      const rootPath = useWorkspaceStore.getState().rootPath;
      const providers = useWorkspaceStore.getState().customProviders;
      const activeProviderId = useWorkspaceStore.getState().activeCustomProviderId;
      const provider = providers.find((p) => p.id === activeProviderId);
      const activeModel = useWorkspaceStore.getState().activeModel;
      const summarizeModel = selectedNode.data.summarizeModel || activeModel;

      socket.send(JSON.stringify({
        type: "global_explore",
        nodeId: id,
        prompt: `Please summarize the following conversation concisely, highlighting the key insights, findings, and any important decisions or next steps mentioned:\n\n${conversationText}`,
        workspaceRoot: rootPath,
        model: summarizeModel,
        chatHistory: [],
        customProvider:
          provider &&
          (provider.id !== "anthropic" && provider.id !== "openai" || !!provider.apiKey)
            ? provider
            : null,
      }));
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "log" && msg.nodeId === id) {
          addLog(id, msg.message);
          return;
        }

        if (msg.type === "read_file") {
          invoke("read_file_vfs", { path: msg.path }).then((content: unknown) => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: "read_file_response",
                requestId: msg.requestId,
                content: content as string
              }));
            } else {
              console.warn(`[SidePane] Summarize socket closed before read_file_response could be sent`);
            }
          }).catch((err: any) => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: "read_file_response",
                requestId: msg.requestId,
                error: err.message || String(err)
              }));
            } else {
              console.warn(`[SidePane] Summarize socket closed before read_file error could be sent`);
            }
          });
          return;
        }

        if (msg.type === "global_explore_complete" && msg.nodeId === id) {
          const summary = msg.response || "Summary not available.";
          setGlobalContextSummary(summary);
          updateNode(id, { summary });
          setNodeStatus(id, "success");
          addLog(id, `Conversation summarized (${summary.length} chars).`);
          setIsSummarizing(false);
          socket.close();
        }

        if (msg.type === "global_explore_error" && msg.nodeId === id) {
          setNodeStatus(id, "error");
          addLog(id, `Summarize error: ${msg.error}`);
          setIsSummarizing(false);
          socket.close();
        }
      } catch (err: any) {
        addLog(id, `Parse error: ${err.message}`);
        setIsSummarizing(false);
      }
    };

    socket.onerror = (error) => {
      console.error(`[SidePane] Summarize WebSocket error:`, error);
      addLog(id, "Connection to sidecar failed during summarization.");
      setNodeStatus(id, "error");
      setIsSummarizing(false);
    };

    socket.onclose = (event) => {
      console.log(`[SidePane] Summarize WebSocket closed (code: ${event.code}, reason: "${event.reason}", clean: ${event.wasClean})`);
      addLog(id, `Summarize WebSocket closed (code: ${event.code}, reason: "${event.reason || "none"}", clean: ${event.wasClean})`);
      
      const currentStatus = useWorkspaceStore.getState().nodeStatus[id];
      if (currentStatus === "running") {
        setNodeStatus(id, "error");
      }
      setIsSummarizing(false);
      explorerSocketRef.current = null;
    };
  };

  // Select which file should be shown in the diff viewer
  useEffect(() => {
    if (!selectedNode) return;
    if (selectedNode.type === "contextNode") {
      const path = selectedNode.data.path as string;
      if (path && !selectedNode.data.isDir) {
        if (activeDiffFile !== path) {
          setActiveDiffFile(path);
        }
      }
    } else if (selectedNode.type === "taskNode") {
      if (modifiedFiles.length > 0) {
        if (!modifiedFiles.includes(activeDiffFile)) {
          setActiveDiffFile(modifiedFiles[0]);
        }
      } else {
        if (activeDiffFile !== "") {
          setActiveDiffFile("");
        }
      }
    }
  }, [selectedNode?.id, modifiedFiles, activeDiffFile]);

  // Fetch file content for preview / diffing
  useEffect(() => {
    let active = true;
    const fetchDiffContent = async () => {
      if (!selectedNode || !activeDiffFile) return;

      try {
        console.log(`SidePane [fetchDiffContent] loading paths`, { activeDiffFile });
        
        // Read modified content from Tauri VFS
        const modified: string = await invoke("read_file_vfs", { path: activeDiffFile });
        
        // Read original content from physical disk
        let original = "";
        try {
          original = await invoke("read_file_disk", { path: activeDiffFile });
        } catch (diskErr) {
          console.log(`SidePane [fetchDiffContent] File not on disk yet (treating as new file)`);
          original = "";
        }
        
        if (active) {
          setOriginalCode(original);
          setModifiedCode(modified);
        }
      } catch (e: any) {
        console.error("SidePane [fetchDiffContent] failed to read content:", e);
        if (active) {
          setOriginalCode(`// Error reading file: ${e.message}`);
          setModifiedCode(`// Error reading file: ${e.message}`);
        }
      }
    };

    fetchDiffContent();
    return () => {
      active = false;
    };
  }, [selectedNode?.id, activeDiffFile, nodeStatus]);

  if (!selectedNode) return null;

  // Simple language detector based on extension
  const getEditorLanguage = (filePath: string): string => {
    const ext = filePath.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "ts":
      case "tsx":
        return "typescript";
      case "js":
      case "jsx":
        return "javascript";
      case "json":
        return "json";
      case "rs":
        return "rust";
      case "css":
        return "css";
      case "html":
        return "html";
      case "md":
        return "markdown";
      default:
        return "plaintext";
    }
  };

  return (
    <div 
      style={{ width: `${width}px` }} 
      className="border-l border-[var(--border-color)] bg-[var(--bg-app)]/95 flex flex-col h-full text-[var(--text-normal)] font-sans shadow-2xl relative"
    >
      {/* Resizer Handle */}
      <div
        onMouseDown={startResizing}
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-violet-500/50 active:bg-violet-500 transition-colors z-50"
        style={{ transform: "translateX(-50%)" }}
      />

      {/* Pane Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/40 select-none">
        <div className="flex flex-col">
          <span className="font-mono text-xs text-[var(--text-muted)] uppercase tracking-wider">
            {selectedNode.type === "globalChatNode" ? "Workspace Explorer" : "Inspector"}
          </span>
          <span className="font-semibold text-sm truncate max-w-[320px]">
            {selectedNode.type === "contextNode"
              ? (selectedNode.data as any).name
              : (selectedNode.data as any).name || `Task Node (${selectedNode.id})`}
          </span>
        </div>
        <div className="flex items-center space-x-1">
          {selectedNode.type === "globalChatNode" && (
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors p-1.5 rounded-lg hover:bg-[var(--bg-sidebar)] cursor-pointer"
              title="Explorer settings"
            >
              <Settings size={15} />
            </button>
          )}
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors p-1 rounded-lg hover:bg-[var(--bg-sidebar)] cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Tabs Row */}
      <div className="flex border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/10 text-xs font-mono select-none">
        {selectedNode.type !== "globalChatNode" && (
          <button
            onClick={() => setActiveTab("diff")}
            className={`flex items-center space-x-1.5 px-4 py-2.5 border-b-2 transition-all ${
              activeTab === "diff"
                ? "border-[var(--accent-color)] text-[var(--text-light)] bg-[var(--accent-bg)] font-semibold"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-light)]"
            }`}
          >
            <Code size={14} />
            <span>VFS Diff</span>
          </button>
        )}
        <button
          onClick={() => setActiveTab("chat")}
          className={`flex items-center space-x-1.5 px-4 py-2.5 border-b-2 transition-all ${
            activeTab === "chat"
              ? "border-[var(--accent-color)] text-[var(--text-light)] bg-[var(--accent-bg)] font-semibold"
              : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-light)]"
          }`}
        >
          <MessageSquare size={14} />
          <span>{selectedNode.type === "globalChatNode" ? "Explorer Chat" : "Prompt Chat"}</span>
        </button>
        {selectedNode.type !== "contextNode" && (
          <button
            onClick={() => setActiveTab("console")}
            className={`flex items-center space-x-1.5 px-4 py-2.5 border-b-2 transition-all relative ${
              activeTab === "console"
                ? "border-[var(--accent-color)] text-[var(--text-light)] bg-[var(--accent-bg)] font-semibold"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-light)]"
            }`}
          >
            <Terminal size={14} />
            <span>Console Stream</span>
            {nodeStatus === "running" && (
              <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] animate-ping" />
            )}
          </button>
        )}
      </div>

      {/* File Diff Dropdown Selector (only for TaskNode when files are edited) */}
      {selectedNode.type === "taskNode" && modifiedFiles.length > 0 && (
        <div className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] flex items-center justify-between text-xs font-mono">
          <span className="text-[var(--text-muted)]">File Diff:</span>
          <select
            value={activeDiffFile}
            onChange={(e) => setActiveDiffFile(e.target.value)}
            className="bg-[var(--bg-app)] text-[var(--text-normal)] border border-[var(--border-color)] rounded px-2.5 py-1 outline-none text-[11px] max-w-[300px] truncate focus:border-[var(--border-active)] cursor-pointer"
          >
            {modifiedFiles.map((file) => (
              <option key={file} value={file}>
                {file.split("/").pop() || file}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Tabs Content */}
      <div className="flex-1 overflow-hidden relative bg-[var(--bg-app)]">
        {activeTab === "diff" && selectedNode.type !== "globalChatNode" && (
          activeDiffFile ? (
            <div className="w-full h-full">
              <DiffEditor
                height="100%"
                language={getEditorLanguage(activeDiffFile)}
                theme="axiom-custom-theme"
                original={originalCode}
                modified={modifiedCode}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  lineNumbers: "on",
                  renderSideBySide: true,
                  fontSize: 11
                }}
              />
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-[var(--text-muted)] font-mono text-xs space-y-2">
              <span className="text-[var(--accent-color)] font-bold">// Sandbox VFS Standby</span>
              <span className="text-[11px] text-[var(--text-muted)] max-w-[280px]">
                No files modified by this task node yet. Connect a source File Node, type prompt instructions, and click "Run Executor".
              </span>
            </div>
          )
        )}

        {activeTab === "console" && selectedNode.type !== "contextNode" && (
          <div className="flex flex-col h-full p-4 font-mono text-xs bg-black text-zinc-400 overflow-y-auto space-y-1">
            {nodeLogs.length === 0 ? (
              <span className="text-zinc-600">// No execution logs yet.</span>
            ) : (
              nodeLogs.map((log, idx) => (
                <div key={idx} className="whitespace-pre-wrap leading-relaxed">
                  {log}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "chat" && (
          selectedNode.type === "globalChatNode" ? (
            <div className="flex flex-col h-full bg-[var(--bg-app)]">
              {/* Chat sub-header with model status and settings toggle */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 select-none flex-shrink-0">
                <div className="flex items-center space-x-2 text-[10px] font-mono text-[var(--text-muted)]">
                  <span>Chat: <strong className="text-violet-400">{(exploreModel || "").split("/").pop() || "None"}</strong></span>
                  <span>•</span>
                  <span>Summ: <strong className="text-amber-400">{(summarizeModel || "").split("/").pop() || "None"}</strong></span>
                </div>
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="flex items-center space-x-1 text-[11px] font-medium text-violet-400 hover:text-violet-300 transition-colors cursor-pointer"
                >
                  <Settings size={12} />
                  <span>Configure Models</span>
                </button>
              </div>

              {/* Explorer settings configuration drawer inside chat */}
              {showSettings && (
                <div className="bg-[var(--bg-sidebar)]/80 border-b border-[var(--border-color)] p-3.5 space-y-3 text-xs font-sans select-none animate-fadeIn flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[var(--text-light)] flex items-center space-x-1.5">
                      <Settings size={12} className="text-violet-400" />
                      <span>Explorer Settings</span>
                    </span>
                    <button onClick={() => setShowSettings(false)} className="text-[var(--text-muted)] hover:text-[var(--text-light)] cursor-pointer">
                      <X size={14} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3.5 font-mono text-[11px]">
                    <div className="flex flex-col space-y-1 col-span-2 border-b border-[var(--border-color)] pb-2 mb-1">
                      <span className="text-[var(--text-muted)] font-sans">Active LLM Provider:</span>
                      <CustomSelect
                        value={activeCustomProviderId || ""}
                        onChange={(newProviderId) => {
                          useWorkspaceStore.getState().setActiveCustomProviderId(newProviderId);
                          const prov = providers.find((p) => p.id === newProviderId);
                          if (prov && prov.models && prov.models.length > 0) {
                            useWorkspaceStore.getState().setActiveModel(prov.models[0].id);
                            updateNode(selectedNode.id, { 
                              exploreModel: prov.models[0].id,
                              summarizeModel: prov.models[0].id
                            });
                          }
                        }}
                        options={providers.map((p: any) => ({ id: p.id, name: p.name }))}
                      />
                    </div>
                    <div className="flex flex-col space-y-1">
                      <span className="text-[var(--text-muted)] font-sans">Exploration Model:</span>
                      <CustomSelect
                        value={exploreModel}
                        onChange={(val) => updateNode(selectedNode.id, { exploreModel: val })}
                        options={availableModels.length > 0 ? availableModels : [{ id: exploreModel, name: (exploreModel || "").split("/").pop() || exploreModel || "None" }]}
                      />
                    </div>
                    <div className="flex flex-col space-y-1">
                      <span className="text-[var(--text-muted)] font-sans">Summarization Model:</span>
                      <CustomSelect
                        value={summarizeModel}
                        onChange={(val) => updateNode(selectedNode.id, { summarizeModel: val })}
                        options={availableModels.length > 0 ? availableModels : [{ id: summarizeModel, name: (summarizeModel || "").split("/").pop() || summarizeModel || "None" }]}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Explorer Chat History */}
              <div className="flex-1 p-4 space-y-4 overflow-y-auto text-xs">
                {globalChatHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center text-[var(--text-muted)] space-y-2 select-none">
                    <Globe size={32} className="text-violet-400 mb-2 animate-pulse" />
                    <span className="font-semibold text-sm">Global Workspace Explorer</span>
                    <span className="max-w-[280px]">
                      Ask the explorer agent to analyze patterns, codebase architecture, and conventions.
                    </span>
                  </div>
                ) : (
                  globalChatHistory.map((msg: any, idx: number) => (
                    <div
                      key={idx}
                      className={`flex flex-col rounded-xl p-3 border space-y-1 w-full ${
                        msg.role === "user"
                          ? "bg-[var(--accent-bg)]/20 border-[var(--accent-color)]/30"
                          : "bg-[var(--bg-sidebar)]/60 border border-[var(--border-color)]/80"
                      }`}
                    >
                      <span className={`font-mono text-[9px] uppercase font-bold ${
                        msg.role === "user" ? "text-[var(--accent-color)]" : "text-violet-400"
                      }`}>
                        {msg.role === "user" ? "You" : "Explorer"} · {msg.timestamp}
                      </span>
                      <span className="leading-relaxed whitespace-pre-wrap text-[var(--text-normal)] text-left">
                        {msg.role === "user" ? msg.content : processResponse(msg.content)}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {/* Explorer Input prompt area */}
              <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20">
                <div className="flex items-center space-x-2">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleExplorerSendMessage();
                    }}
                    className="flex-1 flex items-center space-x-2 bg-[var(--bg-app)] border border-[var(--border-color)] p-1.5 rounded-lg focus-within:border-[var(--border-active)]"
                  >
                    <input
                      type="text"
                      placeholder="Explore codebase..."
                      value={explorerInput}
                      onChange={(e) => setExplorerInput(e.target.value)}
                      className="flex-1 bg-transparent border-none outline-none text-xs px-2 py-1 focus:ring-0 text-[var(--text-normal)]"
                      disabled={nodeStatus === "running"}
                    />
                    <button
                      type="submit"
                      disabled={nodeStatus === "running" || !explorerInput.trim()}
                      className="bg-violet-600 hover:bg-violet-500 disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] text-white text-xs font-mono font-bold px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-all cursor-pointer"
                    >
                      <Send size={12} />
                      <span>Send</span>
                    </button>
                  </form>
                  <button
                    onClick={handleExplorerSummarize}
                    disabled={nodeStatus === "running" || isSummarizing || globalChatHistory.length === 0}
                    className="bg-amber-600/90 hover:bg-amber-500/95 disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] text-white text-xs font-mono font-bold px-3 py-2 rounded-md flex items-center space-x-1 transition-all cursor-pointer"
                    title="Generate global architectural summary"
                  >
                    <Sparkles size={12} className={isSummarizing ? "animate-spin" : ""} />
                    <span>{isSummarizing ? "Summarize" : "Summarize"}</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            // TaskNode Chat View (Existing logic)
            <div className="flex flex-col h-full bg-[var(--bg-app)]">
              {/* Mocked conversation preview */}
              <div className="flex-1 p-4 space-y-4 overflow-y-auto text-xs">
                <div className="flex flex-col bg-[var(--bg-sidebar)]/60 border border-[var(--border-color)]/80 rounded-xl p-3 w-full space-y-1 text-left">
                  <span className="font-mono text-[9px] uppercase font-bold text-violet-400">System Agent</span>
                  <span className="leading-relaxed">
                    I will check the attached file inputs and execute your modifications. You can type instructions below to refine my work.
                  </span>
                </div>
                {chatMessage && nodeStatus === "success" && (
                  <div className="flex flex-col bg-[var(--accent-bg)]/20 border border-[var(--accent-color)]/30 rounded-xl p-3 w-full space-y-1 text-left">
                    <span className="font-mono text-[9px] uppercase font-bold text-[var(--accent-color)]">User</span>
                    <span className="leading-relaxed text-[var(--text-light)]">{chatMessage}</span>
                  </div>
                )}
              </div>

              {/* Input prompt area */}
              <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!chatMessage.trim()) return;
                    onExecuteNode(selectedNode.id);
                  }}
                  className="flex items-center space-x-2 bg-[var(--bg-app)] border border-[var(--border-color)] p-1.5 rounded-lg focus-within:border-[var(--border-active)]"
                >
                  <input
                    type="text"
                    placeholder="e.g. Refactor this helper into a separate hook..."
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    className="flex-1 bg-transparent border-none outline-none text-xs px-2 py-1 focus:ring-0 text-[var(--text-normal)]"
                  />
                  <button
                    type="submit"
                    disabled={nodeStatus === "running"}
                    className="bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] text-white text-xs font-mono font-bold px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-all glow-btn cursor-pointer"
                  >
                    <Play size={12} />
                    <span>Prompt</span>
                  </button>
                </form>
              </div>
            </div>
          )
        )}
      </div>

      {/* Footer controls for executing node */}
      {selectedNode.type === "taskNode" && activeTab !== "chat" && (
        <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 flex items-center justify-between">
          <span className="text-[10px] uppercase font-mono text-[var(--text-muted)]">
            Status: <span className="font-bold text-[var(--text-normal)]">{nodeStatus}</span>
          </span>
          <button
            onClick={() => onExecuteNode(selectedNode.id)}
            disabled={nodeStatus === "running"}
            className="bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] text-white text-xs font-mono font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all glow-btn shadow-md cursor-pointer"
          >
            <Sparkles size={14} className={nodeStatus === "running" ? "animate-spin" : ""} />
            <span>{nodeStatus === "running" ? "Running..." : "Run Executor"}</span>
          </button>
        </div>
      )}
    </div>
  );
};
