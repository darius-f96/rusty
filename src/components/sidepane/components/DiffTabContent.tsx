import React, { useState, useRef, useCallback } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { CustomSelect } from "../../CustomSelect";
import { invoke } from "@tauri-apps/api/core";
import { Save, RotateCcw } from "lucide-react";

interface DiffTabContentProps {
  selectedNode: any;
  modifiedFiles: string[];
  activeDiffFile: string;
  setActiveDiffFile: (file: string) => void;
  originalCode: string;
  modifiedCode: string;
}

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

export const DiffTabContent: React.FC<DiffTabContentProps> = ({
  selectedNode,
  modifiedFiles,
  activeDiffFile,
  setActiveDiffFile,
  originalCode,
  modifiedCode
}) => {
  const [editedCode, setEditedCode] = useState<string>("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const diffEditorRef = useRef<any>(null);

  const diffOptions = modifiedFiles.map((file) => ({
    id: file,
    name: file.split("/").pop() || file,
  }));

  const handleEditorMount = useCallback((editor: any) => {
    diffEditorRef.current = editor;
    const modifiedEditor = editor.getModifiedEditor();
    modifiedEditor.updateOptions({ readOnly: false });
    modifiedEditor.onDidChangeModelContent(() => {
      const newContent = modifiedEditor.getValue();
      setEditedCode(newContent);
      setIsDirty(newContent !== modifiedCode);
    });
  }, [modifiedCode]);

  const handleSave = async () => {
    if (!activeDiffFile || !isDirty) return;
    setIsSaving(true);
    try {
      await invoke("write_file_vfs", { path: activeDiffFile, content: editedCode });
      setIsDirty(false);
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

  const displayCode = isDirty ? editedCode : modifiedCode;

  return (
    <div className="flex flex-col h-full w-full">
      {/* File Diff Dropdown Selector (only for TaskNode when files are edited) */}
      {selectedNode.type === "taskNode" && modifiedFiles.length > 0 && (
        <div className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] flex items-center justify-between text-xs font-mono flex-shrink-0">
          <span className="text-[var(--text-muted)] mr-4">File Diff:</span>
          <CustomSelect
            value={activeDiffFile}
            onChange={setActiveDiffFile}
            options={diffOptions}
            className="w-64"
          />
        </div>
      )}

      {/* Edit controls for taskNode */}
      {selectedNode.type === "taskNode" && activeDiffFile && (
        <div className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/50 flex items-center justify-end space-x-2 flex-shrink-0">
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

      <div className="flex-1 min-h-0 relative">
        {activeDiffFile ? (
          <div className="w-full h-full">
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
                renderSideBySide: true,
                fontSize: 11
              }}
            />
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-[var(--text-muted)] font-mono text-xs space-y-2">
            <span className="text-[var(--accent-color)] font-bold">// Sandbox VFS Standby</span>
            <span className="text-[11px] text-[var(--text-muted)] max-w-[280px]">
              No files modified by this task node yet. Connect a source File Node, type prompt instructions, and click "Run Executor".
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
