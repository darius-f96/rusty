import React, { useState, useRef, useEffect } from "react";
import { formatMessageText } from "../../services/markdownService";
import { ChevronRight, Terminal, Loader2, FileText, Sparkles, Folder } from "lucide-react";

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
}

export const Chat: React.FC<ChatProps> = ({ messages, isStreaming = false, streamingMessageId = null, compact = false }) => {
  const [collapsedConsoles, setCollapsedConsoles] = useState<Record<string, boolean>>({});
  const consoleContentRef = useRef<HTMLDivElement>(null);

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
        <div key={msg.id} className="mb-4 bg-[var(--bg-app)]/30 rounded-xl border border-[var(--border-color)]/60 overflow-hidden shadow-sm">
          {/* Cosmetised Thinking Header */}
          <button
            onClick={() => toggleConsoleCollapse(msg.id)}
            className="flex items-center justify-between px-3.5 py-2.5 text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--text-light)] transition-all w-full text-left bg-black/10 select-none cursor-pointer"
          >
            <div className="flex items-center space-x-2">
              <ChevronRight
                size={12}
                className={`transition-transform duration-200 text-violet-400 ${isCollapsed ? "" : "rotate-90"}`}
              />
              <Terminal size={12} className="text-violet-400" />
              <span className="uppercase tracking-wider font-semibold text-[10px]">
                {isThisStreaming ? "Agent thinking..." : "Reasoning Process"}
              </span>
            </div>
            {isThisStreaming && (
              <Loader2 size={12} className="animate-spin text-violet-400" />
            )}
          </button>

          {!isCollapsed && (
            <div
              ref={isThisStreaming ? consoleContentRef : null}
              className="px-4 py-3 max-h-60 overflow-y-auto bg-black/20 border-t border-[var(--border-color)]/30"
            >
              <pre className="whitespace-pre-wrap text-[11px] font-mono text-zinc-400 leading-relaxed">
                {msg.content || "// Formulating thoughts..."}
              </pre>
            </div>
          )}
        </div>
      );
    }

    const isUser = msg.role === "user";
    const bgClass = isUser ? "bg-[var(--accent-bg)]/20 border-[var(--accent-color)]/25" : "bg-[var(--bg-sidebar)]/30 border-[var(--border-color)]/80";
    const title = isUser ? "You" : "Axiom Agent";
    const initial = isUser ? "U" : "A";
    const avatarBg = isUser ? "bg-[var(--accent-color)]" : "bg-violet-600";

    return (
      <div key={msg.id} className="mb-4">
        {/* Avatar Header */}
        <div className="flex items-center space-x-2 mb-2">
          <div className={`w-6 h-6 rounded-full ${avatarBg} flex items-center justify-center flex-shrink-0 shadow-md`}>
            {isUser ? (
              <span className="text-[10px] font-bold text-white">{initial}</span>
            ) : (
              <Sparkles size={11} className="text-white" />
            )}
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-mono text-[var(--text-light)] uppercase tracking-wider font-semibold">
              {title}
            </span>
            {msg.timestamp && (
              <span className="text-[8px] font-mono text-[var(--text-muted)] -mt-0.5">
                {msg.timestamp}
              </span>
            )}
          </div>
        </div>

        {/* Bubble Content */}
        <div className={`ml-8 p-3 rounded-2xl border ${bgClass} shadow-sm text-xs leading-relaxed text-[var(--text-normal)] select-text text-left max-w-[95%] overflow-hidden`}>
          {renderMessageContent(msg.content)}

          {/* Attachments List */}
          {msg.attachments && msg.attachments.length > 0 && (
            <div className="mt-3 pt-2 border-t border-[var(--border-color)]/40 flex flex-wrap gap-2">
              {msg.attachments.map((att, idx) => (
                <div
                  key={idx}
                  className="flex items-center space-x-1.5 px-2 py-1 rounded bg-black/20 border border-[var(--border-color)]/40 text-[10px] font-mono text-[var(--text-muted)]"
                >
                  {att.isDir ? <Folder size={10} /> : <FileText size={10} />}
                  <span className="truncate max-w-[150px]">{att.name}</span>
                </div>
              ))}
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
    <div className={`flex-1 overflow-y-auto ${compact ? "px-1" : "px-4"} py-4 space-y-4 scrollbar-wider min-h-0 min-w-0`}>
      {messages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center text-[var(--text-muted)] select-none py-12">
          <Sparkles size={32} className="text-violet-500/40 animate-pulse mb-3" />
          <p className="text-xs font-mono">Start a conversation to begin.</p>
        </div>
      ) : (
        messages.map(renderMessage)
      )}
    </div>
  );
};
