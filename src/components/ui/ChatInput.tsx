import React, { useState, useRef, useEffect } from "react";
import { Plus, Send, X, Paperclip, Square } from "lucide-react";
import Editor, { loader } from "@monaco-editor/react";
import { useWorkspaceStore } from "../../store";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

interface ChatInputProps {
  value: string;
  onChange: (val: string) => void;
  onSend: (attachments: { path: string; name: string; isDir?: boolean }[]) => void;
  placeholder?: string;
  disabled?: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
}

interface FileItem {
  name: string;
  path: string;
  isDir: boolean;
}

// Global variable to avoid double registering the markdown trigger
let markdownTriggerRegistered = false;

export const ChatInput: React.FC<ChatInputProps> = ({
  value,
  onChange,
  onSend,
  placeholder = "Ask or prompt changes...",
  disabled = false,
  isStreaming = false,
  onStop,
}) => {
  const fileTree = useWorkspaceStore((state) => state.fileTree);
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  
  const [attachments, setAttachments] = useState<{ path: string; name: string; isDir?: boolean }[]>([]);
  const editorRef = useRef<any>(null);

  // Flatten the file tree for autocompletion
  const getFlatFiles = (): FileItem[] => {
    const list: FileItem[] = [];
    const recurse = (entries: any[]) => {
      for (const entry of entries) {
        list.push({
          name: entry.name,
          path: entry.path,
          isDir: !!entry.is_dir,
        });
        if (entry.children && entry.children.length > 0) {
          recurse(entry.children);
        }
      }
    };
    recurse(fileTree || []);
    return list;
  };

  // Register the global `@` trigger once Monaco is loaded
  useEffect(() => {
    loader.init().then((monaco) => {
      if (markdownTriggerRegistered) return;
      markdownTriggerRegistered = true;

      console.log("[ChatInput] Registering markdown autolink suggestion provider (@)");
      monaco.languages.registerCompletionItemProvider("markdown", {
        triggerCharacters: ["@"],
        provideCompletionItems: (model: any, position: any) => {
          // Verify we are triggered by '@'
          const textUntilPosition = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });

          if (!textUntilPosition.endsWith("@")) {
            return { suggestions: [] };
          }

          const flatFiles = getFlatFiles();
          const suggestions = flatFiles.map((file) => {
            const relPath = rootPath ? file.path.replace(`${rootPath}/`, "") : file.path;
            return {
              label: `@${file.name}`,
              kind: file.isDir
                ? monaco.languages.CompletionItemKind.Folder
                : monaco.languages.CompletionItemKind.File,
              detail: relPath,
              insertText: relPath,
              documentation: `Insert project reference: ${file.path}`,
              range: {
                startLineNumber: position.lineNumber,
                startColumn: position.column - 1,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
              },
            };
          });

          return { suggestions };
        },
      });
    });
  }, [fileTree, rootPath]);

  const handleAddAttachment = async () => {
    try {
      const selected = await openDialog({
        multiple: true,
        directory: false,
        title: "Attach Context Document/File",
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        const newAttachments = paths.map((p) => {
          const name = p.split("/").pop() || p;
          return { path: p, name, isDir: false };
        });
        setAttachments((prev) => {
          const filtered = newAttachments.filter((n) => !prev.some((p) => p.path === n.path));
          return [...prev, ...filtered];
        });
      }
    } catch (err) {
      console.error("Failed to pick files:", err);
    }
  };

  const handleRemoveAttachment = (path: string) => {
    setAttachments((prev) => prev.filter((a) => a.path !== path));
  };

  const handleSend = () => {
    // Read directly from editor value to ensure sync
    const content = editorRef.current ? editorRef.current.getValue() : value;
    if (!content.trim() && attachments.length === 0) return;
    
    // Clear editor
    if (editorRef.current) {
      editorRef.current.setValue("");
    }
    onChange("");
    
    onSend(attachments);
    setAttachments([]);
  };

  const handleEditorMount = (editor: any, monaco: any) => {
    editorRef.current = editor;

    // Send on Enter key, ONLY if suggest widget is not visible
    editor.addAction({
      id: "send-message",
      label: "Send Message",
      keybindings: [monaco.KeyCode.Enter],
      precondition: "!suggestWidgetVisible",
      run: () => {
        handleSend();
      }
    });

    // Support Shift+Enter for new lines
    editor.addAction({
      id: "insert-newline",
      label: "Insert Newline",
      keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      run: () => {
        const selection = editor.getSelection();
        const range = new monaco.Range(
          selection.startLineNumber,
          selection.startColumn,
          selection.endLineNumber,
          selection.endColumn
        );
        const id = { major: 1, minor: 1 };
        const text = "\n";
        const op = { identifier: id, range: range, text: text, forceMoveMarkers: true };
        editor.executeEdits("my-source", [op]);
      }
    });
  };

  return (
    <div className="w-full flex flex-col relative bg-[var(--bg-app)] border border-[var(--border-color)] rounded-xl shadow-md p-2">
      {/* Attachments Preview Drawer */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-2 pb-2 mb-2 border-b border-[var(--border-color)]/40">
          {attachments.map((att) => (
            <div
              key={att.path}
              className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-[var(--bg-sidebar)]/80 border border-[var(--border-color)]/60 text-[10px] font-mono text-[var(--text-light)]"
            >
              <Paperclip size={10} className="text-violet-400" />
              <span className="truncate max-w-[120px]">{att.name}</span>
              <button
                onClick={() => handleRemoveAttachment(att.path)}
                className="text-[var(--text-muted)] hover:text-rose-400 transition-colors p-0.5 rounded-full cursor-pointer"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input Row */}
      <div className="flex items-end space-x-2">
        {/* Upload Button */}
        <button
          type="button"
          onClick={handleAddAttachment}
          disabled={disabled}
          className="p-2 rounded-lg bg-[var(--bg-sidebar)]/50 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-light)] hover:border-[var(--border-active)] transition-all cursor-pointer flex-shrink-0 mb-0.5"
          title="Add context file (+)"
        >
          <Plus size={16} />
        </button>

        {/* Monaco Prompt Editor */}
        <div className="flex-1 min-h-[64px] max-h-[160px] border border-[var(--border-color)]/60 rounded-lg overflow-hidden bg-[var(--bg-app)] relative py-1">
          <Editor
            height="64px"
            language="markdown"
            theme="axiom-custom-theme"
            value={value}
            onChange={(val) => onChange(val || "")}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: false },
              wordWrap: "on",
              lineNumbers: "off",
              glyphMargin: false,
              folding: false,
              lineDecorationsWidth: 0,
              lineNumbersMinChars: 0,
              scrollbar: {
                vertical: "auto",
                horizontal: "hidden",
                verticalScrollbarSize: 6,
              },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              fontSize: 12,
              suggestOnTriggerCharacters: true,
              quickSuggestions: {
                other: true,
                comments: false,
                strings: false,
              },
              placeholder: placeholder,
            }}
          />
        </div>

        {/* Send or Stop Button */}
        {isStreaming && onStop ? (
          <button
            type="button"
            onClick={onStop}
            className="p-2.5 rounded-lg bg-rose-600 text-white hover:bg-rose-500 transition-all cursor-pointer flex-shrink-0 shadow-md flex items-center justify-center animate-pulse border-none mb-0.5"
            title="Stop process"
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={disabled || (!value.trim() && attachments.length === 0)}
            className="p-2.5 rounded-lg bg-[var(--accent-color)] disabled:opacity-40 disabled:hover:bg-[var(--accent-color)] text-white hover:bg-[var(--accent-color)]/80 transition-all cursor-pointer flex-shrink-0 shadow-md flex items-center justify-center mb-0.5 border-none"
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </div>
  );
};
