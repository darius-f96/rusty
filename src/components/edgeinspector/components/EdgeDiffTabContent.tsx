/**
 * EdgeDiffTabContent Component
 * 
 * Embeds Monaco DiffEditor and provides a dropdown selector to view diffs
 * of files that were modified by the source task.
 */

import React from "react";
import { DiffEditor } from "@monaco-editor/react";
import { CustomSelect } from "../../CustomSelect";

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
  const fileOptions = sourceModifiedFiles.map((file) => ({
    id: file,
    name: file.split("/").pop() || file,
  }));

  return (
    <div className="flex flex-col h-full w-full">
      {sourceModifiedFiles.length > 0 && (
        <div className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] flex items-center justify-between text-xs font-mono flex-shrink-0">
          <span className="text-[var(--text-muted)] mr-4">File:</span>
          <CustomSelect
            value={diffFile}
            onChange={(val) => {
              setDiffFile(val);
              loadDiffContent(val);
            }}
            options={fileOptions}
            className="w-64"
          />
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
