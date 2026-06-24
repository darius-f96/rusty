import React, { useState, useRef, useEffect } from "react";
import { Handle, Position } from "@xyflow/react";
import { Folder, Pencil, Check, X, Info } from "lucide-react";
import { FileIcon } from "../services/fileTypeService";
import { useWorkspaceStore } from "../store";

export const ContextNode: React.FC<{ id: string; data: any }> = ({ id, data }) => {
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode); // Uses the store's update action
  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(data.name || "");
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync temp name with data changes
  useEffect(() => {
    setTempName(data.name || "");
  }, [data.name]);

  // Auto-resize description textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [data.description]);

  const handleNameSave = () => {
    updateNode(id, { name: tempName });
    setIsEditing(false);
  };

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateNode(id, { description: e.target.value });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    console.log("ContextNode: handleDragOver on node", id);
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    console.log("ContextNode: handleDrop on node", id);

    const rawData = e.dataTransfer.getData("text/plain");
    console.log("ContextNode: handleDrop rawData:", rawData);
    if (rawData) {
      try {
        const dragData = JSON.parse(rawData);
        console.log("ContextNode: handleDrop parsed JSON data:", dragData);
        if (dragData && dragData.path && dragData.name) {
          updateNode(id, {
            path: dragData.path,
            fileName: dragData.name,
            isDir: dragData.isDir,
            name: !data.name ? `Context: ${dragData.name}` : data.name
          });
        }
      } catch (err) {
        console.error("ContextNode: handleDrop JSON parse failed:", err);
      }
    }
  };

  const clearAttachedContext = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateNode(id, {
      path: "",
      fileName: "",
      isDir: false,
      name: data.name.startsWith("Context: ") ? "" : data.name
    });
  };

  return (
    <div 
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`w-72 rounded-xl border text-gray-200 backdrop-blur-md overflow-hidden transition-all duration-300 ${
        dragOver 
          ? "border-emerald-500 bg-emerald-950/20 shadow-emerald-950/30 shadow-2xl" 
          : "border-zinc-700/60 bg-zinc-900/90 hover:border-zinc-500/80 shadow-2xl"
      }`}
    >
      {/* Node Header (Draggable surface) */}
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-3 py-2 select-none cursor-move">
        <div className="flex items-center space-x-2 flex-1 mr-2 min-w-0">
          <Info size={14} className="text-emerald-400 flex-shrink-0" />
          
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
            <span className="font-mono text-xs font-semibold text-zinc-300 truncate">{data.name || ""}</span>
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
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag text-zinc-500 hover:text-zinc-300 p-0.5 rounded transition-colors"
            >
              <Pencil size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Node Content */}
      <div className="p-3 space-y-3">
        {/* Attached File/Folder Context */}
        {data.path ? (
          <div className="flex items-center justify-between bg-zinc-950/80 border border-zinc-800 rounded-lg p-2.5 relative group">
            <div className="flex items-center space-x-2.5 min-w-0">
              <span className="flex-shrink-0 text-emerald-400">
                {data.isDir ? <Folder size={15} /> : <FileIcon fileName={data.fileName} size={15} />}
              </span>
              <div className="flex flex-col min-w-0">
                <span className="font-mono text-xs font-semibold text-zinc-200 truncate">{data.fileName}</span>
                <span className="font-mono text-[9px] text-[var(--text-muted)] truncate max-w-[180px]">{data.path}</span>
              </div>
            </div>
            <button
              onClick={clearAttachedContext}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag absolute right-2 top-2 text-zinc-600 hover:text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
              title="Remove context file"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <div className="border border-dashed border-zinc-800 bg-zinc-950/30 rounded-lg py-4 px-3 text-center text-[10px] font-mono text-[var(--text-muted)] select-none">
            Drop file/folder here from sidebar
          </div>
        )}

        {/* Text Context Area */}
        <div>
          <label className="block text-[9px] uppercase font-semibold text-zinc-500 mb-1 font-mono">
            Description Context
          </label>
          <textarea
            ref={textareaRef}
            value={data.description || ""}
            onChange={handlePromptChange}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            placeholder="Type notes or additional text context..."
            className="nodrag w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs font-mono text-zinc-300 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 resize-none overflow-hidden"
            style={{ minHeight: "45px", height: "auto" }}
          />
        </div>
      </div>

      {/* Handles */}
      <Handle
        type="source"
        position={Position.Top}
        id="context-out-top"
        style={{ background: "#10b981", width: 10, height: 10, borderRadius: "50%" }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="context-out-bottom"
        style={{ background: "#10b981", width: 10, height: 10, borderRadius: "50%" }}
      />
    </div>
  );
};
