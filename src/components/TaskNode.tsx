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

  const [isMinimized, setIsMinimized] = useState(false);

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
    idle: { border: "border-zinc-700/60 bg-zinc-900/90 hover:border-zinc-500/80 shadow-2xl" },
    running: { border: "border-indigo-500 bg-zinc-900/95 shadow-indigo-950/30 shadow-2xl animate-pulse" },
    success: { border: "border-emerald-500/80 bg-zinc-900/95 shadow-emerald-950/20 shadow-2xl" },
    error: { border: "border-rose-500/80 bg-zinc-900/95 shadow-rose-950/20 shadow-2xl" }
  };

  return (
    <div className={`w-80 rounded-xl border text-gray-200 backdrop-blur-md overflow-hidden transition-all duration-300 ${statusStyles[nodeStatus].border}`}>
      {/* Node Header (Draggable surface) */}
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-3 py-2 select-none cursor-move">
        <div className="flex items-center space-x-2 flex-1 mr-2 min-w-0">
          <Sparkles size={14} className={nodeStatus === "running" ? "text-indigo-400 animate-spin flex-shrink-0" : "text-indigo-400 flex-shrink-0"} />
          
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
              className="nodrag bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 font-mono text-xs text-zinc-100 focus:outline-none focus:border-zinc-700 w-full"
              autoFocus
            />
          ) : (
            <span className="font-mono text-xs font-semibold text-zinc-300 truncate">{data.name || "AI Executor Node"}</span>
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
                className="nodrag text-zinc-500 hover:text-zinc-300 p-0.5 rounded transition-colors"
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
                className="nodrag text-zinc-500 hover:text-rose-400 p-0.5 rounded transition-colors"
                title="Delete node"
              >
                <Trash2 size={12} />
              </button>
            </>
          )}

          {/* Status indicator */}
          <div className="flex-shrink-0 pl-1">
            {nodeStatus === "running" && <Loader2 size={14} className="text-indigo-400 animate-spin" />}
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
            <label className="block text-[10px] uppercase font-semibold text-zinc-500 font-mono">
              Prompt Instructions
            </label>
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag text-[9px] font-mono text-zinc-500 hover:text-zinc-300 transition-colors flex items-center space-x-1 cursor-pointer"
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
            className={`nodrag w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs font-mono text-gray-300 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 resize-none ${
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
        style={{ background: "#6366f1", width: 8, height: 8 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="task-out"
        style={{ background: "#6366f1", width: 8, height: 8 }}
      />

      {/* Context connections (vertical: Top & Bottom) */}
      <Handle
        type="target"
        position={Position.Top}
        id="context-in-top"
        style={{ background: "#10b981", width: 10, height: 10, borderRadius: "50%" }}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="context-in-bottom"
        style={{ background: "#10b981", width: 10, height: 10, borderRadius: "50%" }}
      />
    </div>
  );
};
