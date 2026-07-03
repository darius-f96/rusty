import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { Terminal, MessageSquare, Code, Sparkles, Save, RotateCcw, Octagon } from "lucide-react";
import { useWorkspaceStore } from "../../store";
import { CustomSelect } from "../CustomSelect";
import { invoke } from "@tauri-apps/api/core";
import { getFileTypeDetails } from "../../services/fileTypeService";
import { useDiffViewMode } from "../../hooks/useDiffViewMode";
import { DiffViewToggle } from "../ui/DiffViewToggle";
import { Chat } from "../ui/Chat";
import { ChatInput } from "../ui/ChatInput";

const EMPTY_ARRAY: any[] = [];

interface TaskTabProps {
  tab: any;
  onExecuteNode: (nodeId: string, customPrompt?: string) => void;
  onStopExecution: (nodeId: string) => void;
  groupId: string;
}

export const TaskTab: React.FC<TaskTabProps> = ({ tab, onExecuteNode, onStopExecution, groupId }) => {
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

  const canvasTabId = useMemo(() => {
    const contexts = useWorkspaceStore.getState().canvasContexts;
    for (const tId in contexts) {
      if (contexts[tId].nodes.some((n) => n.id === taskNodeId)) {
        return tId;
      }
    }
    return undefined;
  }, [taskNodeId]);

  const [taskSubTab, setTaskSubTab] = useState<"diff" | "chat" | "console">("diff");
  const [chatMessage, setChatMessage] = useState("");
  const [originalCode, setOriginalCode] = useState("// Loading original content...");
  const [modifiedCode, setModifiedCode] = useState("// Loading modified content...");
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [editedCode, setEditedCode] = useState<string>("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const modifiedFiles = (taskNode?.data?.modifiedFiles as string[]) || EMPTY_ARRAY;
  const [activeDiffFile, setActiveDiffFile] = useState<string>("");

  const diffEditorRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { viewMode, isAutoMode, toggleViewMode, enableAutoMode, renderSideBySide } = useDiffViewMode(containerRef);

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
        const modified: string = await invoke("read_file_vfs", { path: activeDiffFile, tabId: canvasTabId });
        
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

  const handleEditorMount = useCallback((editor: any) => {
    diffEditorRef.current = editor;
    const modifiedEditor = editor.getModifiedEditor();
    modifiedEditor.updateOptions({ readOnly: false });
    modifiedEditor.onDidChangeModelContent(() => {
      const newContent = modifiedEditor.getValue();
      setEditedCode(newContent);
      setIsDirty(newContent !== modifiedCode);
    });
    setTimeout(() => {
      editor.layout();
    }, 50);
  }, [modifiedCode]);

  const handleSave = async () => {
    if (!activeDiffFile || !isDirty) return;
    setIsSaving(true);
    try {
      await invoke("write_file_vfs", { path: activeDiffFile, content: editedCode, tabId: canvasTabId });
      setIsDirty(false);
      if (canvasTabId) {
        const { canvasFileService } = await import("./canvas/services/canvasFileService");
        await canvasFileService.autoSaveCanvas(canvasTabId);
      }
    } catch (err) {
      console.error("Failed to save file:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (diffEditorRef.current) {
      const modifiedEditor = diffEditorRef.current.getModifiedEditor();
      modifiedEditor.setValue(modifiedCode);
      setEditedCode(modifiedCode);
      setIsDirty(false);
    }
  };

  const getEditorLanguage = (filePath: string): string => {
    return getFileTypeDetails(filePath).language;
  };

  const displayCode = isDirty ? editedCode : modifiedCode;

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
            <CustomSelect
              value={(taskNode.data as any).model || activeModel}
              onChange={(val) => updateTaskNode(taskNodeId, { model: val })}
              options={customProviders.flatMap((p) => p.models).map((m) => ({
                id: m.id,
                name: `${m.name} (${m.id})`,
              }))}
              placeholder="No models configured"
              className="w-48"
            />
          </div>
        </div>

        {/* Task Diff Selector Dropdown */}
        {taskSubTab === "diff" && modifiedFiles.length > 0 && (
          <div className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] flex items-center justify-between text-xs font-mono">
            <div className="flex items-center space-x-3">
              <span className="text-[var(--text-muted)] mr-4">File Diff:</span>
              <CustomSelect
                value={activeDiffFile}
                onChange={setActiveDiffFile}
                options={modifiedFiles.map((file) => ({
                  id: file,
                  name: file.split("/").pop() || file,
                }))}
                className="w-64"
              />
            </div>
            <DiffViewToggle
              viewMode={viewMode}
              isAutoMode={isAutoMode}
              onToggle={toggleViewMode}
              onEnableAuto={enableAutoMode}
            />
          </div>
        )}

        {/* Edit Controls */}
        {taskSubTab === "diff" && activeDiffFile && (
          <div className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/50 flex items-center justify-end space-x-2 text-xs font-mono">
            <span className="text-[10px] text-[var(--text-muted)] font-mono mr-auto">
              {isDirty ? "Modified (unsaved)" : "Editable"}
            </span>
            <button
              onClick={handleReset}
              disabled={!isDirty || isSaving}
              className="flex items-center space-x-1 px-2 py-1 text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-light)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Reset changes"
            >
              <RotateCcw size={11} />
              <span>Reset</span>
            </button>
            <button
              onClick={handleSave}
              disabled={!isDirty || isSaving}
              className="flex items-center space-x-1 px-2 py-1 text-[10px] font-mono bg-emerald-600/80 hover:bg-emerald-600 disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] text-white rounded transition-colors"
              title="Save changes to VFS"
            >
              <Save size={11} />
              <span>{isSaving ? "Saving..." : "Save"}</span>
            </button>
          </div>
        )}

        {/* Task Sub Tab Content */}
        <div className="flex-1 overflow-hidden relative bg-[var(--bg-app)]">
          {taskSubTab === "diff" && (
            activeDiffFile ? (
              <div ref={containerRef} className="w-full h-full relative bg-[var(--bg-app)]">
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
                    modified={displayCode}
                    onMount={handleEditorMount}
                    options={{
                      readOnly: false,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      lineNumbers: "on",
                      renderSideBySide,
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
              <Chat
                messages={[
                  {
                    id: "system-agent-init",
                    role: "assistant",
                    content: "I will check the attached file inputs and execute your modifications. You can type instructions below to refine my work.",
                    timestamp: "",
                  },
                  ...chatHistory
                    .filter((msg: any, idx: number) => !(idx === 0 && msg.role === "user"))
                    .map((msg: any, idx: number) => ({
                      id: msg.id || `task-msg-${idx}`,
                      role: msg.role,
                      content: msg.content,
                      timestamp: msg.timestamp || "",
                      attachments: msg.attachments,
                    })),
                ]}
                isStreaming={nodeStatus === "running"}
                streamingMessageId={chatHistory.find((m: any) => m.role === "console" && m.content !== "")?.id || null}
                compact
              />

              <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 flex-shrink-0">
                <ChatInput
                  value={chatMessage}
                  onChange={setChatMessage}
                  onSend={() => {
                    if (!chatMessage.trim() || nodeStatus === "running") return;
                    onExecuteNode(taskNodeId, chatMessage);
                    setChatMessage("");
                  }}
                  disabled={nodeStatus === "running"}
                  isStreaming={nodeStatus === "running"}
                  onStop={() => onStopExecution(taskNodeId)}
                  placeholder="Refine work, prompt modifications... (type @ to reference files)"
                />
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
            {nodeStatus === "running" ? (
              <button
                onClick={() => onStopExecution(taskNodeId)}
                className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-mono font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all shadow-md cursor-pointer"
              >
                <Octagon size={14} />
                <span>Stop</span>
              </button>
            ) : (
              <button
                onClick={() => onExecuteNode(taskNodeId)}
                className="bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 text-white text-xs font-mono font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all glow-btn shadow-md cursor-pointer"
              >
                <Sparkles size={14} />
                <span>Run Executor</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
