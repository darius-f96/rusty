import React, { useState, useEffect } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { X, Terminal, MessageSquare, Code, Play, Sparkles } from "lucide-react";
import { useWorkspaceStore } from "../store";
import { invoke } from "@tauri-apps/api/core";

interface SidePaneProps {
  onClose: () => void;
  onExecuteNode: (nodeId: string) => void;
}

export const SidePane: React.FC<SidePaneProps> = ({ onClose, onExecuteNode }) => {
  const selectedNodeId = useWorkspaceStore((state) => state.selectedNodeId);
  const nodes = useWorkspaceStore((state) => state.nodes);
  const nodeLogs = useWorkspaceStore((state) => state.nodeLogs[selectedNodeId || ""] || []);
  const nodeStatus = useWorkspaceStore((state) => state.nodeStatus[selectedNodeId || ""] || "idle");

  const [activeTab, setActiveTab] = useState<"diff" | "chat" | "console">("diff");
  const [chatMessage, setChatMessage] = useState("");
  const [originalCode, setOriginalCode] = useState("// Loading original content...");
  const [modifiedCode, setModifiedCode] = useState("// Loading modified content...");

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const modifiedFiles = (selectedNode?.data?.modifiedFiles as string[]) || [];
  const [activeDiffFile, setActiveDiffFile] = useState<string>("");

  // Select which file should be shown in the diff viewer
  useEffect(() => {
    if (!selectedNode) return;
    if (selectedNode.type === "fileNode") {
      setActiveDiffFile(selectedNode.data.path as string);
    } else if (selectedNode.type === "taskNode") {
      if (modifiedFiles.length > 0) {
        if (!modifiedFiles.includes(activeDiffFile)) {
          setActiveDiffFile(modifiedFiles[0]);
        }
      } else {
        setActiveDiffFile("");
      }
    }
  }, [selectedNode, modifiedFiles]);

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
  }, [selectedNode, activeDiffFile, nodeStatus]);

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
    <div className="w-[500px] border-l border-zinc-800 bg-zinc-950/95 flex flex-col h-full text-zinc-300 font-sans shadow-2xl">
      {/* Pane Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/40">
        <div className="flex flex-col">
          <span className="font-mono text-xs text-zinc-500 uppercase tracking-wider">Inspector</span>
          <span className="font-semibold text-sm truncate max-w-[320px]">
            {selectedNode.type === "fileNode" ? (selectedNode.data as any).name : `Task Node (${selectedNode.id})`}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-200 transition-colors p-1 rounded-lg hover:bg-zinc-800"
        >
          <X size={16} />
        </button>
      </div>

      {/* Tabs Row */}
      <div className="flex border-b border-zinc-800 bg-zinc-900/10 text-xs font-mono">
        <button
          onClick={() => setActiveTab("diff")}
          className={`flex items-center space-x-1.5 px-4 py-2.5 border-b-2 transition-all ${
            activeTab === "diff"
              ? "border-indigo-500 text-white bg-indigo-500/5 font-semibold"
              : "border-transparent text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <Code size={14} />
          <span>VFS Diff</span>
        </button>
        {selectedNode.type === "taskNode" && (
          <>
            <button
              onClick={() => setActiveTab("chat")}
              className={`flex items-center space-x-1.5 px-4 py-2.5 border-b-2 transition-all ${
                activeTab === "chat"
                  ? "border-indigo-500 text-white bg-indigo-500/5 font-semibold"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <MessageSquare size={14} />
              <span>Prompt Chat</span>
            </button>
            <button
              onClick={() => setActiveTab("console")}
              className={`flex items-center space-x-1.5 px-4 py-2.5 border-b-2 transition-all relative ${
                activeTab === "console"
                  ? "border-indigo-500 text-white bg-indigo-500/5 font-semibold"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Terminal size={14} />
              <span>Console Stream</span>
              {nodeStatus === "running" && (
                <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
              )}
            </button>
          </>
        )}
      </div>

      {/* File Diff Dropdown Selector (only for TaskNode when files are edited) */}
      {selectedNode.type === "taskNode" && modifiedFiles.length > 0 && (
        <div className="px-4 py-2 border-b border-zinc-800 bg-[#111318] flex items-center justify-between text-xs font-mono">
          <span className="text-zinc-500">File Diff:</span>
          <select
            value={activeDiffFile}
            onChange={(e) => setActiveDiffFile(e.target.value)}
            className="bg-zinc-950 text-zinc-300 border border-zinc-800 rounded px-2.5 py-1 outline-none text-[11px] max-w-[300px] truncate focus:border-zinc-700 cursor-pointer"
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
      <div className="flex-1 overflow-hidden relative bg-zinc-950">
        {activeTab === "diff" && (
          activeDiffFile ? (
            <div className="w-full h-full">
              <DiffEditor
                height="100%"
                language={getEditorLanguage(activeDiffFile)}
                theme="vs-dark"
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
            <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-zinc-500 font-mono text-xs space-y-2">
              <span className="text-indigo-400 font-bold">// Sandbox VFS Standby</span>
              <span className="text-[11px] text-zinc-600 max-w-[280px]">
                No files modified by this task node yet. Connect a source File Node, type prompt instructions, and click "Run Executor".
              </span>
            </div>
          )
        )}

        {activeTab === "console" && (
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
          <div className="flex flex-col h-full bg-zinc-950">
            {/* Mocked conversation preview */}
            <div className="flex-1 p-4 space-y-4 overflow-y-auto text-xs">
              <div className="flex flex-col bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-3 max-w-[85%] self-start space-y-1">
                <span className="font-mono text-[9px] uppercase font-bold text-zinc-500">System Agent</span>
                <span className="leading-relaxed">
                  I will check the attached file inputs and execute your modifications. You can type instructions below to refine my work.
                </span>
              </div>
              {chatMessage && nodeStatus === "success" && (
                <div className="flex flex-col bg-indigo-950/20 border border-indigo-900/50 rounded-xl p-3 max-w-[85%] ml-auto space-y-1 text-right">
                  <span className="font-mono text-[9px] uppercase font-bold text-indigo-400">User</span>
                  <span className="leading-relaxed text-zinc-100">{chatMessage}</span>
                </div>
              )}
            </div>

            {/* Input prompt area */}
            <div className="p-3 border-t border-zinc-800 bg-zinc-900/20">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!chatMessage.trim()) return;
                  onExecuteNode(selectedNode.id);
                }}
                className="flex items-center space-x-2 bg-zinc-950 border border-zinc-800 p-1.5 rounded-lg focus-within:border-zinc-700"
              >
                <input
                  type="text"
                  placeholder="e.g. Refactor this helper into a separate hook..."
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  className="flex-1 bg-transparent border-none outline-none text-xs px-2 py-1 focus:ring-0"
                />
                <button
                  type="submit"
                  disabled={nodeStatus === "running"}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-xs font-mono font-bold px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-all glow-btn"
                >
                  <Play size={12} />
                  <span>Prompt</span>
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Footer controls for executing node */}
      {selectedNode.type === "taskNode" && activeTab !== "chat" && (
        <div className="p-3 border-t border-zinc-800 bg-zinc-900/20 flex items-center justify-between">
          <span className="text-[10px] uppercase font-mono text-zinc-500">
            Status: <span className="font-bold text-zinc-300">{nodeStatus}</span>
          </span>
          <button
            onClick={() => onExecuteNode(selectedNode.id)}
            disabled={nodeStatus === "running"}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-xs font-mono font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all glow-btn shadow-md"
          >
            <Sparkles size={14} className={nodeStatus === "running" ? "animate-spin" : ""} />
            <span>{nodeStatus === "running" ? "Running..." : "Run Executor"}</span>
          </button>
        </div>
      )}
    </div>
  );
};
