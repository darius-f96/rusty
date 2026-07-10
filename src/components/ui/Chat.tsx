import React, { useState, useRef, useEffect } from "react";
import { formatMessageText } from "../../services/markdownService";
import { AlertCircle, Bot, CheckCircle2, ChevronRight, Circle, FileText, Folder, Loader2, Terminal } from "lucide-react";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool-result" | "console";
  content: string;
  timestamp: string;
  attachments?: { path: string; name: string; isDir?: boolean }[];
}

export interface SubagentActivity {
  id: string;
  previousId?: string;
  agentId?: string;
  displayName?: string;
  description: string;
  subagentType?: string;
  status: "queued" | "running" | "background" | "completed" | "steered" | "aborted" | "stopped" | "error";
  activity?: string;
  result?: string;
  error?: string;
  toolUses?: number;
  tokens?: string;
  turnCount?: number;
  maxTurns?: number;
  durationMs?: number;
  updatedAt?: string;
}

interface ChatProps {
  messages: Message[];
  isStreaming?: boolean;
  streamingMessageId?: string | null;
  compact?: boolean;
  scrollKey?: string;
  subagents?: SubagentActivity[];
}

export const Chat: React.FC<ChatProps> = ({ messages, isStreaming = false, streamingMessageId = null, compact = false, scrollKey, subagents = [] }) => {
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

  const isSubagentActive = (status: SubagentActivity["status"]) => {
    return status === "queued" || status === "running" || status === "background";
  };

  const subagentStatusLabel = (status: SubagentActivity["status"]) => {
    if (status === "background") return "running";
    if (status === "steered") return "completed";
    return status;
  };

  const subagentStats = (subagent: SubagentActivity) => {
    const parts: string[] = [];
    if (subagent.turnCount) parts.push(subagent.maxTurns ? `${subagent.turnCount}/${subagent.maxTurns} turns` : `${subagent.turnCount} turns`);
    if (subagent.toolUses) parts.push(`${subagent.toolUses} tools`);
    if (subagent.tokens) parts.push(subagent.tokens);
    if (subagent.durationMs) parts.push(`${Math.max(1, Math.round(subagent.durationMs / 1000))}s`);
    return parts.join(" · ");
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
                {isThisStreaming ? "Agent activity & reasoning summary..." : "Agent activity & reasoning summary"}
              </span>
            </div>
            {isThisStreaming && (
              <Loader2 size={11} className="animate-spin text-[var(--accent-color)]" />
            )}
          </button>

          {!isCollapsed && (
            <div className="bg-black/30 border-t border-[var(--border-color)]/20">
              <div
                ref={isThisStreaming ? consoleContentRef : null}
                className="px-4 py-3 max-h-52 overflow-y-auto font-mono text-[11px] leading-relaxed text-zinc-400"
              >
                <pre className="whitespace-pre-wrap font-mono">
                  {msg.content || "// Initializing agent workflow..."}
                </pre>
              </div>
              {subagents.length > 0 && (
                <div className="px-4 py-3 border-t border-[var(--border-color)]/30 bg-black/20">
                  <div className="flex items-center space-x-2 mb-2 text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                    <Bot size={12} className="text-[var(--accent-color)]" />
                    <span>Subagents</span>
                    <span className="text-[9px] normal-case tracking-normal text-[var(--text-muted)]">
                      {subagents.filter((subagent) => isSubagentActive(subagent.status)).length} active · {subagents.filter((subagent) => !isSubagentActive(subagent.status)).length} done
                    </span>
                  </div>
                  <div className="space-y-2">
                    {subagents.map((subagent) => {
                      const active = isSubagentActive(subagent.status);
                      const failed = subagent.status === "error" || subagent.status === "aborted" || subagent.status === "stopped";
                      const stats = subagentStats(subagent);
                      return (
                        <div key={subagent.id} className="rounded border border-[var(--border-color)]/45 bg-black/15 px-3 py-2">
                          <div className="flex items-start gap-2 text-[11px] font-mono">
                            {failed ? (
                              <AlertCircle size={13} className="mt-0.5 text-rose-400 flex-shrink-0" />
                            ) : active ? (
                              <Circle size={13} className="mt-0.5 animate-pulse text-violet-400 flex-shrink-0" />
                            ) : (
                              <CheckCircle2 size={13} className="mt-0.5 text-emerald-400 flex-shrink-0" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <span className={failed ? "text-rose-300" : active ? "text-violet-200" : "text-emerald-300"}>
                                  {subagent.displayName || subagent.subagentType || "Agent"}
                                </span>
                                <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{subagentStatusLabel(subagent.status)}</span>
                                {stats && <span className="text-[9px] text-[var(--text-muted)]">{stats}</span>}
                              </div>
                              <div className="text-[var(--text-normal)] break-words">{subagent.description}</div>
                              {subagent.activity && active && (
                                <div className="text-[10px] text-[var(--text-muted)] mt-1">{subagent.activity}</div>
                              )}
                              {(subagent.result || subagent.error) && !active && (
                                <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-black/25 border border-[var(--border-color)]/30 p-2 text-[10px] leading-relaxed text-zinc-400">
                                  {subagent.error || subagent.result}
                                </pre>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
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
      {messages.filter((message) => message.role !== "console" || message.content.trim()).length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center text-[var(--text-muted)] select-none py-12">
          <Terminal size={32} className="text-[var(--accent-color)]/30 mb-3 animate-pulse" />
          <p className="text-xs font-mono">Agent interface initialized. Ready to receive commands.</p>
        </div>
      ) : (
        messages.filter((message) => message.role !== "console" || message.content.trim()).map(renderMessage)
      )}
    </div>
  );
};
