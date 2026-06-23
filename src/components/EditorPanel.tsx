import React, { useState, useEffect, useRef } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import { Terminal, MessageSquare, Code, Play, Sparkles } from "lucide-react";
import { useWorkspaceStore } from "../store";
import { invoke } from "@tauri-apps/api/core";

const EMPTY_ARRAY: any[] = [];

interface EditorPanelProps {
  activeTab: any;
  onExecuteNode: (nodeId: string) => void;
}

export const EditorPanel: React.FC<EditorPanelProps> = ({ activeTab, onExecuteNode }) => {
  const nodes = useWorkspaceStore((state) => state.nodes);
  const openTabs = useWorkspaceStore((state) => state.openTabs);

  // --- 1. File Tab Writable Editor Logic ---
  const [fileContent, setFileContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const saveTimeoutRef = useRef<any>(null);

  useEffect(() => {
    if (!activeTab || activeTab.type !== "file") return;

    const fetchFileContent = async () => {
      try {
        console.log(`EditorPanel [FileTab] reading VFS path: ${activeTab.key}`);
        const content: string = await invoke("read_file_vfs", { path: activeTab.key });
        setFileContent(content);
      } catch (err: any) {
        console.error("EditorPanel [FileTab] failed to read VFS:", err);
        setFileContent(`// Error reading file: ${err.message}`);
      }
    };

    fetchFileContent();

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [activeTab?.key, activeTab?.type]);

  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined || !activeTab) return;
    setFileContent(value);
    setIsSaving(true);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await invoke("write_file_vfs", { path: activeTab.key, content: value });
        console.log(`EditorPanel [FileTab] auto-saved VFS content: ${activeTab.title}`);
      } catch (err) {
        console.error("EditorPanel [FileTab] auto-save failed:", err);
      } finally {
        setIsSaving(false);
      }
    }, 500);
  };

  // --- 2. Task Tab Diff & Inspector Logic ---
  const taskNodeId = activeTab?.type === "task" ? activeTab.key : "";
  const taskNode = nodes.find((n) => n.id === taskNodeId);
  const rawNodeLogs = useWorkspaceStore((state) => state.nodeLogs[taskNodeId]);
  const nodeLogs = rawNodeLogs || EMPTY_ARRAY;
  const nodeStatus = useWorkspaceStore((state) => state.nodeStatus[taskNodeId] || "idle");

  const [taskSubTab, setTaskSubTab] = useState<"diff" | "chat" | "console">("diff");
  const [chatMessage, setChatMessage] = useState("");
  const [originalCode, setOriginalCode] = useState("// Loading original content...");
  const [modifiedCode, setModifiedCode] = useState("// Loading modified content...");

  const modifiedFiles = (taskNode?.data?.modifiedFiles as string[]) || EMPTY_ARRAY;
  const [activeDiffFile, setActiveDiffFile] = useState<string>("");

  // Determine active diff file for task tabs
  useEffect(() => {
    if (activeTab?.type !== "task" || !taskNode) return;
    if (modifiedFiles.length > 0) {
      if (!modifiedFiles.includes(activeDiffFile)) {
        setActiveDiffFile(modifiedFiles[0]);
      }
    } else {
      if (activeDiffFile !== "") {
        setActiveDiffFile("");
      }
    }
  }, [activeTab?.id, taskNode, modifiedFiles, activeDiffFile]);

  // Load physical vs VFS content for task node diff
  useEffect(() => {
    let active = true;
    if (activeTab?.type !== "task" || !activeDiffFile) return;

    const fetchDiffContent = async () => {
      try {
        console.log(`EditorPanel [TaskTab] loading diff for: ${activeDiffFile}`);
        const modified: string = await invoke("read_file_vfs", { path: activeDiffFile });
        
        let original = "";
        try {
          original = await invoke("read_file_disk", { path: activeDiffFile });
        } catch (e) {
          original = "";
        }

        if (active) {
          setOriginalCode(original);
          setModifiedCode(modified);
        }
      } catch (err: any) {
        console.error("EditorPanel [TaskTab] failed to load diff:", err);
        if (active) {
          setOriginalCode(`// Error reading file: ${err.message}`);
          setModifiedCode(`// Error reading file: ${err.message}`);
        }
      }
    };

    fetchDiffContent();
    return () => {
      active = false;
    };
  }, [activeTab?.id, activeDiffFile, nodeStatus]);

  if (openTabs.length === 0 || !activeTab) return null;

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
    <div className="w-full h-full bg-[#0d0e12] flex flex-col text-zinc-300 font-sans relative">
      {/* Tab Content View */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* FILE TAB VIEW */}
        {activeTab.type === "file" && (
          <div className="flex-1 flex flex-col overflow-hidden relative">
            <div className="px-4 py-2 border-b border-zinc-850 bg-zinc-950/30 text-[10px] font-mono text-zinc-500 flex justify-between items-center select-none">
              <span className="truncate">VFS Sandbox Path: {activeTab.key}</span>
              {isSaving ? (
                <span className="text-indigo-400 font-bold animate-pulse">Saving changes...</span>
              ) : (
                <span className="text-emerald-500">Changes buffered in VFS</span>
              )}
            </div>
            <div className="flex-1 w-full h-full relative">
              <Editor
                height="100%"
                language={getEditorLanguage(activeTab.key)}
                theme="vs-dark"
                value={fileContent}
                onChange={handleEditorChange}
                options={{
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  lineNumbers: "on",
                  fontSize: 12,
                  tabSize: 2
                }}
              />
            </div>
          </div>
        )}

        {/* TASK TAB VIEW */}
        {activeTab.type === "task" && taskNode && (
          <div className="flex-1 flex flex-col overflow-hidden relative">
            {/* Task Sub Tabs Row */}
            <div className="flex border-b border-zinc-850 bg-[#111318]/50 text-xs font-mono">
              <button
                onClick={() => setTaskSubTab("diff")}
                className={`flex items-center space-x-1.5 px-4 py-2 border-b-2 transition-all ${
                  taskSubTab === "diff"
                    ? "border-indigo-500 text-white bg-indigo-500/5 font-semibold"
                    : "border-transparent text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <Code size={14} />
                <span>VFS Diff</span>
              </button>
              <button
                onClick={() => setTaskSubTab("chat")}
                className={`flex items-center space-x-1.5 px-4 py-2 border-b-2 transition-all ${
                  taskSubTab === "chat"
                    ? "border-indigo-500 text-white bg-indigo-500/5 font-semibold"
                    : "border-transparent text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <MessageSquare size={14} />
                <span>Prompt Chat</span>
              </button>
              <button
                onClick={() => setTaskSubTab("console")}
                className={`flex items-center space-x-1.5 px-4 py-2 border-b-2 transition-all relative ${
                  taskSubTab === "console"
                    ? "border-indigo-500 text-white bg-indigo-500/5 font-semibold"
                    : "border-transparent text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <Terminal size={14} />
                <span>Console Stream</span>
                {nodeStatus === "running" && (
                  <span className="absolute top-2.5 right-2 w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
                )}
              </button>
            </div>

            {/* Task Diff Selector Dropdown */}
            {taskSubTab === "diff" && modifiedFiles.length > 0 && (
              <div className="px-4 py-2 border-b border-zinc-850 bg-[#111318] flex items-center justify-between text-xs font-mono">
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

            {/* Task Sub Tab Content */}
            <div className="flex-1 overflow-hidden relative bg-zinc-950">
              {taskSubTab === "diff" && (
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
                  <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-zinc-500 font-mono text-xs space-y-2 select-none">
                    <span className="text-indigo-400 font-bold">// Sandbox VFS Standby</span>
                    <span className="text-[11px] text-zinc-600 max-w-[280px]">
                      No files modified by this task node yet. Connect a source File Node, type prompt instructions, and click "Run Executor".
                    </span>
                  </div>
                )
              )}

              {taskSubTab === "console" && (
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

              {taskSubTab === "chat" && (
                <div className="flex flex-col h-full bg-zinc-950">
                  <div className="flex-1 p-4 space-y-4 overflow-y-auto text-xs">
                    <div className="flex flex-col bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-3 max-w-[85%] self-start space-y-1">
                      <span className="font-mono text-[9px] uppercase font-bold text-zinc-500">System Agent</span>
                      <span className="leading-relaxed">
                        I will check the attached file inputs and execute your modifications. You can type instructions below to refine my work.
                      </span>
                    </div>
                    {chatMessage && nodeStatus === "success" && (
                      <div className="flex flex-col bg-indigo-950/20 border border-indigo-900/50 rounded-xl p-3 max-w-[85%] ml-auto space-y-1 text-right text-zinc-100">
                        <span className="font-mono text-[9px] uppercase font-bold text-indigo-400">User</span>
                        <span className="leading-relaxed">{chatMessage}</span>
                      </div>
                    )}
                  </div>

                  <div className="p-3 border-t border-zinc-800 bg-zinc-900/20">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!chatMessage.trim()) return;
                        onExecuteNode(taskNodeId);
                      }}
                      className="flex items-center space-x-2 bg-zinc-950 border border-zinc-800 p-1.5 rounded-lg focus-within:border-zinc-700"
                    >
                      <input
                        type="text"
                        placeholder="e.g. Refactor this helper into a separate hook..."
                        value={chatMessage}
                        onChange={(e) => setChatMessage(e.target.value)}
                        className="flex-1 bg-transparent border-none outline-none text-xs px-2 py-1 focus:ring-0 text-zinc-200"
                      />
                      <button
                        type="submit"
                        disabled={nodeStatus === "running"}
                        className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-xs font-mono font-bold px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-all glow-btn cursor-pointer"
                      >
                        <Play size={12} />
                        <span>Prompt</span>
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>

            {/* Task Executive Footer Controls */}
            {taskSubTab !== "chat" && (
              <div className="p-3 border-t border-zinc-800 bg-zinc-900/20 flex items-center justify-between select-none">
                <span className="text-[10px] uppercase font-mono text-zinc-500">
                  Status: <span className="font-bold text-zinc-300">{nodeStatus}</span>
                </span>
                <button
                  onClick={() => onExecuteNode(taskNodeId)}
                  disabled={nodeStatus === "running"}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-xs font-mono font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all glow-btn shadow-md cursor-pointer"
                >
                  <Sparkles size={14} className={nodeStatus === "running" ? "animate-spin" : ""} />
                  <span>{nodeStatus === "running" ? "Running..." : "Run Executor"}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
