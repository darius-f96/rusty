import React, { useRef, useEffect, useLayoutEffect } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { FileText, Folder, Loader2, Terminal } from "lucide-react";
import { AgentActivityCard } from "./SubagentActivityPanel";
import styles from "./Chat.module.css";

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
      <div key={msg.id} className={`${styles.message} ${isUser ? styles.userMessage : styles.agentMessage}`}>
        {/* Programmatic Header */}
        <div className={styles.messageHeader}>
          <div className={styles.messageIdentity}>
            <span className={isUser ? styles.userTitle : styles.agentTitle}>[{title}]</span>
            {formattedTime && (
              <span className={styles.time}>{formattedTime}</span>
            )}
          </div>
          <span className={styles.messageType}>
            {isUser ? "Input Query" : "Execution Result"}
          </span>
        </div>

        {/* Content Area */}
        <div className={styles.content}>
          <div>
            <MarkdownRenderer content={msg.content} />
          </div>

          {/* Attachments List */}
          {msg.attachments && msg.attachments.length > 0 && (
            <div className={styles.attachments}>
              <div className={styles.attachmentLabel}>Context Documents:</div>
              <div className={styles.attachmentList}>
                {msg.attachments.map((att) => (
                  <div
                    key={att.path}
                    className={styles.attachment}
                  >
                    {att.isDir ? (
                      <Folder size={11} className="text-[var(--color-status-warning)]" />
                    ) : (
                      <FileText size={11} className="text-[var(--color-status-info)]" />
                    )}
                    <span className={styles.attachmentName} title={att.name}>{att.name}</span>
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
      className={`chat-typography-scope ${styles.container} flex-1 overflow-y-auto ${compact ? "px-1" : "px-4"} py-4 space-y-4 scrollbar-wider min-h-0 min-w-0`}
    >
      {visibleMessages.length === 0 ? (
        <div className={`${styles.empty} h-full flex flex-col items-center justify-center text-center select-none py-12`}>
          <Terminal size={32} className="text-[var(--accent-color)]/30 mb-3 animate-pulse" />
          <p>Agent interface initialized. Ready to receive commands.</p>
        </div>
      ) : (
        visibleMessages.map(renderMessage)
      )}
      {isStreaming && (
        <div className={`${styles.streaming} flex items-center gap-2 px-3 py-2`} aria-live="polite">
          <Loader2 size={14} className="animate-spin text-[var(--accent-color)]" />
          <span>{streamingLabel}</span>
        </div>
      )}
    </div>
  );
};
