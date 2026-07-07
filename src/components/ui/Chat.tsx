import React, { useState, useRef, useEffect } from "react";
import { formatMessageText } from "../../services/markdownService";
import { ChevronRight, Terminal, Loader2, FileText, Folder } from "lucide-react";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool-result" | "console";
  content: string;
  timestamp: string;
  attachments?: { path: string; name: string; isDir?: boolean }[];
}

interface ChatProps {
  messages: Message[];
  isStreaming?: boolean;
  streamingMessageId?: string | null;
  compact?: boolean;
  scrollKey?: string;
}

export const Chat: React.FC<ChatProps> = ({ messages, isStreaming = false, streamingMessageId = null, compact = false, scrollKey }) => {
  const [collapsedConsoles, setCollapsedConsoles] = useState<Record<string, boolean>>({});
  const consoleContentRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    if (scrollKey && containerRef.current) {
      localStorage.setItem(`chat_scroll_${scrollKey}`, String(containerRef.current.scrollTop));
    }
  };

  useEffect(() => {
    if (scrollKey && containerRef.current) {
      const savedScroll = localStorage.getItem(`chat_scroll_${scrollKey}`);
      if (savedScroll) {
        containerRef.current.scrollTop = parseInt(savedScroll, 10);
      } else {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    }
  }, [scrollKey]);

  const toggleConsoleCollapse = (id: string) => {
    setCollapsedConsoles((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const renderMessageContent = (content: string) => {
    // Parse @ references and format inline markdown
    const parts = content.split(/(@[^\s@]+)/g);
    return parts.map((part, idx) => {
      if (part.startsWith("@") && part.length > 1) {
        const filePath = part.substring(1);
        const fileName = filePath.split("/").pop() || filePath;
        const isDir = !filePath.includes("."); // Simple heuristic for directory
        
        return (
          <span
            key={idx}
            className="inline-flex items-center space-x-1.5 px-1.5 py-0.5 mx-0.5 bg-violet-500/10 border border-violet-500/25 rounded text-violet-300 text-[11px] font-mono align-middle"
          >
            {isDir ? (
              <Folder size={10} className="text-violet-400 flex-shrink-0" />
            ) : (
              <FileText size={10} className="text-violet-400 flex-shrink-0" />
            )}
            <span>{fileName}</span>
          </span>
        );
      }
      return <React.Fragment key={idx}>{formatMessageText(part)}</React.Fragment>;
    });
  };

  const renderMessage = (msg: Message) => {
    if (msg.role === "console") {
      const isCollapsed = collapsedConsoles[msg.id] ?? false;
      const isThisStreaming = isStreaming && streamingMessageId === msg.id;

      return (
        <div key={msg.id} className="mb-4 bg-black/15 border border-[var(--border-color)]/70 rounded-lg overflow-hidden shadow-sm">
          {/* Cosmetised Thinking Header */}
          <button
            onClick={() => toggleConsoleCollapse(msg.id)}
            className="flex items-center justify-between px-3 py-2 text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-light)] transition-all w-full text-left bg-black/25 select-none cursor-pointer border-b border-[var(--border-color)]/30"
          >
            <div className="flex items-center space-x-2">
              <ChevronRight
                size={12}
                className={`transition-transform duration-200 text-[var(--accent-color)] ${isCollapsed ? "" : "rotate-90"}`}
              />
              <Terminal size={12} className="text-[var(--accent-color)]" />
              <span className="uppercase tracking-wider font-semibold">
                {isThisStreaming ? "Agent thinking & tool execution..." : "System Logs & Reasoning"}
              </span>
            </div>
            {isThisStreaming && (
              <Loader2 size={11} className="animate-spin text-[var(--accent-color)]" />
            )}
          </button>

          {!isCollapsed && (
            <div
              ref={isThisStreaming ? consoleContentRef : null}
              className="px-4 py-3 max-h-60 overflow-y-auto bg-black/30 border-t border-[var(--border-color)]/20 font-mono text-[11px] leading-relaxed text-zinc-400"
            >
              <pre className="whitespace-pre-wrap font-mono">
                {msg.content || "// Initializing agent workflow..."}
              </pre>
            </div>
          )}
        </div>
      );
    }

    const isUser = msg.role === "user";
    const title = isUser ? "USER" : "AGENT";
    const borderLeftClass = isUser ? "border-l-[var(--accent-color)]" : "border-l-violet-500/80";
    const headerTextColor = isUser ? "text-[var(--accent-color)]" : "text-violet-400";
    const bgClass = isUser ? "bg-[var(--accent-bg)]/5" : "bg-[var(--bg-sidebar)]/30";

    let formattedTime = "";
    if (msg.timestamp) {
      try {
        const date = new Date(msg.timestamp);
        formattedTime = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      } catch (e) {
        formattedTime = msg.timestamp;
      }
    }

    return (
      <div key={msg.id} className={`mb-5 border border-[var(--border-color)] border-l-4 ${borderLeftClass} rounded-lg ${bgClass} overflow-hidden`}>
        {/* Programmatic Header */}
        <div className="flex items-center justify-between px-3.5 py-2 bg-black/15 border-b border-[var(--border-color)]/20 text-[10px] font-mono select-none">
          <div className="flex items-center space-x-2">
            <span className={`font-bold tracking-wider ${headerTextColor}`}>[{title}]</span>
            {formattedTime && (
              <span className="text-[var(--text-muted)] font-light">{formattedTime}</span>
            )}
          </div>
          <span className="text-[var(--text-muted)] uppercase tracking-wider text-[9px] font-light">
            {isUser ? "Input Query" : "Execution Result"}
          </span>
        </div>

        {/* Content Area */}
        <div className="p-4 text-xs leading-relaxed text-[var(--text-normal)] select-text text-left max-w-full overflow-hidden">
          <div className="prose prose-invert max-w-none">
            {renderMessageContent(msg.content)}
          </div>

          {/* Attachments List */}
          {msg.attachments && msg.attachments.length > 0 && (
            <div className="mt-4 pt-3 border-t border-[var(--border-color)]/20">
              <div className="text-[9px] font-mono text-[var(--text-muted)] mb-2 uppercase tracking-wider font-semibold">Context Documents:</div>
              <div className="flex flex-wrap gap-2">
                {msg.attachments.map((att, idx) => (
                  <div
                    key={idx}
                    className="flex items-center space-x-2 px-2.5 py-1 rounded bg-black/20 border border-[var(--border-color)]/45 text-[10px] font-mono text-[var(--text-normal)] hover:border-[var(--accent-color)]/40 transition-colors"
                  >
                    {att.isDir ? (
                      <Folder size={11} className="text-amber-400/80" />
                    ) : (
                      <FileText size={11} className="text-sky-400/80" />
                    )}
                    <span className="truncate max-w-[200px]">{att.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Scroll active console stream into view
  useEffect(() => {
    if (consoleContentRef.current) {
      consoleContentRef.current.scrollTop = consoleContentRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`flex-1 overflow-y-auto ${compact ? "px-1" : "px-4"} py-4 space-y-4 scrollbar-wider min-h-0 min-w-0`}
    >
      {messages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center text-[var(--text-muted)] select-none py-12">
          <Terminal size={32} className="text-[var(--accent-color)]/30 mb-3 animate-pulse" />
          <p className="text-xs font-mono">Agent interface initialized. Ready to receive commands.</p>
        </div>
      ) : (
        messages.map(renderMessage)
      )}
    </div>
  );
};
