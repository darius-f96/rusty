import React from "react";
import { DiffEditor } from "@monaco-editor/react";

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
  return (
    <div className="flex flex-col h-full w-full">
      {/* File Diff Dropdown Selector (only for TaskNode when files are edited) */}
      {selectedNode.type === "taskNode" && modifiedFiles.length > 0 && (
        <div className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] flex items-center justify-between text-xs font-mono flex-shrink-0">
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

      <div className="flex-1 min-h-0 relative">
        {activeDiffFile ? (
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
