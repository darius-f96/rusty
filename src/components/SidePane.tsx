import React, { useState, useEffect, useRef, useCallback } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { X, Terminal, MessageSquare, Code, Play, Sparkles, Globe, Send, FileCode } from "lucide-react";
import { useWorkspaceStore } from "../store";
import { invoke } from "@tauri-apps/api/core";

// File mentions parsing function
export function formatMessageText(text: string) {
  if (!text) return "";
  
  const markdownFileLinkRegex = /\[([^\]]+)\]\((file:\/\/\/[^\)]+)\)/g;
  const pathRegex = /(?:\B@)?(?:\b(?:\/|\.\/|\.\.\/)[a-zA-Z0-9_\-\.\/]+(?:\.[a-zA-Z0-9]+)?\b|\b[a-zA-Z0-9_\-\.]+\.(?:ts|tsx|js|jsx|json|py|md|css|rs|html|yml|yaml|txt|gitignore|sh|toml)\b)/g;

  const tokens: Array<{type: "text" | "file"; content: string; path?: string}> = [];
  let lastIndex = 0;
  
  const combinedRegex = new RegExp(
    `${markdownFileLinkRegex.source}|${pathRegex.source}`,
    "g"
  );
  
  let match;
  while ((match = combinedRegex.exec(text)) !== null) {
    const matchIndex = match.index;
    const matchText = match[0];
    
    if (matchIndex > lastIndex) {
      tokens.push({ type: "text", content: text.substring(lastIndex, matchIndex) });
    }
    
    if (match[1] && match[2]) {
      tokens.push({ type: "file", content: match[1], path: match[2] });
    } else {
      let cleanPath = matchText.trim();
      if (cleanPath.startsWith("@")) {
        cleanPath = cleanPath.slice(1);
      }
      tokens.push({ type: "file", content: cleanPath, path: cleanPath });
    }
    
    lastIndex = combinedRegex.lastIndex;
  }
  
  if (lastIndex < text.length) {
    tokens.push({ type: "text", content: text.substring(lastIndex) });
  }
  
  return tokens.map((token, i) => {
    if (token.type === "file") {
      return (
        <span
          key={i}
          className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-violet-500/10 border border-violet-500/20 text-violet-400 font-mono text-[11px] hover:bg-violet-500/20 transition-all cursor-pointer select-all"
          title={`Mentioned path: ${token.path}`}
        >
          <FileCode size={10} className="text-violet-400 flex-shrink-0" />
          <span>{token.content}</span>
        </span>
      );
    }
    return <span key={i}>{token.content}</span>;
  });
}

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
  const explorerSocketRef = useRef<WebSocket | null>(null);

  const addGlobalChatMessage = useWorkspaceStore((state) => state.addGlobalChatMessage);
  const setGlobalContextSummary = useWorkspaceStore((state) => state.setGlobalContextSummary);
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode);
  const addLog = useWorkspaceStore((state) => state.addLog);
  const setNodeStatus = useWorkspaceStore((state) => state.setNodeStatus);
  const globalChatHistory = useWorkspaceStore((state) => state.globalChatHistory[selectedNodeId || ""] || EMPTY_ARRAY);

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
      const chatHistory = useWorkspaceStore.getState().globalChatHistory[id] || [];

      socket.send(JSON.stringify({
        type: "global_explore",
        nodeId: id,
        prompt: userMessage.content,
        workspaceRoot: rootPath,
        model: activeModel,
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
            socket.send(JSON.stringify({
              type: "read_file_response",
              requestId: msg.requestId,
              content: content as string
            }));
          }).catch((err: any) => {
            socket.send(JSON.stringify({
              type: "read_file_response",
              requestId: msg.requestId,
              error: err.message || String(err)
            }));
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
      console.error(`[SidePane] WebSocket error:`, error);
      addLog(id, "Connection to sidecar failed. Ensure sidecar is running on port 4000.");
      setNodeStatus(id, "error");
      const errorMsg = {
        role: "assistant" as const,
        content: "Connection failed. Please ensure the agent sidecar is running.",
        timestamp: new Date().toLocaleTimeString()
      };
      addGlobalChatMessage(id, errorMsg);
    };

    socket.onclose = () => {
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

      socket.send(JSON.stringify({
        type: "global_explore",
        nodeId: id,
        prompt: `Please summarize the following conversation concisely, highlighting the key insights, findings, and any important decisions or next steps mentioned:\n\n${conversationText}`,
        workspaceRoot: rootPath,
        model: useWorkspaceStore.getState().activeModel,
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
            socket.send(JSON.stringify({
              type: "read_file_response",
              requestId: msg.requestId,
              content: content as string
            }));
          }).catch((err: any) => {
            socket.send(JSON.stringify({
              type: "read_file_response",
              requestId: msg.requestId,
              error: err.message || String(err)
            }));
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

    socket.onerror = () => {
      addLog(id, "Connection to sidecar failed.");
      setNodeStatus(id, "error");
      setIsSummarizing(false);
    };

    socket.onclose = () => {
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
        <button
          onClick={onClose}
          className="text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors p-1 rounded-lg hover:bg-[var(--bg-sidebar)] cursor-pointer"
        >
          <X size={16} />
        </button>
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
                      className={`flex flex-col rounded-xl p-3 max-w-[85%] space-y-1 ${
                        msg.role === "user"
                          ? "bg-[var(--accent-bg)] border border-[var(--accent-color)]/30 ml-auto text-right"
                          : "bg-[var(--bg-sidebar)]/60 border border-[var(--border-color)]/80 self-start"
                      }`}
                    >
                      <span className={`font-mono text-[9px] uppercase font-bold ${
                        msg.role === "user" ? "text-[var(--accent-color)]" : "text-violet-400"
                      }`}>
                        {msg.role === "user" ? "You" : "Explorer"} · {msg.timestamp}
                      </span>
                      <span className="leading-relaxed whitespace-pre-wrap text-[var(--text-normal)] text-left">
                        {msg.role === "user" ? msg.content : formatMessageText(msg.content)}
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
                <div className="flex flex-col bg-[var(--bg-sidebar)]/60 border border-[var(--border-color)]/80 rounded-xl p-3 max-w-[85%] self-start space-y-1">
                  <span className="font-mono text-[9px] uppercase font-bold text-[var(--text-muted)]">System Agent</span>
                  <span className="leading-relaxed">
                    I will check the attached file inputs and execute your modifications. You can type instructions below to refine my work.
                  </span>
                </div>
                {chatMessage && nodeStatus === "success" && (
                  <div className="flex flex-col bg-[var(--accent-bg)] border border-[var(--accent-color)]/50 rounded-xl p-3 max-w-[85%] ml-auto space-y-1 text-right">
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
