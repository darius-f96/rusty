import React, { useRef, useEffect, useState } from "react";
import { Send, Sparkles, FileText, Lightbulb } from "lucide-react";
import { CustomSelect } from "../../CustomSelect";
import { useWorkspaceStore } from "../../../store";
import { processResponse } from "../../../services/responseProcessingService";
import { searchService } from "../../../services/searchService";

interface FileReference {
  path: string;
  name: string;
}

interface ExplorerChatContentProps {
  selectedNode: any;
  nodeStatus: string;
  explorerInput: string;
  setExplorerInput: (val: string) => void;
  isSummarizing: boolean;
  handleExplorerSendMessage: () => void;
  handleExplorerSummarize: () => void;
  exploreModel: string;
  summarizeModel: string;
  allAvailableModels: { id: string; name: string }[];
}

const EMPTY_ARRAY: any[] = [];

export const ExplorerChatContent: React.FC<ExplorerChatContentProps> = ({
  selectedNode,
  nodeStatus,
  explorerInput,
  setExplorerInput,
  isSummarizing,
  handleExplorerSendMessage,
  handleExplorerSummarize,
  exploreModel,
  summarizeModel,
  allAvailableModels,
}) => {
  const globalChatHistory = useWorkspaceStore(
    (state) => state.globalChatHistory[selectedNode?.id || ""] || EMPTY_ARRAY
  );
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode);
  const rootPath = useWorkspaceStore((state) => state.rootPath);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [fileReferences, setFileReferences] = useState<FileReference[]>([]);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);

  useEffect(() => {
    if (!selectedNode?.id) return;
    const savedPos = localStorage.getItem(`scroll_pos_${selectedNode.id}`);
    if (savedPos && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = parseInt(savedPos, 10);
    }
  }, [selectedNode?.id]);

  const handleScroll = () => {
    if (!chatScrollRef.current || !selectedNode?.id) return;
    const { scrollTop } = chatScrollRef.current;
    localStorage.setItem(`scroll_pos_${selectedNode.id}`, String(scrollTop));
    const { scrollHeight, clientHeight } = chatScrollRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    isAtBottomRef.current = distanceFromBottom < 100;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setExplorerInput(value);

    const cursorPos = e.target.selectionStart ?? 0;
    const textBeforeCursor = value.substring(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf("@");

    if (atIndex !== -1) {
      const searchTerm = textBeforeCursor.substring(atIndex + 1);
      const hasSpace = searchTerm.includes(" ") || searchTerm.includes("\n");

      if (!hasSpace && searchTerm.length >= 1) {
        setShowFilePicker(true);
        setSelectedFileIndex(0);
        if (autocompleteTimeoutRef.current) {
          clearTimeout(autocompleteTimeoutRef.current);
        }
        autocompleteTimeoutRef.current = setTimeout(() => {
          searchFiles(searchTerm);
        }, 150);
      } else {
        setShowFilePicker(false);
        setFileReferences([]);
        setSelectedFileIndex(0);
      }
    } else {
      setShowFilePicker(false);
      setFileReferences([]);
      setSelectedFileIndex(0);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showFilePicker && fileReferences.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedFileIndex((prev) => (prev + 1) % fileReferences.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedFileIndex((prev) => (prev - 1 + fileReferences.length) % fileReferences.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        insertFileReference(fileReferences[selectedFileIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowFilePicker(false);
        setFileReferences([]);
        setSelectedFileIndex(0);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        insertFileReference(fileReferences[selectedFileIndex]);
        return;
      }
    }
  };

  const searchFiles = async (query: string) => {
    if (!rootPath || query.length < 1) {
      setFileReferences([]);
      return;
    }

    try {
      const results = await searchService.searchProject({
        rootDir: rootPath,
        query: query,
        matchCase: false,
        wholeWord: false,
        isRegex: false,
      });

      const fileMatches = results
        .filter((r) => !r.is_content_match)
        .map((r) => {
          const relPath = rootPath && r.path.startsWith(rootPath) ? r.path.substring(rootPath.length + 1) : r.path;
          return {
            path: relPath,
            name: r.name,
          };
        })
        .slice(0, 10);

      setFileReferences(fileMatches);
      setSelectedFileIndex(0);
    } catch (err) {
      console.error("Failed to search files:", err);
      setFileReferences([]);
    }
  };

  const insertFileReference = (file: FileReference) => {
    const input = inputRef.current;
    if (!input) return;

    const cursorPos = input.selectionStart ?? 0;
    const textBeforeCursor = explorerInput.substring(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf("@");

    const newMessage = explorerInput.substring(0, atIndex) + `@${file.path} ` + explorerInput.substring(cursorPos);
    setExplorerInput(newMessage);
    setShowFilePicker(false);
    setFileReferences([]);
    setSelectedFileIndex(0);
    input.focus();
  };

  const renderMessageContent = (content: string) => {
    const parts = content.split(/(@[^\s@]+)/g);
    return parts.map((part, idx) => {
      if (part.startsWith("@") && part.length > 1) {
        const fileName = part.substring(1).split("/").pop() || part.substring(1);
        return (
          <span
            key={idx}
            className="inline-flex items-center space-x-1 px-1.5 py-0.5 mx-0.5 bg-violet-500/20 border border-violet-500/30 rounded text-violet-300 text-[11px] font-mono align-middle"
          >
            <FileText size={10} className="flex-shrink-0" />
            <span>{fileName}</span>
          </span>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-app)]">
      {/* Chat sub-header with model dropdowns */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 select-none flex-shrink-0">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-[9px] font-mono uppercase text-violet-400 flex-shrink-0">Chat</span>
          <CustomSelect
            value={exploreModel}
            onChange={(val) => updateNode(selectedNode.id, { exploreModel: val })}
            options={allAvailableModels}
            placeholder={allAvailableModels.length === 0 ? (exploreModel || "None") : "Chat model"}
            className="flex-1 min-w-0 nodrag nopan"
            buttonClassName="w-full flex items-center justify-between bg-[var(--bg-app)] text-[var(--text-light)] border border-[var(--border-color)] focus:border-violet-500 rounded px-1.5 py-1 outline-none cursor-pointer text-left transition-all hover:border-violet-500/50 text-[10px] font-mono"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-[9px] font-mono uppercase text-amber-400 flex-shrink-0">Summ</span>
          <CustomSelect
            value={summarizeModel}
            onChange={(val) => updateNode(selectedNode.id, { summarizeModel: val })}
            options={allAvailableModels}
            placeholder={allAvailableModels.length === 0 ? (summarizeModel || "None") : "Summ model"}
            className="flex-1 min-w-0 nodrag nopan"
            buttonClassName="w-full flex items-center justify-between bg-[var(--bg-app)] text-[var(--text-light)] border border-[var(--border-color)] focus:border-amber-500 rounded px-1.5 py-1 outline-none cursor-pointer text-left transition-all hover:border-amber-500/50 text-[10px] font-mono"
          />
        </div>
      </div>

      {/* Explorer Chat History */}
      <div
        ref={chatScrollRef}
        onScroll={handleScroll}
        className="flex-1 p-4 space-y-4 overflow-y-auto text-xs"
      >
        {globalChatHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-[var(--text-muted)] space-y-2 select-none">
            <Lightbulb size={32} className="text-amber-400 mb-2 animate-pulse" />
            <span className="font-semibold text-sm">Task Auditor</span>
            <span className="max-w-[280px]">
              Discuss tasks, suggest changes, and plan approaches. This auditor does not write code - it helps you understand and plan. Type @ to reference files.
            </span>
          </div>
        ) : (
          globalChatHistory.map((msg: any, idx: number) => (
            <div
              key={idx}
              className={`flex flex-col rounded-xl p-3 border space-y-1 w-full ${
                msg.role === "user"
                  ? "bg-[var(--accent-bg)]/20 border-[var(--accent-color)]/30 text-left"
                  : "bg-[var(--bg-sidebar)]/60 border border-[var(--border-color)]/80 text-left"
              }`}
            >
              <span className={`font-mono text-[9px] uppercase font-bold ${
                msg.role === "user" ? "text-[var(--accent-color)]" : "text-violet-400"
              }`}>
                {msg.role === "user" ? "You" : "Auditor"} · {msg.timestamp}
              </span>
              <span className="leading-relaxed whitespace-pre-wrap text-[var(--text-normal)]">
                {msg.role === "user" ? renderMessageContent(msg.content) : processResponse(msg.content)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Explorer Input prompt area */}
      <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 relative">
        <div className="flex items-center space-x-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!showFilePicker) {
                handleExplorerSendMessage();
              }
            }}
            className="flex-1 flex items-center space-x-2 bg-[var(--bg-app)] border border-[var(--border-color)] p-1.5 rounded-lg focus-within:border-[var(--border-active)] relative"
          >
            <input
              ref={inputRef}
              type="text"
              placeholder="Discuss task, plan changes... (type @ to reference files)"
              value={explorerInput}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-transparent border-none outline-none text-xs px-2 py-1 focus:ring-0 text-[var(--text-normal)]"
              disabled={nodeStatus === "running"}
            />
            <button
              type="submit"
              disabled={nodeStatus === "running" || !explorerInput.trim()}
              className="bg-violet-600 hover:bg-violet-500 disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] text-white text-xs font-mono font-bold px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-all cursor-pointer"
            >
              <Send size={12} />
              <span>Send</span>
            </button>
          </form>
          <button
            onClick={handleExplorerSummarize}
            disabled={nodeStatus === "running" || isSummarizing || globalChatHistory.length === 0}
            className="bg-amber-600/90 hover:bg-amber-500/95 disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] text-white text-xs font-mono font-bold px-3 py-2 rounded-md flex items-center space-x-1 transition-all cursor-pointer"
            title="Generate global architectural summary"
          >
            <Sparkles size={12} className={isSummarizing ? "animate-spin" : ""} />
            <span>{isSummarizing ? "Summarize" : "Summarize"}</span>
          </button>
        </div>

        {/* File autocomplete dropdown */}
        {showFilePicker && fileReferences.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-1 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-xl max-h-48 overflow-y-auto z-20">
            {fileReferences.map((file, idx) => (
              <button
                key={file.path}
                onClick={() => insertFileReference(file)}
                onMouseEnter={() => setSelectedFileIndex(idx)}
                className={`w-full text-left px-3 py-2 text-[var(--text-normal)] text-xs font-mono flex items-center space-x-2 border-b border-[var(--border-color)] last:border-b-0 transition-colors ${
                  idx === selectedFileIndex ? "bg-[var(--accent-bg)]" : "hover:bg-[var(--accent-bg)]"
                }`}
              >
                <FileText size={12} className="text-emerald-400 flex-shrink-0" />
                <span className="font-semibold text-[var(--text-light)]">{file.name}</span>
                <span className="text-[var(--text-muted)] truncate">{file.path}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
