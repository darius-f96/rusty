import React, { useState } from "react";
import { Globe, Pencil, Check, Trash2, Sparkles, X, Loader2 } from "lucide-react";
import { useWorkspaceStore } from "../store";
import { formatMessageText } from "./SidePane";

export const GlobalChatNode: React.FC<{ id: string; data: any }> = ({ id, data }) => {
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode);
  const deleteNode = useWorkspaceStore((state) => state.deleteNode);
  const globalContextSummary = useWorkspaceStore((state) => state.globalContextSummary);
  const nodeStatus = useWorkspaceStore((state) => state.nodeStatus[id] || "idle");

  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(data.name || "Global Explorer");

  const handleNameSave = () => {
    updateNode(id, { name: tempName });
    setIsEditing(false);
  };

  const statusBorder = {
    idle: "border-[var(--border-color)] hover:border-violet-500/50",
    running: "border-violet-500/70 shadow-[0_0_15px_rgba(139,92,246,0.2)] animate-pulse",
    success: "border-emerald-500/60 shadow-[0_0_10px_rgba(16,185,129,0.1)]",
    error: "border-rose-500/60 shadow-[0_0_10px_rgba(244,63,94,0.1)]"
  };

  return (
    <div className={`w-96 rounded-xl border bg-[var(--bg-sidebar)] text-[var(--text-normal)] overflow-hidden transition-all duration-300 shadow-xl ${statusBorder[nodeStatus]}`}>
      {/* Node Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-color)] bg-gradient-to-r from-violet-600/15 to-transparent px-3 py-2 select-none cursor-move">
        <div className="flex items-center space-x-2 flex-1 mr-2 min-w-0">
          <Globe size={14} className={`text-violet-400 flex-shrink-0 ${nodeStatus === "running" ? "animate-spin" : ""}`} />
          {isEditing ? (
            <input
              type="text"
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNameSave();
                if (e.key === "Escape") setIsEditing(false);
              }}
              className="nodrag bg-[var(--bg-app)] border border-[var(--border-color)] rounded px-1.5 py-0.5 font-sans text-xs text-[var(--text-light)] focus:outline-none focus:border-violet-400 w-full"
              autoFocus
            />
          ) : (
            <span className="font-sans text-xs font-semibold text-[var(--text-light)] truncate">{data.name || "Global Explorer"}</span>
          )}
        </div>

        <div className="flex items-center space-x-1.5 flex-shrink-0">
          {isEditing ? (
            <button
              onClick={handleNameSave}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag text-emerald-400 hover:text-emerald-300 p-0.5 rounded transition-colors cursor-pointer"
            >
              <Check size={13} />
            </button>
          ) : (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="nodrag text-[var(--text-muted)] hover:text-[var(--text-light)] p-0.5 rounded transition-colors cursor-pointer"
                title="Rename node"
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); deleteNode(id); }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="nodrag text-[var(--text-muted)] hover:text-rose-400 p-0.5 rounded transition-colors cursor-pointer"
                title="Delete node"
              >
                <Trash2 size={12} />
              </button>
            </>
          )}

          {/* Status indicator */}
          <div className="flex-shrink-0 pl-1">
            {nodeStatus === "running" && <Loader2 size={14} className="text-violet-400 animate-spin" />}
            {nodeStatus === "success" && <Sparkles size={14} className="text-emerald-400" />}
            {nodeStatus === "error" && <X size={14} className="text-rose-400" />}
          </div>
        </div>
      </div>

      {/* Node Content */}
      <div className="p-3">
        {globalContextSummary ? (
          <div className="flex flex-col space-y-1.5">
            <div className="text-[9px] uppercase font-bold text-violet-400 font-sans tracking-wide">
              Global Context Summary
            </div>
            <div 
              className="nodrag text-[11px] font-sans text-[var(--text-normal)] leading-relaxed max-h-60 overflow-y-auto whitespace-pre-wrap bg-[var(--bg-app)]/50 rounded-lg p-2.5 border border-[var(--border-color)]"
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {formatMessageText(globalContextSummary)}
            </div>
          </div>
        ) : (
          <div className="text-center text-[11px] font-sans text-[var(--text-muted)] py-4 select-none">
            <Globe size={24} className="mx-auto text-violet-500/40 mb-2" />
            <span>Select this node to start codebase exploration in the inspector pane on the left.</span>
          </div>
        )}
      </div>
    </div>
  );
};
