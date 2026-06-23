import React from "react";
import { Handle, Position } from "@xyflow/react";
import { Sparkles, AlertCircle, CheckCircle2, Loader2, Cpu } from "lucide-react";
import { useWorkspaceStore } from "../store";

export const TaskNode: React.FC<{ id: string; data: any }> = ({ id, data }) => {
  const updateTaskNode = useWorkspaceStore((state) => state.updateTaskNode);
  const nodeStatus = useWorkspaceStore((state) => state.nodeStatus[id] || "idle");
  const customProviders = useWorkspaceStore((state) => state.customProviders);

  // Collect available models
  const availableModels = customProviders.flatMap((p) => p.models);

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateTaskNode(id, { prompt: e.target.value });
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateTaskNode(id, { model: e.target.value });
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
      {/* Node Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-3 py-2">
        <div className="flex items-center space-x-2">
          <Sparkles size={16} className={nodeStatus === "running" ? "text-indigo-400 animate-spin" : "text-indigo-400"} />
          <span className="font-mono text-sm font-semibold">AI Executor Node</span>
        </div>
        
        {/* Status indicator */}
        <div>
          {nodeStatus === "running" && <Loader2 size={16} className="text-indigo-400 animate-spin" />}
          {nodeStatus === "success" && <CheckCircle2 size={16} className="text-emerald-400" />}
          {nodeStatus === "error" && <AlertCircle size={16} className="text-rose-400" />}
        </div>
      </div>

      {/* Node Content */}
      <div className="p-3 space-y-3">
        {/* Model Selector */}
        <div className="flex items-center space-x-2 bg-zinc-950 px-2 py-1.5 rounded-lg border border-zinc-800">
          <Cpu size={14} className="text-zinc-400" />
          <select
            value={data.model}
            onChange={handleModelChange}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="nodrag w-full bg-transparent text-xs font-mono border-none outline-none text-zinc-300 focus:ring-0 cursor-pointer"
          >
            {availableModels.map((m) => (
              <option key={m.id} value={m.id} className="bg-zinc-950 text-zinc-300">
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {/* Query Prompt Input */}
        <div>
          <label className="block text-[10px] uppercase font-semibold text-zinc-500 mb-1 font-mono">
            Prompt Instructions
          </label>
          <textarea
            value={data.prompt}
            onChange={handlePromptChange}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            placeholder="e.g. Add error logs to standard handlers, optimize map lookups..."
            rows={3}
            className="nodrag w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs font-mono text-gray-300 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 resize-none"
          />
        </div>
      </div>

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Left}
        id="context-in"
        style={{ background: "#6366f1", width: 8, height: 8 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="context-out"
        style={{ background: "#10b981", width: 8, height: 8 }}
      />
    </div>
  );
};
