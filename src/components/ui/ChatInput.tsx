import React, { useState, useRef, useEffect } from "react";
import { Plus, Send, X, FileText, Folder, Paperclip, Square } from "lucide-react";
import { useWorkspaceStore } from "../../store";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { searchService } from "../../services/searchService";

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
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<FileItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [suggestionTriggerIndex, setSuggestionTriggerIndex] = useState(-1);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const autocompleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flatten the file tree for autocompletion fallback
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

  // Auto-resize the textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(200, textarea.scrollHeight)}px`;
    }
  }, [value]);

  // Handle click outside suggestions box & clean timeouts
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      if (autocompleteTimeoutRef.current) {
        clearTimeout(autocompleteTimeoutRef.current);
      }
    };
  }, []);

  const searchWorkspaceFiles = async (query: string) => {
    if (!rootPath) {
      setShowSuggestions(false);
      return;
    }

    if (!query) {
      // Instant fallback for empty query
      const flat = getFlatFiles();
      const filtered = flat.slice(0, 10);
      if (filtered.length > 0) {
        setSuggestions(filtered);
        setShowSuggestions(true);
        setSelectedIndex(0);
      } else {
        setShowSuggestions(false);
      }
      return;
    }

    try {
      const results = await searchService.searchProject({
        rootDir: rootPath,
        query,
        matchCase: false,
        wholeWord: false,
        isRegex: false,
      });

      const fileMatches = results
        .filter((r) => !r.is_content_match) // only filenames
        .map((r) => ({
          name: r.name,
          path: r.path,
          isDir: false,
        }))
        .slice(0, 10);

      if (fileMatches.length > 0) {
        setSuggestions(fileMatches);
        setShowSuggestions(true);
        setSelectedIndex(0);
      } else {
        setShowSuggestions(false);
      }
    } catch (err) {
      console.error("Failed autocomplete search:", err);
      setShowSuggestions(false);
    }
  };

  // Handle keydown for autocompletion suggestions
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertSuggestion(suggestions[selectedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setShowSuggestions(false);
      }
    } else {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    onChange(text);

    const selectionStart = e.target.selectionStart;
    const beforeCursor = text.substring(0, selectionStart);
    
    // Check if user has typed `@` followed by any non-whitespace characters
    const atMatch = beforeCursor.match(/@([^\s@]*)$/);

    if (atMatch) {
      const query = atMatch[1].toLowerCase();
      const triggerIdx = selectionStart - atMatch[0].length;
      setSuggestionTriggerIndex(triggerIdx);

      if (autocompleteTimeoutRef.current) {
        clearTimeout(autocompleteTimeoutRef.current);
      }

      autocompleteTimeoutRef.current = setTimeout(() => {
        searchWorkspaceFiles(query);
      }, 150);
    } else {
      setShowSuggestions(false);
    }
  };

  const insertSuggestion = (item: FileItem) => {
    const text = value;
    const startPart = text.substring(0, suggestionTriggerIndex);
    // Use relative path if possible, or just the file name
    const relativePath = rootPath ? item.path.replace(`${rootPath}/`, "") : item.name;
    const completedText = `${startPart}@${relativePath} ` + text.substring(textareaRef.current?.selectionStart || 0);
    
    onChange(completedText);
    setShowSuggestions(false);

    // Reposition cursor
    setTimeout(() => {
      if (textareaRef.current) {
        const cursorPosition = startPart.length + relativePath.length + 2; // +2 for @ and space
        textareaRef.current.setSelectionRange(cursorPosition, cursorPosition);
        textareaRef.current.focus();
      }
    }, 10);
  };

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
          // Avoid duplicates
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
    if (!value.trim() && attachments.length === 0) return;
    onSend(attachments);
    setAttachments([]);
  };

  // Close suggestions on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  return (
    <div className="w-full flex flex-col relative bg-[var(--bg-app)] border border-[var(--border-color)] rounded-xl shadow-md p-2">
      {/* 1. Autocomplete Dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute left-2 bottom-full mb-1 z-[150] w-72 max-h-48 overflow-y-auto bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-xl py-1"
        >
          <div className="px-3 py-1 border-b border-[var(--border-color)]/40 text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
            Autolink Files
          </div>
          {suggestions.map((item, idx) => (
            <button
              key={item.path}
              onClick={() => insertSuggestion(item)}
              className={`w-full text-left px-3 py-1.5 flex items-center justify-between text-xs transition-colors cursor-pointer ${
                idx === selectedIndex
                  ? "bg-[var(--accent-bg)] text-[var(--text-light)]"
                  : "text-[var(--text-normal)] hover:bg-[var(--accent-bg)]/40"
              }`}
            >
              <span className="flex items-center space-x-2 min-w-0">
                {item.isDir ? (
                  <Folder size={12} className="text-violet-400 flex-shrink-0" />
                ) : (
                  <FileText size={12} className="text-zinc-400 flex-shrink-0" />
                )}
                <span className="truncate">{item.name}</span>
              </span>
              <span className="text-[9px] font-mono text-[var(--text-muted)] ml-2 truncate max-w-[120px]">
                {rootPath ? item.path.replace(`${rootPath}/`, "") : ""}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 2. Attachments Preview Drawer */}
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
                className="text-[var(--text-muted)] hover:text-rose-400 transition-colors p-0.5 rounded-full"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 3. Input Text Box Row */}
      <div className="flex items-end space-x-2 min-h-[36px]">
        {/* Upload Button */}
        <button
          type="button"
          onClick={handleAddAttachment}
          disabled={disabled}
          className="p-2 rounded-lg bg-[var(--bg-sidebar)]/50 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-light)] hover:border-[var(--border-active)] transition-all cursor-pointer flex-shrink-0"
          title="Add context file (+)"
        >
          <Plus size={16} />
        </button>

        {/* Scalable Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 bg-transparent border-none outline-none py-1.5 text-xs text-[var(--text-light)] placeholder-[var(--text-muted)] resize-none font-sans leading-relaxed min-h-[20px] select-text focus:ring-0 focus:outline-none"
          rows={1}
          style={{ height: "auto", maxHeight: "200px" }}
        />

        {/* Send or Stop Button */}
        {isStreaming && onStop ? (
          <button
            type="button"
            onClick={onStop}
            className="p-2 rounded-lg bg-rose-600 text-white hover:bg-rose-500 transition-all cursor-pointer flex-shrink-0 shadow-md flex items-center justify-center animate-pulse border-none"
            title="Stop process"
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={disabled || (!value.trim() && attachments.length === 0)}
            className="p-2 rounded-lg bg-[var(--accent-color)] disabled:opacity-40 disabled:hover:bg-[var(--accent-color)] text-white hover:bg-[var(--accent-color)]/80 transition-all cursor-pointer flex-shrink-0 shadow-md flex items-center justify-center"
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </div>
  );
};
