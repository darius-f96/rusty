/**
 * EdgeDiffTabContent Component
 * 
 * Embeds Monaco DiffEditor and provides a dropdown selector to view diffs
 * of files that were modified by the source task.
 */

import React from "react";
import { DiffEditor } from "@monaco-editor/react";

interface EdgeDiffTabContentProps {
  sourceModifiedFiles: string[];
  diffFile: string;
  setDiffFile: (file: string) => void;
  loadDiffContent: (file: string) => Promise<void>;
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
    default:
      return "plaintext";
  }
};

export const EdgeDiffTabContent: React.FC<EdgeDiffTabContentProps> = ({
  sourceModifiedFiles,
  diffFile,
  setDiffFile,
  loadDiffContent,
  originalCode,
  modifiedCode
}) => {
  return (
    <div className="flex flex-col h-full w-full">
      {sourceModifiedFiles.length > 0 && (
        <div className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] flex items-center justify-between text-xs font-mono flex-shrink-0">
          <span className="text-[var(--text-muted)]">File:</span>
          <select
            value={diffFile}
            onChange={(e) => {
              setDiffFile(e.target.value);
              loadDiffContent(e.target.value);
            }}
            className="bg-[var(--bg-app)] text-[var(--text-normal)] border border-[var(--border-color)] rounded px-2.5 py-1 outline-none text-[11px] max-w-[300px] truncate focus:border-rose-400 cursor-pointer"
          >
            {sourceModifiedFiles.map((file) => (
              <option key={file} value={file}>
                {file.split("/").pop() || file}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex-1 min-h-0 relative">
        {diffFile ? (
          <div className="w-full h-full">
            <DiffEditor
              height="100%"
              language={getEditorLanguage(diffFile)}
              theme="axiom-custom-theme"
              original={originalCode}
              modified={modifiedCode}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: "on",
                renderSideBySide: true,
                fontSize: 11,
              }}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-xs font-mono">
            No modified files to display.
          </div>
        )}
      </div>
    </div>
  );
};
