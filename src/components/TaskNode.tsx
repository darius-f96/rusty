import React, { useState, useRef, useEffect } from "react";
import { Handle, Position } from "@xyflow/react";
import { Sparkles, AlertCircle, CheckCircle2, Loader2, Pencil, Check, Trash2 } from "lucide-react";
import { useWorkspaceStore } from "../store";

export const TaskNode: React.FC<{ id: string; data: any }> = ({ id, data }) => {
  const updateTaskNode = useWorkspaceStore((state) => state.updateTaskNode);
  const nodeStatus = useWorkspaceStore((state) => state.nodeStatus[id] || "idle");
  const deleteNode = useWorkspaceStore((state) => state.deleteNode);
  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(data.name || "AI Executor Node");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync temp name with data changes
  useEffect(() => {
    setTempName(data.name || "AI Executor Node");
  }, [data.name]);

  const isMinimized = !!data.isMinimized;
  const setIsMinimized = (val: boolean) => {
    updateTaskNode(id, { isMinimized: val });
  };

  // Auto-resize the prompt textarea based on content length
  useEffect(() => {
    if (textareaRef.current) {
      if (isMinimized) {
        textareaRef.current.style.height = "76px"; // Capped to roughly 3 rows
      } else {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      }
    }
  }, [data.prompt, isMinimized]);

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateTaskNode(id, { prompt: e.target.value });
  };

  const handleNameSave = () => {
    updateTaskNode(id, { name: tempName });
    setIsEditing(false);
  };

  // Get status configuration
  const statusStyles = {
    idle: { border: "border-[var(--border-color)] bg-[var(--bg-sidebar)] hover:border-[var(--border-active)] shadow-lg" },
    running: { border: "border-[var(--accent-color)] bg-[var(--bg-sidebar)] shadow-[rgba(136,192,208,0.25)] shadow-lg animate-pulse" },
    success: { border: "border-emerald-500/80 bg-[var(--bg-sidebar)] shadow-[rgba(16,185,129,0.15)] shadow-lg" },
    error: { border: "border-rose-500/80 bg-[var(--bg-sidebar)] shadow-[rgba(244,63,94,0.15)] shadow-lg" }
  };

  return (
    <div className={`w-80 rounded-xl border text-[var(--text-normal)] overflow-hidden transition-all duration-300 ${statusStyles[nodeStatus].border}`}>
      {/* Node Header (Draggable surface) */}
      <div className="flex items-center justify-between border-b border-[var(--border-color)] bg-black/15 px-3 py-2 select-none cursor-move">
        <div className="flex items-center space-x-2 flex-1 mr-2 min-w-0">
          <Sparkles size={14} className={nodeStatus === "running" ? "text-[var(--accent-color)] animate-spin flex-shrink-0" : "text-[var(--accent-color)] flex-shrink-0"} />
          
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
              className="nodrag bg-[var(--bg-app)] border border-[var(--border-color)] rounded px-1.5 py-0.5 font-sans text-xs text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)] w-full"
              autoFocus
            />
          ) : (
            <span className="font-sans text-xs font-semibold text-[var(--text-light)] truncate">{data.name || "AI Executor Node"}</span>
          )}
        </div>
        
        <div className="flex items-center space-x-1.5 flex-shrink-0">
          {isEditing ? (
            <button
              onClick={handleNameSave}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag text-emerald-400 hover:text-emerald-300 p-0.5 rounded transition-colors"
            >
              <Check size={13} />
            </button>
          ) : (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="nodrag text-[var(--text-muted)] hover:text-[var(--text-light)] p-0.5 rounded transition-colors"
                title="Rename node"
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteNode(id);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="nodrag text-[var(--text-muted)] hover:text-rose-400 p-0.5 rounded transition-colors"
                title="Delete node"
              >
                <Trash2 size={12} />
              </button>
            </>
          )}

          {/* Status indicator */}
          <div className="flex-shrink-0 pl-1">
            {nodeStatus === "running" && <Loader2 size={14} className="text-[var(--accent-color)] animate-spin" />}
            {nodeStatus === "success" && <CheckCircle2 size={14} className="text-emerald-400" />}
            {nodeStatus === "error" && <AlertCircle size={14} className="text-rose-400" />}
          </div>
        </div>
      </div>

      {/* Node Content */}
      <div className="p-3">
        {/* Query Prompt Input */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-[10px] uppercase font-semibold text-[var(--text-muted)] font-sans">
              Prompt Instructions
            </label>
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag text-[9px] font-sans text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors flex items-center space-x-1 cursor-pointer"
            >
              {isMinimized ? <span>[Expand]</span> : <span>[Minimize]</span>}
            </button>
          </div>
          <textarea
            ref={textareaRef}
            value={data.prompt}
            onChange={handlePromptChange}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            placeholder="e.g. Add error logs to standard handlers, optimize map lookups..."
            className={`nodrag w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs font-sans leading-relaxed text-[var(--text-light)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--border-active)] resize-none ${
              isMinimized ? "overflow-y-auto" : "overflow-hidden"
            }`}
            style={isMinimized ? { height: "76px" } : { minHeight: "60px", height: "auto" }}
          />
        </div>
      </div>

      {/* Handles */}
      {/* Task connections (horizontal: Left & Right) */}
      <Handle
        type="target"
        position={Position.Left}
        id="task-in"
        style={{ background: "#6366f1", width: 14, height: 14, border: "2.5px solid var(--bg-sidebar)" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="task-out"
        style={{ background: "#6366f1", width: 14, height: 14, border: "2.5px solid var(--bg-sidebar)" }}
      />

      {/* Context connections (vertical: Top & Bottom) */}
      <Handle
        type="target"
        position={Position.Top}
        id="context-in-top"
        style={{ background: "#10b981", width: 14, height: 14, border: "2.5px solid var(--bg-sidebar)" }}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="context-in-bottom"
        style={{ background: "#10b981", width: 14, height: 14, border: "2.5px solid var(--bg-sidebar)" }}
      />
    </div>
  );
};
