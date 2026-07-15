import React from "react";
import { AlertTriangle, Shield, Terminal } from "lucide-react";
import type { CommandPermissionDecision, CommandPermissionRequest } from "../../services/commandPermissionService";

interface CommandPermissionDialogProps {
  request: CommandPermissionRequest;
  onDecision: (decision: CommandPermissionDecision) => void;
}

function formatCommandToken(token: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(token) ? token : JSON.stringify(token);
}

export const CommandPermissionDialog: React.FC<CommandPermissionDialogProps> = ({ request, onDecision }) => {
  const commandText = [request.command.program, ...(request.command.args || [])].map(formatCommandToken).join(" ");
  const destructive = request.risk === "destructive";
  return (
    <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="command-permission-title" className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl w-full max-w-xl shadow-2xl overflow-hidden font-mono">
        <div className="px-4 py-3 bg-[var(--bg-header)] border-b border-[var(--border-color)] flex items-center gap-2">
          {destructive ? <AlertTriangle size={17} className="text-rose-400" /> : <Shield size={17} className="text-amber-400" />}
          <span id="command-permission-title" className="text-[var(--text-light)] text-sm font-semibold">Command permission required</span>
          <span className={`ml-auto text-[9px] uppercase px-2 py-0.5 rounded border ${destructive ? "text-rose-300 border-rose-500/40 bg-rose-500/10" : "text-amber-300 border-amber-500/30 bg-amber-500/10"}`}>{request.risk}</span>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-[var(--text-normal)]">The Pi agent wants to execute a command against physical workspace files. It inherits the Sidecar environment and may use configured local or cloud credentials.</p>
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-app)] overflow-hidden">
            <div className="px-3 py-2 border-b border-[var(--border-color)] flex items-center gap-2 text-[10px] text-[var(--text-muted)]"><Terminal size={12} /><span>COMMAND</span></div>
            <pre className="p-3 text-xs text-emerald-300 whitespace-pre-wrap break-all">{commandText}</pre>
          </div>
          <div className="grid grid-cols-[90px_1fr] gap-x-2 gap-y-1 text-[10px]">
            <span className="text-[var(--text-muted)]">Working dir</span><span className="text-[var(--text-normal)] break-all">{request.command.cwd}</span>
            <span className="text-[var(--text-muted)]">Timeout</span><span className="text-[var(--text-normal)]">{Math.round(request.command.timeoutMs / 1000)} seconds</span>
          </div>
          <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">Always allow is memory-only and applies to this exact executable, argument list, working directory, and Pi session. Changed arguments will ask again.</p>
          {destructive && <p className="text-[10px] leading-relaxed text-rose-300">This command may modify infrastructure, remote systems, or project state. Review every argument carefully.</p>}
        </div>
        <div className="px-4 py-3 bg-[var(--bg-header)] border-t border-[var(--border-color)] flex items-center justify-end gap-2">
          <button id="command-permission-deny" onClick={() => onDecision("deny")} className="px-3 py-1.5 border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-light)] rounded-lg text-xs">Deny</button>
          <button id="command-permission-allow-once" onClick={() => onDecision("allow_once")} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold">Allow once</button>
          <button id="command-permission-allow-session" onClick={() => onDecision("allow_session")} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold">Always this session</button>
        </div>
      </div>
    </div>
  );
};
