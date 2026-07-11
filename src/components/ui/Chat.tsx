import React, { useState, useRef, useEffect } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";
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
  const [now, setNow] = useState(() => Date.now());
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

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const toggleConsoleCollapse = (id: string) => {
    setCollapsedConsoles((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
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

  const activeDuration = (subagent: SubagentActivity) => {
    const started = Date.parse(subagent.startedAt || subagent.updatedAt || "");
    if (Number.isNaN(started)) return "working";
    const seconds = Math.max(1, Math.floor((now - started) / 1000));
    return seconds < 60 ? `working ${seconds}s` : `working ${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };

  const renderSubagentLogs = (subagent: SubagentActivity, active: boolean) => {
    const logs = subagent.logs || [];
    if (logs.length === 0 && !subagent.outputFile) return null;
    const visibleLogs = logs.slice(-50);

    return (
      <div className="mt-2 rounded bg-black/20 border border-[var(--border-color)]/25 overflow-hidden">
        <div className="px-2 py-1 border-b border-[var(--border-color)]/20 text-[9px] uppercase tracking-wider text-[var(--text-muted)] flex items-center justify-between">
          <span>{subagent.isAggregation ? "Aggregation activity" : "Live tool activity"}</span>
          {logs.length > visibleLogs.length && (
            <span className="normal-case tracking-normal">last {visibleLogs.length} of {logs.length}</span>
          )}
        </div>
        <div className={`px-2 py-1.5 font-mono text-[10px] leading-relaxed text-zinc-400 ${active ? "max-h-52" : "max-h-40"} overflow-y-auto`}>
          {visibleLogs.map((log, idx) => (
            <div key={`${subagent.id}_log_${idx}`} className="whitespace-pre-wrap break-words">
              {log}
            </div>
          ))}
          {subagent.outputFile && (
            <div className="whitespace-pre-wrap break-words text-[var(--text-muted)]">
              Transcript: {subagent.outputFile}
            </div>
          )}
        </div>
      </div>
    );
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
                    <span>Subagents & aggregation</span>
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
                            ) : subagent.isAggregation ? (
                              <Bot size={13} className="mt-0.5 text-emerald-400 flex-shrink-0" />
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
                              {active && (
                                <div className="mt-1.5 flex items-center gap-1.5 rounded bg-violet-500/10 border border-violet-500/20 px-2 py-1 text-[10px] text-violet-200">
                                  <Circle size={7} className="animate-pulse text-violet-400 fill-violet-400 flex-shrink-0" />
                                  <span className="min-w-0 flex-1 break-words">{subagent.activity || "Working on delegated task…"}</span>
                                  <span className="text-[9px] text-violet-300/70 whitespace-nowrap">{activeDuration(subagent)}</span>
                                </div>
                              )}
                              {renderSubagentLogs(subagent, active)}
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
