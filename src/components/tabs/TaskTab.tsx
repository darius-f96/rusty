import React, { useState, useEffect, useRef } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { Terminal, MessageSquare, Code, Play, Sparkles } from "lucide-react";
import { useWorkspaceStore } from "../../store";
import { invoke } from "@tauri-apps/api/core";
import { getFileTypeDetails } from "../../services/fileTypeService";
import { processResponse } from "../../services/responseProcessingService";

const EMPTY_ARRAY: any[] = [];

interface TaskTabProps {
  tab: any;
  onExecuteNode: (nodeId: string, customPrompt?: string) => void;
  groupId: string;
}

export const TaskTab: React.FC<TaskTabProps> = ({ tab, onExecuteNode, groupId }) => {
  const nodes = useWorkspaceStore((state) => state.nodes);
  const editorGroups = useWorkspaceStore((state) => state.editorGroups);
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const updateTaskNode = useWorkspaceStore((state) => state.updateTaskNode);
  const chatHistory = useWorkspaceStore((state) => state.globalChatHistory[taskNodeId] || EMPTY_ARRAY);
  
  const targetGroup = editorGroups.find((g) => g.id === groupId);
  const isActive = targetGroup ? targetGroup.activeTabId === tab.id : false;

  const taskNodeId = tab.key;
  const taskNode = nodes.find((n) => n.id === taskNodeId);
  const rawNodeLogs = useWorkspaceStore((state) => state.nodeLogs[taskNodeId]);
  const nodeLogs = rawNodeLogs || EMPTY_ARRAY;
  const nodeStatus = useWorkspaceStore((state) => state.nodeStatus[taskNodeId] || "idle");

  const [taskSubTab, setTaskSubTab] = useState<"diff" | "chat" | "console">("diff");
  const [chatMessage, setChatMessage] = useState("");
  const [originalCode, setOriginalCode] = useState("// Loading original content...");
  const [modifiedCode, setModifiedCode] = useState("// Loading modified content...");
  const [loadingDiff, setLoadingDiff] = useState(false);

  const modifiedFiles = (taskNode?.data?.modifiedFiles as string[]) || EMPTY_ARRAY;
  const [activeDiffFile, setActiveDiffFile] = useState<string>("");

  const diffEditorRef = useRef<any>(null);

  // Set active diff file automatically if modified files exist
  useEffect(() => {
    if (modifiedFiles.length > 0) {
      if (!modifiedFiles.includes(activeDiffFile)) {
        setActiveDiffFile(modifiedFiles[0]);
      }
    } else {
      setActiveDiffFile("");
    }
  }, [modifiedFiles, activeDiffFile]);

  // Load file content diffs
  useEffect(() => {
    if (!activeDiffFile) return;

    const fetchDiffContent = async () => {
      setLoadingDiff(true);
      try {
        console.log(`TaskTab loading diff for: ${activeDiffFile}`);
        const modified: string = await invoke("read_file_vfs", { path: activeDiffFile });
        
        let original = "";
        try {
          original = await invoke("read_file_disk", { path: activeDiffFile });
        } catch (e) {
          original = "";
        }

        setOriginalCode(original);
        setModifiedCode(modified);
      } catch (err: any) {
        console.error("TaskTab failed to load diff:", err);
        setOriginalCode(`// Error reading file: ${err.message}`);
        setModifiedCode(`// Error reading file: ${err.message}`);
      } finally {
        setLoadingDiff(false);
      }
    };

    fetchDiffContent();
  }, [activeDiffFile, nodeStatus]);

  // Adjust editor size when active state changes
  useEffect(() => {
    if (isActive && diffEditorRef.current && taskSubTab === "diff") {
      setTimeout(() => {
        if (diffEditorRef.current) {
          diffEditorRef.current.layout();
        }
      }, 50);
    }
  }, [isActive, taskSubTab]);

  const handleEditorMount = (editor: any) => {
    diffEditorRef.current = editor;
    setTimeout(() => {
      editor.layout();
    }, 50);
  };

  const getEditorLanguage = (filePath: string): string => {
    return getFileTypeDetails(filePath).language;
  };

  if (!taskNode) {
    return (
      <div className="w-full h-full flex items-center justify-center font-mono text-xs text-[var(--text-muted)] bg-[var(--bg-app)]">
        <span>Task Node not found.</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-[var(--bg-app)] flex flex-col text-[var(--text-normal)] font-sans relative">
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Task Sub Tabs Row */}
        <div className="flex border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/50 text-xs font-mono justify-between items-center pr-3 select-none flex-shrink-0">
          <div className="flex">
            <button
              onClick={() => setTaskSubTab("diff")}
              className={`flex items-center space-x-1.5 px-4 py-2 border-b-2 transition-all ${
                taskSubTab === "diff"
                  ? "border-[var(--accent-color)] text-[var(--text-light)] bg-[var(--accent-bg)] font-semibold"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-light)]"
              }`}
            >
              <Code size={14} />
              <span>VFS Diff</span>
            </button>
            <button
              onClick={() => setTaskSubTab("chat")}
              className={`flex items-center space-x-1.5 px-4 py-2 border-b-2 transition-all ${
                taskSubTab === "chat"
                  ? "border-[var(--accent-color)] text-[var(--text-light)] bg-[var(--accent-bg)] font-semibold"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-light)]"
              }`}
            >
              <MessageSquare size={14} />
              <span>Prompt Chat</span>
            </button>
            <button
              onClick={() => setTaskSubTab("console")}
              className={`flex items-center space-x-1.5 px-4 py-2 border-b-2 transition-all relative ${
                taskSubTab === "console"
                  ? "border-[var(--accent-color)] text-[var(--text-light)] bg-[var(--accent-bg)] font-semibold"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-light)]"
              }`}
            >
              <Terminal size={14} />
              <span>Console Stream</span>
              {nodeStatus === "running" && (
                <span className="absolute top-2.5 right-2 w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] animate-ping" />
              )}
            </button>
          </div>

          {/* Model Selector Dropdown */}
          <div className="flex items-center space-x-2 py-1">
            <span className="text-[10px] text-[var(--text-muted)] font-sans uppercase font-semibold">Model:</span>
            <select
              value={(taskNode.data as any).model || activeModel}
              onChange={(e) => updateTaskNode(taskNodeId, { model: e.target.value })}
              className="bg-[var(--bg-app)] text-[var(--text-normal)] border border-[var(--border-color)] rounded px-2.5 py-1 outline-none text-[11px] max-w-[200px] focus:border-[var(--border-active)] cursor-pointer"
            >
              {customProviders.flatMap((p) => p.models).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.id})
                </option>
              ))}
              {customProviders.flatMap((p) => p.models).length === 0 && (
                <option value="">No models configured</option>
              )}
            </select>
          </div>
        </div>

        {/* Task Diff Selector Dropdown */}
        {taskSubTab === "diff" && modifiedFiles.length > 0 && (
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

        {/* Task Sub Tab Content */}
        <div className="flex-1 overflow-hidden relative bg-[var(--bg-app)]">
          {taskSubTab === "diff" && (
            activeDiffFile ? (
              <div className="w-full h-full relative bg-[var(--bg-app)]">
                {loadingDiff ? (
                  <div className="w-full h-full flex items-center justify-center font-mono text-xs text-[var(--text-muted)]">
                    <span>Loading diff view...</span>
                  </div>
                ) : (
                  <DiffEditor
                    height="100%"
                    language={getEditorLanguage(activeDiffFile)}
                    theme="axiom-custom-theme"
                    original={originalCode}
                    modified={modifiedCode}
                    onMount={handleEditorMount}
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      lineNumbers: "on",
                      renderSideBySide: true,
                      fontSize: 11,
                    }}
                  />
                )}
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-[var(--text-muted)] font-mono text-xs space-y-2 select-none">
                <span className="text-[var(--accent-color)] font-bold">// Sandbox VFS Standby</span>
                <span className="text-[11px] text-[var(--text-muted)] max-w-[280px]">
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
            <div className="flex flex-col h-full bg-[var(--bg-app)]">
              <div className="flex-1 p-4 space-y-4 overflow-y-auto text-xs">
                <div className="flex flex-col bg-[var(--bg-sidebar)]/60 border border-[var(--border-color)]/80 rounded-xl p-3 w-full space-y-1 text-left">
                  <span className="font-mono text-[9px] uppercase font-bold text-violet-400">System Agent</span>
                  <div className="leading-relaxed text-[var(--text-normal)]">
                    I will check the attached file inputs and execute your modifications. You can type instructions below to refine my work.
                  </div>
                </div>

                {chatHistory.map((msg: any, idx: number) => {
                  // Skip the first long prompt context block to keep chat history view clean
                  if (idx === 0 && msg.role === "user") return null;

                  return (
                    <div
                      key={idx}
                      className={`flex flex-col rounded-xl p-3 border space-y-1 w-full ${
                        msg.role === "user"
                          ? "bg-[var(--accent-bg)]/20 border-[var(--accent-color)]/30 text-left text-[var(--text-light)]"
                          : "bg-[var(--bg-sidebar)]/60 border border-[var(--border-color)]/80 text-left"
                      }`}
                    >
                      <span className={`font-mono text-[9px] uppercase font-bold ${
                        msg.role === "user" ? "text-[var(--accent-color)]" : "text-violet-400"
                      }`}>
                        {msg.role === "user" ? "User" : "System Agent"} · {msg.timestamp}
                      </span>
                      <div className="leading-relaxed text-[var(--text-normal)]">
                        {msg.role === "user" ? msg.content : processResponse(msg.content)}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!chatMessage.trim() || nodeStatus === "running") return;
                    onExecuteNode(taskNodeId, chatMessage);
                    setChatMessage("");
                  }}
                  className="flex items-center space-x-2 bg-[var(--bg-app)] border border-[var(--border-color)] p-1.5 rounded-lg focus-within:border-[var(--border-active)]"
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
                    className="bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] text-white text-xs font-mono font-bold px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-all glow-btn cursor-pointer"
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
          <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 flex items-center justify-between select-none flex-shrink-0">
            <span className="text-[10px] uppercase font-mono text-[var(--text-muted)]">
              Status: <span className="font-bold text-[var(--text-normal)]">{nodeStatus}</span>
            </span>
            <button
              onClick={() => onExecuteNode(taskNodeId)}
              disabled={nodeStatus === "running"}
              className="bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] text-white text-xs font-mono font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all glow-btn shadow-md cursor-pointer"
            >
              <Sparkles size={14} className={nodeStatus === "running" ? "animate-spin" : ""} />
              <span>{nodeStatus === "running" ? "Running..." : "Run Executor"}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
