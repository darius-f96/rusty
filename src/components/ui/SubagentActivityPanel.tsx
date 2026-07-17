import React, { useEffect, useState } from "react";
import { AlertCircle, Bot, CheckCircle2, ChevronRight, Circle, Loader2, Terminal } from "lucide-react";
import type { SubagentActivity } from "./Chat";

interface SubagentActivityPanelProps {
  subagents: SubagentActivity[];
}

interface AgentActivityCardProps {
  content: string;
  isStreaming?: boolean;
  subagents?: SubagentActivity[];
}

const isSubagentActive = (status: SubagentActivity["status"]) =>
  status === "queued" || status === "running" || status === "background";

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

export const SubagentActivityPanel: React.FC<SubagentActivityPanelProps> = ({ subagents }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  if (subagents.length === 0) return null;

  const activeDuration = (subagent: SubagentActivity) => {
    const started = Date.parse(subagent.startedAt || subagent.updatedAt || "");
    if (Number.isNaN(started)) return "working";
    const seconds = Math.max(1, Math.floor((now - started) / 1000));
    return seconds < 60 ? `working ${seconds}s` : `working ${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };

  const renderSubagentLogs = (subagent: SubagentActivity) => {
    const logs = subagent.logs || [];
    if (logs.length === 0 && !subagent.outputFile) return null;
    const visibleLogs = logs.slice(-4);

    return (
      <div className="mt-2 rounded bg-black/20 border border-[var(--border-color)]/25 overflow-hidden">
        <div className="px-2 py-1 border-b border-[var(--border-color)]/20 text-[9px] uppercase tracking-wider text-[var(--text-muted)] flex items-center justify-between">
          <span>{subagent.isAggregation ? "Aggregation activity" : "Live tool activity"}</span>
          {logs.length > visibleLogs.length && (
            <span className="normal-case tracking-normal">last {visibleLogs.length} of {logs.length}</span>
          )}
        </div>
        <div className="px-2 py-1.5 font-mono text-[10px] leading-relaxed text-zinc-400">
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

  return (
    <div className="px-4 py-3 bg-black/20 border-t border-[var(--border-color)]/30">
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
                  <Circle size={13} className="mt-0.5 animate-pulse text-red-400 flex-shrink-0" />
                ) : subagent.isAggregation ? (
                  <Bot size={13} className="mt-0.5 text-emerald-400 flex-shrink-0" />
                ) : (
                  <CheckCircle2 size={13} className="mt-0.5 text-emerald-400 flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className={failed ? "text-rose-300" : active ? "text-red-200" : "text-emerald-300"}>
                      {subagent.displayName || subagent.subagentType || "Agent"}
                    </span>
                    <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{subagentStatusLabel(subagent.status)}</span>
                    {stats && <span className="text-[9px] text-[var(--text-muted)]">{stats}</span>}
                  </div>
                  <div className="text-[var(--text-normal)] break-words">{subagent.description}</div>
                  {active && (
                    <div className="mt-1.5 flex items-center gap-1.5 rounded bg-red-950/30 border border-red-800/45 px-2 py-1 text-[10px] text-red-200">
                      <Circle size={7} className="animate-pulse text-red-400 fill-red-400 flex-shrink-0" />
                      <span className="min-w-0 flex-1 break-words">{subagent.activity || "Working on delegated task…"}</span>
                      <span className="text-[9px] text-red-300/70 whitespace-nowrap">{activeDuration(subagent)}</span>
                    </div>
                  )}
                  {renderSubagentLogs(subagent)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const AgentActivityCard: React.FC<AgentActivityCardProps> = ({
  content,
  isStreaming = false,
  subagents = [],
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const consoleLines = content.split("\n").filter((line) => line.trim());
  const visibleConsoleLines = consoleLines.slice(-4);

  return (
    <div className="mb-4 bg-black/15 border border-[var(--border-color)]/70 rounded-lg overflow-hidden shadow-sm">
      <button
        onClick={() => setIsCollapsed((collapsed) => !collapsed)}
        className="flex items-center justify-between px-3 py-2 text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-light)] transition-all w-full text-left bg-black/25 select-none cursor-pointer border-b border-[var(--border-color)]/30"
      >
        <div className="flex items-center space-x-2">
          <ChevronRight
            size={12}
            className={`transition-transform duration-200 text-[var(--accent-color)] ${isCollapsed ? "" : "rotate-90"}`}
          />
          <Terminal size={12} className="text-[var(--accent-color)]" />
          <span className="uppercase tracking-wider font-semibold">
            {isStreaming ? "Agent activity & reasoning summary..." : "Agent activity & reasoning summary"}
          </span>
        </div>
        {isStreaming && <Loader2 size={11} className="animate-spin text-[var(--accent-color)]" />}
      </button>

      {!isCollapsed && (
        <div className="bg-black/30 border-t border-[var(--border-color)]/20">
          <div className="px-4 py-3 font-mono text-[11px] leading-relaxed text-zinc-400">
            <pre className="whitespace-pre-wrap font-mono">
              {visibleConsoleLines.join("\n") || "// Initializing agent workflow..."}
            </pre>
          </div>
          {subagents.length > 0 && <SubagentActivityPanel subagents={subagents} />}
        </div>
      )}
    </div>
  );
};
