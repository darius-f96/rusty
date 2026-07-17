import React, { useState, useRef, useEffect, memo, useContext } from "react";
import { Handle, Position } from "@xyflow/react";
import { Sparkles, AlertCircle, CheckCircle2, Loader2, Pencil, Check, Trash2, Octagon, Minimize2, Maximize2, Settings } from "lucide-react";
import { useWorkspaceStore } from "../../store";
import { CanvasTabContext } from "../tabs/canvas/CanvasTabContext";

export const TaskNode: React.FC<{ id: string; data: any }> = memo(({ id, data }) => {
  const { tabId } = useContext(CanvasTabContext);
  const updateTaskNode = useWorkspaceStore((state) => state.updateTaskNode);
  const nodeStatus = useWorkspaceStore((state) => (state.canvasContexts[tabId] || { nodeStatus: {} }).nodeStatus[id] || "idle");
  const deleteNode = useWorkspaceStore((state) => state.deleteNode);
  const setSelectedNodeId = useWorkspaceStore((state) => state.setSelectedNodeId);
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
    running: { border: "border-[var(--accent-color)] bg-[var(--bg-sidebar)] shadow-[0_0_15px_var(--color-focus-ring)] animate-pulse" },
    success: { border: "border-[var(--color-status-success-border)] bg-[var(--bg-sidebar)] shadow-[0_0_15px_var(--color-status-success-bg)]" },
    error: { border: "border-[var(--color-status-danger-border)] bg-[var(--bg-sidebar)] shadow-[0_0_15px_var(--color-status-danger-bg)]" }
  };

  return (
    <div className={`w-80 rounded-lg border text-[var(--text-normal)] overflow-hidden transition-all duration-300 ${statusStyles[nodeStatus].border}`}>
      {/* Node Header (Draggable surface) */}
      <div className="flex items-center justify-between border-b border-[var(--border-color)]/70 bg-[var(--color-surface-sunken)] px-3 py-2 select-none cursor-move">
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
        
        <div className="flex items-center space-x-1 flex-shrink-0">
          {isEditing ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleNameSave();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag text-[var(--color-status-success)] hover:text-[var(--color-status-success)] p-1 hover:bg-[var(--color-surface-elevated)] rounded transition-colors"
            >
              <Check size={14} />
            </button>
          ) : (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMinimized(!isMinimized);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="nodrag text-[var(--text-muted)] hover:text-[var(--text-light)] p-1 hover:bg-[var(--color-surface-elevated)] rounded transition-colors"
                title={isMinimized ? "Expand instructions" : "Minimize instructions"}
              >
                {isMinimized ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="nodrag text-[var(--text-muted)] hover:text-[var(--text-light)] p-1 hover:bg-[var(--color-surface-elevated)] rounded transition-colors"
                title="Rename node"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteNode(id);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="nodrag text-[var(--text-muted)] hover:text-[var(--color-status-danger)] p-1 hover:bg-[var(--color-status-danger-bg)] rounded transition-colors"
                title="Delete node"
              >
                <Trash2 size={14} />
              </button>
              {nodeStatus === "running" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    window.dispatchEvent(new CustomEvent("tasknode-stop-request", { detail: { nodeId: id } }));
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="nodrag text-[var(--color-status-danger)] hover:text-[var(--color-status-danger)] p-1 hover:bg-[var(--color-status-danger-bg)] rounded transition-colors"
                  title="Stop execution"
                >
                  <Octagon size={14} />
                </button>
              )}
            </>
          )}

          {/* Status indicator */}
          <div className="flex-shrink-0 pl-1">
            {nodeStatus === "running" && <Loader2 size={14} className="text-[var(--accent-color)] animate-spin" />}
            {nodeStatus === "success" && <CheckCircle2 size={14} className="text-[var(--color-status-success)]" />}
            {nodeStatus === "error" && <AlertCircle size={14} className="text-[var(--color-status-danger)]" />}
          </div>
        </div>
      </div>

      {/* Node Content */}
      {!isMinimized && (
        <div className="p-3 border-t border-[var(--border-color)]/70">
          {/* Query Prompt Input */}
          <div>
            <label className="block text-[9px] uppercase font-bold text-[var(--text-muted)] font-mono mb-1.5">
              Prompt Instructions
            </label>
            <textarea
              ref={textareaRef}
              value={data.prompt}
              onChange={handlePromptChange}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              placeholder="e.g. Add error logs to standard handlers, optimize map lookups..."
              className="nodrag w-full bg-[var(--color-surface-sunken)] border border-[var(--border-color)]/70 rounded p-2 text-[11px] font-mono leading-relaxed text-[var(--text-light)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--border-active)] resize-none overflow-hidden"
              style={{ minHeight: "60px", height: "auto" }}
            />
          </div>
        </div>
      )}

      {/* Node Footer */}
      <div className="bg-[var(--color-surface-sunken)] px-3 py-1.5 border-t border-[var(--border-color)] flex items-center justify-between text-[10px] select-none">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setSelectedNodeId(id);
            // Programmatically select this node in the Zustand store context
            const store = useWorkspaceStore.getState();
            const canvasContext = store.canvasContexts[tabId];
            if (canvasContext) {
              const updatedNodes = canvasContext.nodes.map((n) => ({
                ...n,
                selected: n.id === id,
              }));
              store.updateCanvasContext(tabId, { nodes: updatedNodes });
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="nodrag text-[var(--text-muted)] hover:text-[var(--accent-color)] hover:scale-110 active:scale-95 transition-all p-0.5 rounded cursor-pointer flex items-center space-x-1 group"
          title="Open Details Pane"
        >
          <Settings size={13} className="group-hover:rotate-45 transition-transform duration-300 pointer-events-none" />
          <span className="font-sans text-[9px] font-semibold pointer-events-none">Open Pane</span>
        </button>
        <span className="text-[9px] font-mono text-[var(--text-muted)] truncate max-w-[150px]">
          {data.model || "default"}
        </span>
      </div>

      {/* Handles */}
      {/* Task connections (horizontal: Left & Right) */}
      <Handle
        type="target"
        position={Position.Left}
        id="task-in"
        style={{ background: "var(--color-primary)", width: 14, height: 14, border: "2.5px solid var(--color-surface-sidebar)" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="task-out"
        style={{ background: "var(--color-primary)", width: 14, height: 14, border: "2.5px solid var(--color-surface-sidebar)" }}
      />

      {/* Context connections (vertical: Top & Bottom) */}
      <Handle
        type="target"
        position={Position.Top}
        id="context-in-top"
        style={{ background: "var(--color-status-success-solid)", width: 14, height: 14, border: "2.5px solid var(--color-surface-sidebar)" }}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="context-in-bottom"
        style={{ background: "var(--color-status-success-solid)", width: 14, height: 14, border: "2.5px solid var(--color-surface-sidebar)" }}
      />
    </div>
  );
});
