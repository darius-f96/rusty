import React, { useRef, useEffect, useLayoutEffect } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { FileText, Folder, Loader2, Terminal } from "lucide-react";
import { AgentActivityCard } from "./SubagentActivityPanel";

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
  isAggregation?: boolean;
  status: "queued" | "running" | "background" | "completed" | "steered" | "aborted" | "stopped" | "error";
  activity?: string;
  result?: string;
  error?: string;
  outputFile?: string;
  toolUses?: number;
  tokens?: string;
  turnCount?: number;
  maxTurns?: number;
  durationMs?: number;
  appendLog?: string;
  logs?: string[];
  startedAt?: string;
  updatedAt?: string;
  parentAgentId?: string;
  scope?: string[];
  excludedScope?: string[];
  expectedOutput?: "findings" | "review" | "recommendation";
  evidenceRequired?: boolean;
  timeoutMs?: number;
  queuePosition?: number;
  incorporated?: boolean;
}

interface ChatProps {
  messages: Message[];
  isStreaming?: boolean;
  streamingMessageId?: string | null;
  streamingLabel?: string;
  compact?: boolean;
  scrollKey?: string;
  subagents?: SubagentActivity[];
  /** Keep the view on new activity, but only while the reader is already at the bottom. */
  followLatest?: boolean;
}

export const Chat: React.FC<ChatProps> = ({ messages, isStreaming = false, streamingMessageId = null, streamingLabel = "Model is thinking…", compact = false, scrollKey, subagents = [], followLatest = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;

    // A small tolerance avoids stopping follow mode because of fractional pixel
    // rounding or the scrollbar itself.
    isAtBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight <= 48;
    if (scrollKey) {
      localStorage.setItem(`chat_scroll_${scrollKey}`, String(container.scrollTop));
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
      handleScroll();
    }
  }, [scrollKey]);

  // Agent activity can grow every few seconds. Follow it only for readers who
  // are already viewing the latest activity; never pull someone away from an
  // earlier message they are reading.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!followLatest || !container || !isAtBottomRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [followLatest, messages, subagents, isStreaming]);

  const renderMessage = (msg: Message) => {
    if (msg.role === "console") {
      const isThisStreaming = isStreaming && streamingMessageId === msg.id;
      const messageSubagents = streamingMessageId === msg.id ? subagents : [];
      return (
        <AgentActivityCard
          key={msg.id}
          content={msg.content}
          isStreaming={isThisStreaming}
          subagents={messageSubagents}
        />
      );
    }

    const isUser = msg.role === "user";
    const title = isUser ? "USER" : "AGENT";
    const borderLeftClass = isUser ? "border-l-[var(--accent-color)]" : "border-l-red-700/80";
    const headerTextColor = isUser ? "text-[var(--accent-color)]" : "text-[var(--color-status-danger)]";
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
        <div className="flex items-center justify-between px-3.5 py-2 bg-[var(--color-log-header)] border-b border-[var(--color-border-subtle)] text-[10px] font-mono select-none">
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
          <div className="prose max-w-none">
            <MarkdownRenderer content={msg.content} />
          </div>

          {/* Attachments List */}
          {msg.attachments && msg.attachments.length > 0 && (
            <div className="mt-4 pt-3 border-t border-[var(--border-color)]/20">
              <div className="text-[9px] font-mono text-[var(--text-muted)] mb-2 uppercase tracking-wider font-semibold">Context Documents:</div>
              <div className="flex flex-wrap gap-2">
                {msg.attachments.map((att, idx) => (
                  <div
                    key={idx}
                    className="flex items-center space-x-2 px-2.5 py-1 rounded bg-[var(--color-surface-elevated)] border border-[var(--color-border-subtle)] text-[10px] font-mono text-[var(--color-fg-default)] hover:border-[var(--color-border-focus)] transition-colors"
                  >
                    {att.isDir ? (
                      <Folder size={11} className="text-[var(--color-status-warning)]" />
                    ) : (
                      <FileText size={11} className="text-[var(--color-status-info)]" />
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

  const visibleMessages = messages.filter((message) =>
    message.role !== "console"
    || Boolean(message.content.trim())
    || (streamingMessageId === message.id && (isStreaming || subagents.length > 0))
  );

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`flex-1 overflow-y-auto ${compact ? "px-1" : "px-4"} py-4 space-y-4 scrollbar-wider min-h-0 min-w-0`}
    >
      {visibleMessages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center text-[var(--text-muted)] select-none py-12">
          <Terminal size={32} className="text-[var(--accent-color)]/30 mb-3 animate-pulse" />
          <p className="text-xs font-mono">Agent interface initialized. Ready to receive commands.</p>
        </div>
      ) : (
        visibleMessages.map(renderMessage)
      )}
      {isStreaming && (
        <div className="flex items-center gap-2 px-3 py-2 text-[11px] font-mono text-[var(--text-muted)]" aria-live="polite">
          <Loader2 size={14} className="animate-spin text-[var(--accent-color)]" />
          <span>{streamingLabel}</span>
        </div>
      )}
    </div>
  );
};
