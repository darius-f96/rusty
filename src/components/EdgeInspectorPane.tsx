import React, { useState, useRef, useEffect } from "react";
import { X, AlertTriangle, CheckCircle2, MessageSquare, Send, Loader2, Code } from "lucide-react";
import { useWorkspaceStore } from "../store";
import { invoke } from "@tauri-apps/api/core";
import { DiffEditor } from "@monaco-editor/react";

interface EdgeInspectorPaneProps {
  onClose: () => void;
}

export const EdgeInspectorPane: React.FC<EdgeInspectorPaneProps> = ({ onClose }) => {
  const selectedEdgeId = useWorkspaceStore((state) => state.selectedEdgeId);
  const edges = useWorkspaceStore((state) => state.edges);
  const nodes = useWorkspaceStore((state) => state.nodes);
  const setEdgeStatus = useWorkspaceStore((state) => state.setEdgeStatus);
  const setSelectedEdgeId = useWorkspaceStore((state) => state.setSelectedEdgeId);
  const edgeStatus = useWorkspaceStore(
    (state) => state.edgeReconciliationStatus[selectedEdgeId || ""] || "idle"
  );

  const [activeTab, setActiveTab] = useState<"conflicts" | "chat" | "diff">("conflicts");
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [conflictDetails, setConflictDetails] = useState<string>("");
  const [originalCode, setOriginalCode] = useState("// No conflict data loaded");
  const [modifiedCode, setModifiedCode] = useState("// No conflict data loaded");
  const [diffFile, setDiffFile] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const edge = edges.find((e) => e.id === selectedEdgeId);
  const sourceNode = edge ? nodes.find((n) => n.id === edge.source) : null;
  const targetNode = edge ? nodes.find((n) => n.id === edge.target) : null;

  const sourceModifiedFiles = (sourceNode?.data?.modifiedFiles as string[]) || [];

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Load conflict details when edge is selected
  useEffect(() => {
    if (!edge || !sourceNode || !targetNode) return;

    const sourceName = (sourceNode.data as any).name || sourceNode.id;
    const targetName = (targetNode.data as any).name || targetNode.id;
    const files = sourceModifiedFiles.join(", ") || "none";

    setConflictDetails(
      `Source: ${sourceName}\nTarget: ${targetName}\nModified files: ${files}\n\nThe reconciliation engine detected potential conflicts between the output of the source task and the specifications of the target task.`
    );

    // Set initial chat context
    setChatMessages([
      {
        role: "system",
        content: `I'm analyzing the connection between "${sourceName}" → "${targetName}". The source task modified: ${files}. I'll help resolve any conflicts between these changes and the target task's requirements.`,
      },
    ]);

    // Load diff for first modified file
    if (sourceModifiedFiles.length > 0) {
      setDiffFile(sourceModifiedFiles[0]);
      loadDiffContent(sourceModifiedFiles[0]);
    }
  }, [selectedEdgeId]);

  const loadDiffContent = async (filePath: string) => {
    try {
      const modified: string = await invoke("read_file_vfs", { path: filePath });
      let original = "";
      try {
        original = await invoke("read_file_disk", { path: filePath });
      } catch {
        original = "";
      }
      setOriginalCode(original);
      setModifiedCode(modified);
    } catch (e: any) {
      setOriginalCode(`// Error: ${e.message}`);
      setModifiedCode(`// Error: ${e.message}`);
    }
  };

  const handleSendChat = () => {
    if (!chatInput.trim() || isResolving) return;

    const userMsg = { role: "user", content: chatInput.trim() };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setIsResolving(true);

    // Connect to sidecar for reconciliation chat
    const socket = new WebSocket("ws://localhost:4000");

    socket.onopen = () => {
      const rootPath = useWorkspaceStore.getState().rootPath;
      const providers = useWorkspaceStore.getState().customProviders;
      const activeProviderId = useWorkspaceStore.getState().activeCustomProviderId;
      const provider = providers.find((p) => p.id === activeProviderId);

      socket.send(
        JSON.stringify({
          type: "reconciliate_edge",
          edgeId: selectedEdgeId,
          sourceTaskId: sourceNode?.id,
          targetTaskId: targetNode?.id,
          modifiedFiles: sourceModifiedFiles,
          userMessage: userMsg.content,
          chatHistory: chatMessages.map((m) => ({ role: m.role, content: m.content })),
          workspaceRoot: rootPath,
          model: useWorkspaceStore.getState().activeModel,
          sourcePrompt: (sourceNode?.data as any)?.prompt || "",
          targetPrompt: (targetNode?.data as any)?.prompt || "",
          customProvider:
            provider &&
            (provider.id !== "anthropic" && provider.id !== "openai" || !!provider.apiKey)
              ? provider
              : null,
        })
      );
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "read_file") {
          invoke("read_file_vfs", { path: msg.path })
            .then((content: any) => {
              socket.send(
                JSON.stringify({
                  type: "read_file_response",
                  requestId: msg.requestId,
                  content,
                })
              );
            })
            .catch((err: any) => {
              socket.send(
                JSON.stringify({
                  type: "read_file_response",
                  requestId: msg.requestId,
                  error: err.message || String(err),
                })
              );
            });
          return;
        }

        if (msg.type === "write_file") {
          invoke("write_file_vfs", { path: msg.path, content: msg.content })
            .then(() => {
              socket.send(
                JSON.stringify({ type: "write_file_response", requestId: msg.requestId })
              );
            })
            .catch((err: any) => {
              socket.send(
                JSON.stringify({
                  type: "write_file_response",
                  requestId: msg.requestId,
                  error: err.message || String(err),
                })
              );
            });
          return;
        }

        if (msg.type === "reconciliation_complete") {
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: msg.response || "Analysis complete." },
          ]);
          setIsResolving(false);
          // Reload diff if files were modified
          if (diffFile) loadDiffContent(diffFile);
          socket.close();
        }

        if (msg.type === "reconciliation_error") {
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Error: ${msg.error}` },
          ]);
          setIsResolving(false);
          socket.close();
        }
      } catch (err: any) {
        console.error("EdgeInspector parse error:", err);
      }
    };

    socket.onerror = () => {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Failed to connect to sidecar." },
      ]);
      setIsResolving(false);
    };
  };

  const handleApproveReconciliation = () => {
    if (selectedEdgeId) {
      setEdgeStatus(selectedEdgeId, "reconciled");
      setSelectedEdgeId(null);
      onClose();
    }
  };

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
      default:
        return "plaintext";
    }
  };

  if (!edge || !sourceNode || !targetNode) return null;

  return (
    <div className="w-[500px] border-l border-[var(--border-color)] bg-[var(--bg-app)]/95 flex flex-col h-full text-[var(--text-normal)] font-sans shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] bg-gradient-to-r from-rose-500/10 to-transparent">
        <div className="flex flex-col">
          <span className="font-mono text-xs text-rose-400 uppercase tracking-wider flex items-center space-x-1.5">
            <AlertTriangle size={12} />
            <span>Edge Inspector</span>
          </span>
          <span className="font-semibold text-sm truncate max-w-[320px]">
            {(sourceNode.data as any).name || sourceNode.id} → {(targetNode.data as any).name || targetNode.id}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors p-1 rounded-lg hover:bg-[var(--bg-sidebar)]"
        >
          <X size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/10 text-xs font-mono">
        <button
          onClick={() => setActiveTab("conflicts")}
          className={`flex items-center space-x-1.5 px-4 py-2.5 border-b-2 transition-all ${
            activeTab === "conflicts"
              ? "border-rose-400 text-[var(--text-light)] bg-rose-500/5 font-semibold"
              : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-light)]"
          }`}
        >
          <AlertTriangle size={14} />
          <span>Conflicts</span>
        </button>
        <button
          onClick={() => setActiveTab("diff")}
          className={`flex items-center space-x-1.5 px-4 py-2.5 border-b-2 transition-all ${
            activeTab === "diff"
              ? "border-rose-400 text-[var(--text-light)] bg-rose-500/5 font-semibold"
              : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-light)]"
          }`}
        >
          <Code size={14} />
          <span>Diff View</span>
        </button>
        <button
          onClick={() => setActiveTab("chat")}
          className={`flex items-center space-x-1.5 px-4 py-2.5 border-b-2 transition-all ${
            activeTab === "chat"
              ? "border-rose-400 text-[var(--text-light)] bg-rose-500/5 font-semibold"
              : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-light)]"
          }`}
        >
          <MessageSquare size={14} />
          <span>Resolve Chat</span>
        </button>
      </div>

      {/* File selector for diff */}
      {activeTab === "diff" && sourceModifiedFiles.length > 0 && (
        <div className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] flex items-center justify-between text-xs font-mono">
          <span className="text-[var(--text-muted)]">File:</span>
          <select
            value={diffFile}
            onChange={(e) => {
              setDiffFile(e.target.value);
              loadDiffContent(e.target.value);
            }}
            className="bg-[var(--bg-app)] text-[var(--text-normal)] border border-[var(--border-color)] rounded px-2.5 py-1 outline-none text-[11px] max-w-[300px] truncate focus:border-rose-400 cursor-pointer"
          >
            {sourceModifiedFiles.map((file) => (
              <option key={file} value={file}>
                {file.split("/").pop() || file}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden relative bg-[var(--bg-app)]">
        {activeTab === "conflicts" && (
          <div className="p-4 space-y-4 overflow-y-auto h-full">
            <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-4">
              <div className="text-[10px] uppercase font-bold text-rose-400 font-mono mb-2">
                Conflict Analysis
              </div>
              <pre className="text-xs font-sans text-[var(--text-normal)] whitespace-pre-wrap leading-relaxed">
                {conflictDetails}
              </pre>
            </div>

            <div className="text-[10px] text-[var(--text-muted)] font-sans">
              <strong>How to resolve:</strong> Use the "Resolve Chat" tab to ask the AI to analyze and fix conflicts, or review the "Diff View" to manually check changes. Once satisfied, click "Approve Reconciliation" below.
            </div>
          </div>
        )}

        {activeTab === "diff" && (
          diffFile ? (
            <div className="w-full h-full">
              <DiffEditor
                height="100%"
                language={getEditorLanguage(diffFile)}
                theme="axiom-custom-theme"
                original={originalCode}
                modified={modifiedCode}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  lineNumbers: "on",
                  renderSideBySide: true,
                  fontSize: 11,
                }}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-xs font-mono">
              No modified files to display.
            </div>
          )
        )}

        {activeTab === "chat" && (
          <div className="flex flex-col h-full">
            <div className="flex-1 p-4 space-y-3 overflow-y-auto text-xs">
              {chatMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex flex-col rounded-xl p-3 max-w-[90%] space-y-1 ${
                    msg.role === "user"
                      ? "bg-rose-500/10 border border-rose-500/20 ml-auto text-right"
                      : "bg-[var(--bg-sidebar)]/60 border border-[var(--border-color)]/80 self-start"
                  }`}
                >
                  <span className="font-mono text-[9px] uppercase font-bold text-[var(--text-muted)]">
                    {msg.role === "user" ? "You" : msg.role === "system" ? "System" : "Resolver"}
                  </span>
                  <span className="leading-relaxed whitespace-pre-wrap">{msg.content}</span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendChat();
                }}
                className="flex items-center space-x-2 bg-[var(--bg-app)] border border-[var(--border-color)] p-1.5 rounded-lg focus-within:border-rose-400"
              >
                <input
                  type="text"
                  placeholder="Describe how to resolve this conflict..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={isResolving}
                  className="flex-1 bg-transparent border-none outline-none text-xs px-2 py-1 focus:ring-0 text-[var(--text-normal)]"
                />
                <button
                  type="submit"
                  disabled={isResolving || !chatInput.trim()}
                  className="bg-rose-500 hover:bg-rose-400 disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] text-white text-xs font-mono font-bold px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-all cursor-pointer"
                >
                  {isResolving ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  <span>Send</span>
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Footer — Approve Reconciliation */}
      <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 flex items-center justify-between">
        <span className="text-[10px] uppercase font-mono text-[var(--text-muted)]">
          Status:{" "}
          <span
            className={`font-bold ${
              edgeStatus === "reconciled"
                ? "text-emerald-400"
                : edgeStatus === "unreconciled"
                ? "text-rose-400"
                : "text-[var(--text-normal)]"
            }`}
          >
            {edgeStatus}
          </span>
        </span>
        <button
          onClick={handleApproveReconciliation}
          className="bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-mono font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all shadow-md cursor-pointer"
        >
          <CheckCircle2 size={14} />
          <span>Approve Reconciliation</span>
        </button>
      </div>
    </div>
  );
};
