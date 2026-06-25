import React, { useState, useEffect, useRef } from "react";
import Editor, { loader } from "@monaco-editor/react";
import { useWorkspaceStore } from "../../store";
import { invoke } from "@tauri-apps/api/core";
import { getFileTypeDetails } from "../../services/fileTypeService";
import { theme } from "../../theme";

// Register custom Monaco theme once
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

interface FileTabProps {
  tab: any;
}

export const FileTab: React.FC<FileTabProps> = ({ tab }) => {
  const [fileContent, setFileContent] = useState("");
  const [loading, setLoading] = useState(true);
  const saveTimeoutRef = useRef<any>(null);
  const editorRef = useRef<any>(null);

  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const isActive = activeTabId === tab.id;

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

  const handleEditorMount = (editor: any) => {
    editorRef.current = editor;
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
          lineNumbers: "on",
          fontSize: 12,
          tabSize: 2,
        }}
      />
    </div>
  );
};
