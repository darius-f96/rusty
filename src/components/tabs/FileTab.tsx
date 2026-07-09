import React, { useState, useEffect, useRef, useMemo } from "react";
import Editor, { loader } from "@monaco-editor/react";
import { useWorkspaceStore } from "../../store";
import { invoke } from "@tauri-apps/api/core";
import { VfsRegistry } from "../../services/vfs";
import { getFileTypeDetails } from "../../services/fileTypeService";
import { themes, defineMonacoTheme } from "../../theme";
import { GitBranch, History, TreePine } from "lucide-react";
import { LspStatus } from "../../services/lspService";
import { MonacoLspBinding } from "../../services/monacoLspBinding";

const LSP_EDITOR_ENABLED = false;

// Register custom Monaco theme once
loader.init().then((monaco) => {
  const activeThemeId = useWorkspaceStore.getState().activeThemeId;
  const activeTheme = themes[activeThemeId] || themes.dark;
  defineMonacoTheme(monaco, activeTheme);
});

interface FileTabProps {
  tab: any;
  groupId: string;
}

export const FileTab: React.FC<FileTabProps> = ({ tab, groupId }) => {
  const [fileContent, setFileContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [showBlame, setShowBlame] = useState(false);
  const [blameData, setBlameData] = useState<Record<number, any>>({});
  const [maxBlameLength, setMaxBlameLength] = useState(5);
  const [lspStatus, setLspStatus] = useState<LspStatus>({ state: "disconnected" });
  const saveTimeoutRef = useRef<any>(null);
  const editorRef = useRef<any>(null);
  const lspBindingRef = useRef<MonacoLspBinding | null>(null);

  const editorGroups = useWorkspaceStore((state) => state.editorGroups);
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const openTab = useWorkspaceStore((state) => state.openTab);
  const revealFileInTree = useWorkspaceStore((state) => state.revealFileInTree);
  
  const targetGroup = editorGroups.find((g) => g.id === groupId);
  const isActive = targetGroup ? targetGroup.activeTabId === tab.id : false;

  const canvasTabId = useMemo(() => {
    const contexts = useWorkspaceStore.getState().canvasContexts;
    for (const tId in contexts) {
      const ctx = contexts[tId];
      const hasNode = ctx.nodes.some((n: any) => n.data?.modifiedFiles?.includes(tab.key));
      if (hasNode) return tId;
    }
    return undefined;
  }, [tab.key]);

  // Load Git blame details
  useEffect(() => {
    if (!rootPath || !tab.key) return;
    const fetchBlame = async () => {
      try {
        const blameLines: any[] = await invoke("git_blame", { rootDir: rootPath, filePath: tab.key });
        const map: Record<number, any> = {};
        let maxLen = 5;
        blameLines.forEach((line) => {
          map[line.line_number] = line;
          const label = `${line.author} (${line.date}) │ ${line.line_number}`;
          if (label.length > maxLen) {
            maxLen = label.length;
          }
        });
        setBlameData(map);
        setMaxBlameLength(maxLen);
      } catch (err) {
        console.warn("Failed to fetch git blame for file:", err);
      }
    };
    fetchBlame();
  }, [tab.key, rootPath]);

  // Load content on mount
  useEffect(() => {
    const fetchFileContent = async () => {
      try {
        console.log(`FileTab reading VFS path: ${tab.key}`);
        const content: string = await VfsRegistry.getOrCreate(canvasTabId).readFile(tab.key);
        setFileContent(content);
      } catch (err: any) {
        console.error("FileTab failed to read VFS:", err);
        setFileContent(`// Error reading file: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchFileContent();

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      // Detach the LSP binding first: it ref-counts the server-side document,
      // unregisters the model path, and clears diagnostics markers when this
      // was the last editor group showing the file.
      lspBindingRef.current?.detach();
      lspBindingRef.current = null;
      // We render <Editor keepCurrentModel /> below, so @monaco-editor/react
      // never disposes the shared Monaco model on unmount. (Its keepCurrentModel
      // flag is captured at mount time inside a [] effect, which predates any
      // split, so a conditional prop can't reliably cover the shared-model
      // case — closing the original editor would still dispose the model and
      // black out the split copy.) We own model lifecycle here: dispose the
      // model only when this was the last editor group still showing the file.
      const monaco = (window as any).monaco;
      if (monaco) {
        const uri = monaco.Uri.parse(`file://${tab.key}`);
        const model = monaco.editor.getModel(uri);
        if (model) {
          const stillOpenElsewhere = useWorkspaceStore
            .getState()
            .editorGroups.some((g) => g.openTabs.some((t) => t.key === tab.key));
          if (!stillOpenElsewhere) {
            model.dispose();
          }
        }
      }
    };
  }, [tab.key]);

  // Trigger editor layout when tab becomes active
  useEffect(() => {
    if (isActive && editorRef.current) {
      setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.layout();
        }
      }, 50);
    }
  }, [isActive]);

  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined) return;
    setFileContent(value);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await invoke("write_file_disk", { path: tab.key, content: value });
        console.log(`FileTab auto-saved: ${tab.title}`);
        useWorkspaceStore.getState().loadGitStatus(); // Reload git changes list
      } catch (err) {
        console.error("FileTab disk save failed:", err);
      }
    }, 500);
  };

  const handleOpenFileHistory = () => {
    openTab({
      id: `git-history-${tab.key}`,
      type: "git-history",
      title: `History: ${tab.title}`,
      key: tab.key,
    });
  };

  const scrollToLine = (editor: any, lineNum: number) => {
    if (!editor || !lineNum) return;
    editor.revealLineInCenter(lineNum);
    editor.setPosition({ lineNumber: lineNum, column: 1 });
    editor.focus();
  };

  useEffect(() => {
    if (editorRef.current && tab.line) {
      scrollToLine(editorRef.current, tab.line);
    }
  }, [tab.line]);

  const handleEditorMount = (editor: any) => {
    editorRef.current = editor;

    if (LSP_EDITOR_ENABLED) {
      // Attach LSP intelligence: registers Monaco providers for the file's
      // language, syncs the document with the language server, maps diagnostics
      // to markers, and installs the global openCodeEditor override that turns
      // cmd+click / F12 definition jumps into Axiom tab opens. All of this used
      // to be inline here and in lspService.registerEditor.
      lspBindingRef.current = MonacoLspBinding.attach(editor, tab.key, {
        onStatus: setLspStatus,
      });
    }

    // Toggle blame display when user clicks on line numbers gutter
    editor.onMouseDown((e: any) => {
      if (e.target && (e.target.type === 2 || e.target.type === 3 || e.target.type === 4)) {
        setShowBlame((prev) => !prev);
      }
    });

    setTimeout(() => {
      editor.layout();
      if (tab.line) {
        scrollToLine(editor, tab.line);
      }
    }, 50);
  };

  const getEditorLanguage = (filePath: string): string => {
    return getFileTypeDetails(filePath).language;
  };

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center font-mono text-xs text-[var(--text-muted)] bg-[var(--bg-app)]">
        <span>Loading file content...</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative bg-[var(--bg-app)]">
      {/* Floating Action Controls */}
      <div className="absolute top-2.5 right-6 z-10 flex items-center space-x-2">
        {/* LSP Status Chip — shows language-server state so the user can see why
            the first cmd+click on a freshly-opened Java project is slow (jdtls
            indexes for several seconds before answering definition requests). */}
        {LSP_EDITOR_ENABLED && (() => {
          const s = lspStatus;
          let dot = "bg-[var(--text-muted)]";
          let label = "LSP";
          let title = "No language server for this file type";
          let pulse = false;
          if (s.state === "connecting" || s.state === "initializing") {
            dot = "bg-amber-400"; label = "LSP: starting"; title = "Starting language server"; pulse = true;
          } else if (s.state === "indexing") {
            dot = "bg-sky-400"; label = s.percent != null ? `LSP: indexing ${s.percent}%` : "LSP: indexing";
            title = s.message || "Indexing workspace"; pulse = true;
          } else if (s.state === "ready") {
            dot = "bg-emerald-500"; label = "LSP: ready"; title = "Language server ready";
          } else if (s.state === "error") {
            dot = "bg-rose-500"; label = "LSP: error"; title = s.message || "Language server error";
          }
          return (
            <div
              title={title}
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[10px] font-mono font-bold border bg-[var(--bg-sidebar)] border-[var(--border-color)] text-[var(--text-muted)] shadow-md"
            >
              <span className={`w-2 h-2 rounded-full ${dot} ${pulse ? "animate-pulse" : ""}`} />
              <span>{label}</span>
            </div>
          );
        })()}

        {/* Floating Git History Button */}
        <button
          onClick={handleOpenFileHistory}
          className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-light)] hover:border-[var(--border-active)] p-1.5 rounded-md text-[10px] font-mono font-bold transition-all shadow-md cursor-pointer flex items-center space-x-1"
          title="Open Git History of this File"
        >
          <History size={10} />
          <span>History</span>
        </button>

        {/* Floating Git Blame Toggle Pill */}
        <button
          onClick={() => setShowBlame(!showBlame)}
          className={`flex items-center space-x-1 px-2.5 py-1 rounded-md text-[10px] font-mono font-bold border transition-all shadow-md cursor-pointer ${
            showBlame
              ? "bg-[var(--accent-color)] border-[var(--accent-color)] text-white font-semibold"
              : "bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-light)] hover:border-[var(--border-active)]"
          }`}
          title="Toggle Git Blame (or click line numbers)"
        >
          <GitBranch size={10} />
          <span>{showBlame ? "Blame: On" : "Blame"}</span>
        </button>

        {/* Reveal in Tree Button */}
        <button
          onClick={() => revealFileInTree(tab.key)}
          className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-light)] hover:border-[var(--border-active)] p-1.5 rounded-md text-[10px] font-mono font-bold transition-all shadow-md cursor-pointer flex items-center space-x-1"
          title="Reveal in File Tree"
        >
          <TreePine size={10} />
          <span>Reveal</span>
        </button>
      </div>

      <Editor
        height="100%"
        path={`file://${tab.key}`}
        language={getEditorLanguage(tab.key)}
        theme="axiom-custom-theme"
        value={fileContent}
        onChange={handleEditorChange}
        onMount={handleEditorMount}
        keepCurrentModel
        options={{
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          lineNumbers: (num: number) => {
            if (showBlame && blameData[num]) {
              const blame = blameData[num];
              return `${blame.author} (${blame.date}) │ ${num}`;
            }
            return String(num);
          },
          lineNumbersMinChars: showBlame ? maxBlameLength + 2 : 5,
          fontSize: 12,
          tabSize: 2,
        }}
      />
    </div>
  );
};
