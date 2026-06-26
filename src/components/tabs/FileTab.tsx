import React, { useState, useEffect, useRef } from "react";
import Editor, { loader } from "@monaco-editor/react";
import { useWorkspaceStore } from "../../store";
import { invoke } from "@tauri-apps/api/core";
import { getFileTypeDetails } from "../../services/fileTypeService";
import { themes, defineMonacoTheme } from "../../theme";
import { GitBranch, History } from "lucide-react";

// Register custom Monaco theme once
loader.init().then((monaco) => {
  const activeThemeId = useWorkspaceStore.getState().activeThemeId;
  const activeTheme = themes[activeThemeId] || themes.dark;
  defineMonacoTheme(monaco, activeTheme);
});

interface FileTabProps {
  tab: any;
}

export const FileTab: React.FC<FileTabProps> = ({ tab }) => {
  const [fileContent, setFileContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [showBlame, setShowBlame] = useState(false);
  const [blameData, setBlameData] = useState<Record<number, any>>({});
  const [maxBlameLength, setMaxBlameLength] = useState(5);
  const saveTimeoutRef = useRef<any>(null);
  const editorRef = useRef<any>(null);

  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const openTab = useWorkspaceStore((state) => state.openTab);
  const isActive = activeTabId === tab.id;

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
        const content: string = await invoke("read_file_vfs", { path: tab.key });
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

  const handleEditorMount = (editor: any) => {
    editorRef.current = editor;

    // Toggle blame display when user clicks on line numbers gutter
    editor.onMouseDown((e: any) => {
      if (e.target && (e.target.type === 2 || e.target.type === 3 || e.target.type === 4)) {
        setShowBlame((prev) => !prev);
      }
    });

    setTimeout(() => {
      editor.layout();
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
      </div>

      <Editor
        height="100%"
        language={getEditorLanguage(tab.key)}
        theme="axiom-custom-theme"
        value={fileContent}
        onChange={handleEditorChange}
        onMount={handleEditorMount}
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
