import React, { useState, useRef, useEffect } from "react";
import { Handle, Position } from "@xyflow/react";
import { Folder, Pencil, Check, X, Info, Trash2 } from "lucide-react";
import { FileIcon } from "../services/fileTypeService";
import { useWorkspaceStore } from "../store";

export const ContextNode: React.FC<{ id: string; data: any }> = ({ id, data }) => {
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode); // Uses the store's update action
  const openTab = useWorkspaceStore((state) => state.openTab);
  const deleteNode = useWorkspaceStore((state) => state.deleteNode);
  const [isEditing, setIsEditing] = useState(false);

  const handleFileClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (data.path && !data.isDir) {
      openTab({
        id: `file_${data.path.replace(/[^a-zA-Z0-9]/g, "_")}`,
        type: "file",
        title: data.fileName,
        key: data.path
      });
    }
  };
  const [tempName, setTempName] = useState(data.name || "");
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync temp name with data changes
  useEffect(() => {
    setTempName(data.name || "");
  }, [data.name]);

  const isMinimized = !!data.isMinimized;
  const setIsMinimized = (val: boolean) => {
    updateNode(id, { isMinimized: val });
  };

  // Auto-resize description textarea
  useEffect(() => {
    if (textareaRef.current) {
      if (isMinimized) {
        textareaRef.current.style.height = "60px"; // Capped to roughly 3 rows
      } else {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      }
    }
  }, [data.description, isMinimized]);

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
      className={`w-72 rounded-xl border text-[var(--text-normal)] overflow-hidden transition-all duration-300 ${
        dragOver 
          ? "border-emerald-500 bg-[var(--bg-sidebar)] shadow-[rgba(16,185,129,0.15)] shadow-lg" 
          : "border-[var(--border-color)] bg-[var(--bg-sidebar)] hover:border-[var(--border-active)] shadow-lg"
      }`}
    >
      {/* Node Header (Draggable surface) */}
      <div className="flex items-center justify-between border-b border-[var(--border-color)] bg-black/15 px-3 py-2 select-none cursor-move">
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
              className="nodrag bg-[var(--bg-app)] border border-[var(--border-color)] rounded px-1.5 py-0.5 font-sans text-xs text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)] w-full"
              autoFocus
            />
          ) : (
            <span className="font-sans text-xs font-semibold text-[var(--text-light)] truncate">{data.name || ""}</span>
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
        </div>
      </div>

      {/* Node Content */}
      <div className="p-3 space-y-3">
        {/* Attached File/Folder Context */}
        {data.path ? (
          <div 
            onClick={handleFileClick}
            className={`flex items-center justify-between bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2.5 relative group ${
              !data.isDir ? "cursor-pointer hover:border-[var(--border-active)] hover:bg-[var(--bg-app)] transition-all" : ""
            }`}
          >
            <div className="flex items-center space-x-2.5 min-w-0">
              <span className="flex-shrink-0 text-emerald-400">
                {data.isDir ? <Folder size={15} /> : <FileIcon fileName={data.fileName} size={15} />}
              </span>
              <div className="flex flex-col min-w-0">
                <span className="font-sans text-xs font-semibold text-[var(--text-light)] truncate">{data.fileName}</span>
                <span className="font-mono text-[9px] text-[var(--text-muted)] truncate max-w-[180px]">{data.path}</span>
              </div>
            </div>
            <button
              onClick={clearAttachedContext}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag absolute right-2 top-2 text-[var(--text-muted)] hover:text-[var(--text-light)] opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
              title="Remove context file"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <div className="border border-dashed border-[var(--border-color)] bg-[var(--bg-app)]/30 rounded-lg py-4 px-3 text-center text-[10px] font-sans text-[var(--text-muted)] select-none">
            Drop file/folder here from sidebar
          </div>
        )}

        {/* Text Context Area */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-[9px] uppercase font-semibold text-[var(--text-muted)] font-sans">
              Description Context
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
            value={data.description || ""}
            onChange={handlePromptChange}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            placeholder="Type notes or additional text context..."
            className={`nodrag w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs font-sans leading-relaxed text-[var(--text-light)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--border-active)] resize-none ${
              isMinimized ? "overflow-y-auto" : "overflow-hidden"
            }`}
            style={isMinimized ? { height: "60px" } : { minHeight: "45px", height: "auto" }}
          />
        </div>
      </div>

      {/* Handles */}
      <Handle
        type="source"
        position={Position.Top}
        id="context-out-top"
        style={{ background: "#10b981", width: 14, height: 14, border: "2.5px solid var(--bg-sidebar)" }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="context-out-bottom"
        style={{ background: "#10b981", width: 14, height: 14, border: "2.5px solid var(--bg-sidebar)" }}
      />
    </div>
  );
};
