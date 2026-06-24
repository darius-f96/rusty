import React, { useState, useEffect, useRef } from "react";
import Editor, { DiffEditor, loader } from "@monaco-editor/react";
import { Terminal, MessageSquare, Code, Play, Sparkles } from "lucide-react";
import { useWorkspaceStore } from "../store";
import { invoke } from "@tauri-apps/api/core";
import { getFileTypeDetails } from "../services/fileTypeService";
import { theme } from "../theme";

// Register custom Monaco theme
loader.init().then((monaco) => {
  monaco.editor.defineTheme("axiom-custom-theme", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: theme.textNormal.replace("#", "") },
      { token: "comment", foreground: theme.syntax.comments.replace("#", ""), fontStyle: "italic" },
      { token: "keyword", foreground: theme.syntax.keywords.replace("#", "") },
      { token: "string", foreground: theme.syntax.strings.replace("#", "") },
      { token: "number", foreground: theme.syntax.numbers.replace("#", "") },
      { token: "regexp", foreground: theme.syntax.strings.replace("#", "") },
      { token: "type", foreground: theme.syntax.types.replace("#", "") },
      { token: "class", foreground: theme.syntax.types.replace("#", "") },
      { token: "function", foreground: theme.syntax.functions.replace("#", "") },
      { token: "variable", foreground: theme.syntax.variables.replace("#", "") },
    ],
    colors: {
      "editor.background": theme.bgEditor,
      "editor.foreground": theme.textNormal,
      "editorLineNumber.foreground": theme.textMuted,
      "editorLineNumber.activeForeground": theme.textLight,
      "editor.lineHighlightBackground": theme.bgSidebar + "33", // transparent overlay
      "editor.selectionBackground": theme.accent + "44",
      "editorCursor.foreground": theme.accent,
    },
  });
});

const EMPTY_ARRAY: any[] = [];

interface EditorPanelProps {
  activeTab: any;
  onExecuteNode: (nodeId: string) => void;
}

export const EditorPanel: React.FC<EditorPanelProps> = ({ activeTab, onExecuteNode }) => {
  const nodes = useWorkspaceStore((state) => state.nodes);
  const openTabs = useWorkspaceStore((state) => state.openTabs);
  const rootPath = useWorkspaceStore((state) => state.rootPath);

  // --- 1. File Tab Writable Editor Logic ---
  const [fileContent, setFileContent] = useState("");
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

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await invoke("write_file_disk", { path: activeTab.key, content: value });
        console.log(`EditorPanel [FileTab] auto-saved directly to disk: ${activeTab.title}`);
        useWorkspaceStore.getState().loadGitStatus(); // Reload git changes list
      } catch (err) {
        console.error("EditorPanel [FileTab] disk save failed:", err);
      }
    }, 500);
  };

  // --- 1.5. Git Diff Tab View Logic ---
  const [gitOriginalCode, setGitOriginalCode] = useState("");
  const [gitModifiedCode, setGitModifiedCode] = useState("");
  const [isGitDiffLoading, setIsGitDiffLoading] = useState(false);

  useEffect(() => {
    if (!activeTab || activeTab.type !== "git-diff" || !rootPath) return;

    let active = true;
    const fetchGitDiffContent = async () => {
      setIsGitDiffLoading(true);
      try {
        console.log(`EditorPanel [GitDiffTab] loading diff for: ${activeTab.key} (${activeTab.diffType || "unstaged"})`);
        let original = "";
        let modified = "";

        if (activeTab.diffType === "commit" && activeTab.commitHash) {
          // Commit: compare parent commit revision vs commit revision
          original = await invoke("git_get_file_content_at_rev", {
            rootDir: rootPath,
            revision: `${activeTab.commitHash}~1`,
            filePath: activeTab.key,
          });
          modified = await invoke("git_get_file_content_at_rev", {
            rootDir: rootPath,
            revision: activeTab.commitHash,
            filePath: activeTab.key,
          });
        } else if (activeTab.diffType === "staged") {
          // Staged: compare HEAD vs Index
          original = await invoke("git_get_head_content", {
            rootDir: rootPath,
            filePath: activeTab.key,
          });
          modified = await invoke("git_get_index_content", {
            rootDir: rootPath,
            filePath: activeTab.key,
          });
        } else {
          // Unstaged: compare Index vs Working Tree (VFS/Disk)
          original = await invoke("git_get_index_content", {
            rootDir: rootPath,
            filePath: activeTab.key,
          });
          try {
            modified = await invoke("read_file_vfs", { path: activeTab.key });
          } catch (e) {
            try {
              modified = await invoke("read_file_disk", { path: activeTab.key });
            } catch (err) {
              modified = "";
            }
          }
        }

        if (active) {
          setGitOriginalCode(original);
          setGitModifiedCode(modified);
        }
      } catch (err: any) {
        console.error("EditorPanel [GitDiffTab] failed to load git diff:", err);
        if (active) {
          setGitOriginalCode(`// Error reading original content: ${err.message}`);
          setGitModifiedCode(`// Error reading modified content: ${err.message}`);
        }
      } finally {
        if (active) {
          setIsGitDiffLoading(false);
        }
      }
    };

    fetchGitDiffContent();
    return () => {
      active = false;
    };
  }, [activeTab?.key, activeTab?.type, rootPath]);

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
    return getFileTypeDetails(filePath).language;
  };

  return (
    <div className="w-full h-full bg-[var(--bg-app)] flex flex-col text-[var(--text-normal)] font-sans relative">
      {/* Tab Content View */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* FILE TAB VIEW */}
        {activeTab.type === "file" && (
          <div className="flex-1 flex flex-col overflow-hidden relative">
            <div className="flex-1 w-full h-full relative">
              <Editor
                height="100%"
                language={getEditorLanguage(activeTab.key)}
                theme="axiom-custom-theme"
                value={fileContent}
                onChange={handleEditorChange}
                options={{
                  minimap: { enabled: true },
                  scrollBeyondLastLine: false,
                  lineNumbers: "on",
                  fontSize: 12,
                  tabSize: 2
                }}
              />
            </div>
          </div>
        )}

        {/* GIT DIFF TAB VIEW */}
        {activeTab.type === "git-diff" && (
          <div className="flex-1 flex flex-col overflow-hidden relative">
            {/* Header info */}
            <div className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] flex items-center justify-between text-xs font-mono">
              <span className="text-[var(--text-light)] font-bold">{activeTab.title}</span>
              <span className="text-[var(--text-muted)] text-[10px] truncate max-w-[400px]">
                {activeTab.key}
              </span>
            </div>
            
            {/* Diff editor viewport */}
            <div className="flex-1 w-full h-full relative">
              {isGitDiffLoading ? (
                <div className="w-full h-full flex flex-col items-center justify-center font-mono text-xs text-[var(--text-muted)]">
                  <span>Loading Git changes...</span>
                </div>
              ) : (
                <DiffEditor
                  height="100%"
                  language={getEditorLanguage(activeTab.key)}
                  theme="axiom-custom-theme"
                  original={gitOriginalCode}
                  modified={gitModifiedCode}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    lineNumbers: "on",
                    renderSideBySide: true,
                    fontSize: 11
                  }}
                />
              )}
            </div>
          </div>
        )}

        {/* TASK TAB VIEW */}
        {activeTab.type === "task" && taskNode && (
          <div className="flex-1 flex flex-col overflow-hidden relative">
            {/* Task Sub Tabs Row */}
            <div className="flex border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/50 text-xs font-mono">
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
                    <div className="flex flex-col bg-[var(--bg-sidebar)]/60 border border-[var(--border-color)]/80 rounded-xl p-3 max-w-[85%] self-start space-y-1">
                      <span className="font-mono text-[9px] uppercase font-bold text-[var(--text-muted)]">System Agent</span>
                      <span className="leading-relaxed">
                        I will check the attached file inputs and execute your modifications. You can type instructions below to refine my work.
                      </span>
                    </div>
                    {chatMessage && nodeStatus === "success" && (
                      <div className="flex flex-col bg-[var(--accent-bg)]/20 border border-[var(--accent-color)]/50 rounded-xl p-3 max-w-[85%] ml-auto space-y-1 text-right text-[var(--text-light)]">
                        <span className="font-mono text-[9px] uppercase font-bold text-[var(--accent-color)]">User</span>
                        <span className="leading-relaxed">{chatMessage}</span>
                      </div>
                    )}
                  </div>

                  <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!chatMessage.trim()) return;
                        onExecuteNode(taskNodeId);
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
              <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 flex items-center justify-between select-none">
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
        )}
      </div>
    </div>
  );
};
