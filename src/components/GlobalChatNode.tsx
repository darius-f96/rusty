import React, { useState, useRef, useEffect } from "react";
import { Globe, Pencil, Check, Trash2, Send, Loader2, Sparkles, X } from "lucide-react";
import { useWorkspaceStore, GlobalChatMessage } from "../store";

const EMPTY_ARRAY: GlobalChatMessage[] = [];

export const GlobalChatNode: React.FC<{ id: string; data: any }> = ({ id, data }) => {
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode);
  const deleteNode = useWorkspaceStore((state) => state.deleteNode);
  const globalContextSummary = useWorkspaceStore((state) => state.globalContextSummary);
  const setGlobalContextSummary = useWorkspaceStore((state) => state.setGlobalContextSummary);
  const addGlobalChatMessage = useWorkspaceStore((state) => state.addGlobalChatMessage);
  const rawHistory = useWorkspaceStore((state) => state.globalChatHistory[id]);
  const chatHistory = rawHistory || EMPTY_ARRAY;
  const nodeStatus = useWorkspaceStore((state) => state.nodeStatus[id] || "idle");
  const addLog = useWorkspaceStore((state) => state.addLog);
  const setNodeStatus = useWorkspaceStore((state) => state.setNodeStatus);

  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(data.name || "Global Explorer");
  const [chatInput, setChatInput] = useState("");
  const [isExpanded, setIsExpanded] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setTempName(data.name || "Global Explorer");
  }, [data.name]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  const handleNameSave = () => {
    updateNode(id, { name: tempName });
    setIsEditing(false);
  };

  const handleSendMessage = () => {
    if (!chatInput.trim() || nodeStatus === "running") return;

    const userMessage: GlobalChatMessage = {
      role: "user",
      content: chatInput.trim(),
      timestamp: new Date().toLocaleTimeString()
    };

    addGlobalChatMessage(id, userMessage);
    setChatInput("");
    setNodeStatus(id, "running");
    addLog(id, `User prompt: ${userMessage.content}`);

    // Connect to sidecar WebSocket for global exploration
    const socket = new WebSocket("ws://localhost:4000");
    socketRef.current = socket;

    socket.onopen = () => {
      addLog(id, "Connected to agent sidecar for global exploration...");

      const rootPath = useWorkspaceStore.getState().rootPath;
      const providers = useWorkspaceStore.getState().customProviders;
      const activeProviderId = useWorkspaceStore.getState().activeCustomProviderId;
      const provider = providers.find((p) => p.id === activeProviderId);

      socket.send(JSON.stringify({
        type: "global_explore",
        nodeId: id,
        prompt: userMessage.content,
        workspaceRoot: rootPath,
        model: useWorkspaceStore.getState().activeModel,
        chatHistory: chatHistory.map((m) => ({ role: m.role, content: m.content })),
        customProvider:
          provider && provider.id !== "anthropic" && provider.id !== "openai" ? provider : null,
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
          // Proxy read_file request through Tauri
          import("@tauri-apps/api/core").then(({ invoke }) => {
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
          });
          return;
        }

        if (msg.type === "list_files_response" || msg.type === "search_codebase_response") {
          // These are handled internally by the sidecar, nothing to do here
          return;
        }

        if (msg.type === "global_explore_complete" && msg.nodeId === id) {
          const assistantMsg: GlobalChatMessage = {
            role: "assistant",
            content: msg.response || "Exploration complete.",
            timestamp: new Date().toLocaleTimeString()
          };
          addGlobalChatMessage(id, assistantMsg);

          // If the agent produced a summary, store it as global context
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
          const errorMsg: GlobalChatMessage = {
            role: "assistant",
            content: `Error: ${msg.error}`,
            timestamp: new Date().toLocaleTimeString()
          };
          addGlobalChatMessage(id, errorMsg);
          setNodeStatus(id, "error");
          addLog(id, `Global exploration error: ${msg.error}`);
          socket.close();
        }
      } catch (err: any) {
        addLog(id, `Parse error: ${err.message}`);
      }
    };

    socket.onerror = () => {
      addLog(id, "Connection to sidecar failed. Ensure sidecar is running on port 4000.");
      setNodeStatus(id, "error");
      const errorMsg: GlobalChatMessage = {
        role: "assistant",
        content: "Connection failed. Please ensure the agent sidecar is running.",
        timestamp: new Date().toLocaleTimeString()
      };
      addGlobalChatMessage(id, errorMsg);
    };

    socket.onclose = () => {
      socketRef.current = null;
    };
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const statusBorder = {
    idle: "border-[var(--border-color)] hover:border-violet-500/50",
    running: "border-violet-500/70 shadow-[0_0_15px_rgba(139,92,246,0.2)] animate-pulse",
    success: "border-emerald-500/60 shadow-[0_0_10px_rgba(16,185,129,0.1)]",
    error: "border-rose-500/60 shadow-[0_0_10px_rgba(244,63,94,0.1)]"
  };

  return (
    <div className={`w-96 rounded-xl border bg-[var(--bg-sidebar)] text-[var(--text-normal)] overflow-hidden transition-all duration-300 shadow-xl ${statusBorder[nodeStatus]}`}>
      {/* Node Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-color)] bg-gradient-to-r from-violet-600/15 to-transparent px-3 py-2 select-none cursor-move">
        <div className="flex items-center space-x-2 flex-1 mr-2 min-w-0">
          <Globe size={14} className={`text-violet-400 flex-shrink-0 ${nodeStatus === "running" ? "animate-spin" : ""}`} />

          {isEditing ? (
            <input
              type="text"
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNameSave();
                if (e.key === "Escape") setIsEditing(false);
              }}
              className="nodrag bg-[var(--bg-app)] border border-[var(--border-color)] rounded px-1.5 py-0.5 font-sans text-xs text-[var(--text-light)] focus:outline-none focus:border-violet-400 w-full"
              autoFocus
            />
          ) : (
            <span className="font-sans text-xs font-semibold text-[var(--text-light)] truncate">{data.name || "Global Explorer"}</span>
          )}
        </div>

        <div className="flex items-center space-x-1.5 flex-shrink-0">
          {isEditing ? (
            <button
              onClick={handleNameSave}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag text-emerald-400 hover:text-emerald-300 p-0.5 rounded transition-colors"
            >
              <Check size={13} />
            </button>
          ) : (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(!isExpanded);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="nodrag text-[9px] font-sans text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer"
              >
                {isExpanded ? "[Collapse]" : "[Expand]"}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="nodrag text-[var(--text-muted)] hover:text-[var(--text-light)] p-0.5 rounded transition-colors"
                title="Rename node"
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); deleteNode(id); }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="nodrag text-[var(--text-muted)] hover:text-rose-400 p-0.5 rounded transition-colors"
                title="Delete node"
              >
                <Trash2 size={12} />
              </button>
            </>
          )}

          {/* Status indicator */}
          <div className="flex-shrink-0 pl-1">
            {nodeStatus === "running" && <Loader2 size={14} className="text-violet-400 animate-spin" />}
            {nodeStatus === "success" && <Sparkles size={14} className="text-emerald-400" />}
            {nodeStatus === "error" && <X size={14} className="text-rose-400" />}
          </div>
        </div>
      </div>

      {/* Node Content */}
      {isExpanded && (
        <div className="flex flex-col">
          {/* Chat History Window */}
          <div className="max-h-48 overflow-y-auto p-2 space-y-2 nodrag" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            {chatHistory.length === 0 ? (
              <div className="text-center text-[10px] font-sans text-[var(--text-muted)] py-4 select-none">
                <Globe size={20} className="mx-auto text-violet-400/50 mb-2" />
                Ask me to explore your codebase.<br />
                <span className="text-[9px]">I'll analyze patterns and generate guidelines for task nodes.</span>
              </div>
            ) : (
              chatHistory.map((msg, idx) => (
                <div
                  key={idx}
                  className={`text-[11px] font-sans leading-relaxed p-2 rounded-lg ${
                    msg.role === "user"
                      ? "bg-violet-500/10 border border-violet-500/20 text-[var(--text-light)] ml-4"
                      : "bg-[var(--bg-app)] border border-[var(--border-color)] text-[var(--text-normal)] mr-4"
                  }`}
                >
                  <div className="text-[8px] uppercase font-bold text-[var(--text-muted)] mb-0.5">
                    {msg.role === "user" ? "You" : "Explorer"} · {msg.timestamp}
                  </div>
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat Input */}
          <div className="border-t border-[var(--border-color)] p-2">
            <div className="flex items-center space-x-1.5">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                placeholder="Explore codebase..."
                disabled={nodeStatus === "running"}
                className="nodrag flex-1 bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg px-2.5 py-1.5 text-[11px] font-sans text-[var(--text-light)] placeholder-[var(--text-muted)] focus:outline-none focus:border-violet-400 disabled:opacity-50"
              />
              <button
                onClick={handleSendMessage}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                disabled={nodeStatus === "running" || !chatInput.trim()}
                className="nodrag bg-violet-500 hover:bg-violet-400 disabled:bg-[var(--bg-app)] disabled:text-[var(--text-muted)] text-white p-1.5 rounded-lg transition-all cursor-pointer"
              >
                {nodeStatus === "running" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              </button>
            </div>
          </div>

          {/* Global Context Summary Preview */}
          {globalContextSummary && (
            <div className="border-t border-[var(--border-color)] p-2">
              <div className="text-[9px] uppercase font-bold text-violet-400 font-sans mb-1">
                Active Global Context
              </div>
              <div className="text-[10px] font-sans text-[var(--text-muted)] max-h-16 overflow-y-auto leading-relaxed whitespace-pre-wrap bg-[var(--bg-app)]/50 rounded p-1.5 border border-[var(--border-color)]" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                {globalContextSummary.length > 200 ? globalContextSummary.slice(0, 200) + "..." : globalContextSummary}
              </div>
            </div>
          )}
        </div>
      )}

      {/* No handles — this is a standalone global node, not part of the pipeline graph */}
    </div>
  );
};
