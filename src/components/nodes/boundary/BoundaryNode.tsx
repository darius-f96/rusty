import React, { memo, useState, useRef, useEffect } from "react";
import { Trash2, GripHorizontal } from "lucide-react";
import { useWorkspaceStore } from "../../../store";

export const BoundaryNode: React.FC<{ id: string; data: any }> = memo(({ id, data }) => {
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode);
  const deleteNode = useWorkspaceStore((state) => state.deleteNode);

  const [name, setName] = useState(data.name || "Boundary");
  const [isEditingName, setIsEditingName] = useState(false);

  const isResizingRef = useRef(false);
  const startDimensions = useRef({ width: 0, height: 0, x: 0, y: 0 });
  const dataRef = useRef(data);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const handleNameSave = () => {
    setIsEditingName(false);
    if (name !== dataRef.current.name) {
      updateNode(id, { name });
    }
  };

  const handleNameDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditingName(true);
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingRef.current = true;
    startDimensions.current = {
      width: dataRef.current.width || 300,
      height: dataRef.current.height || 200,
      x: e.clientX,
      y: e.clientY
    };
    document.addEventListener("mousemove", handleResizeMouseMove);
    document.addEventListener("mouseup", handleResizeMouseUp);
  };

  const handleResizeMouseMove = (e: MouseEvent) => {
    if (!isResizingRef.current) return;
    const deltaX = e.clientX - startDimensions.current.x;
    const deltaY = e.clientY - startDimensions.current.y;
    const newWidth = Math.max(150, startDimensions.current.width + deltaX);
    const newHeight = Math.max(100, startDimensions.current.height + deltaY);
    updateNode(id, { width: newWidth, height: newHeight });
  };

  const handleResizeMouseUp = () => {
    isResizingRef.current = false;
    document.removeEventListener("mousemove", handleResizeMouseMove);
    document.removeEventListener("mouseup", handleResizeMouseUp);
  };

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", handleResizeMouseMove);
      document.removeEventListener("mouseup", handleResizeMouseUp);
    };
  }, []);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteNode(id);
  };

  const width = data.width || 300;
  const height = data.height || 200;

  return (
    <div
      className="relative select-none"
      style={{
        width,
        height,
        pointerEvents: "none",
      }}
    >
      {/* Name label above the boundary (outside the box) */}
      <div
        className="absolute -top-6 left-0 flex items-center"
        style={{ zIndex: 10, pointerEvents: "auto" }}
      >
        {isEditingName ? (
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={handleNameSave}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleNameSave();
              if (e.key === "Escape") {
                setName(dataRef.current.name || "Boundary");
                setIsEditingName(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded px-1.5 py-0.5 font-sans text-xs text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)] w-32"
            autoFocus
          />
        ) : (
          <span
            onDoubleClick={handleNameDoubleClick}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="nodrag font-sans text-[10px] font-semibold text-[var(--text-muted)] bg-[var(--bg-sidebar)]/80 px-1.5 py-0.5 rounded border border-transparent hover:border-[var(--border-color)] cursor-pointer truncate max-w-[150px]"
            title="Double-click to rename"
          >
            {name}
          </span>
        )}
      </div>

      {/* Boundary rectangle - click-through, visual only */}
      <div
        className="w-full h-full border-2 border-dashed border-violet-400/50 bg-violet-500/[0.08] rounded-lg"
        style={{ pointerEvents: "none" }}
      />

      {/* Drag bar at top edge - this is the only part of the body that captures events for moving */}
      <div
        className="absolute top-0 left-0 right-0 h-5 flex items-center justify-center cursor-move rounded-t-lg hover:bg-violet-500/20 transition-colors group"
        style={{ pointerEvents: "auto" }}
        title="Drag to move boundary"
      >
        <GripHorizontal
          size={14}
          className="text-violet-400/40 group-hover:text-violet-400/80 transition-colors"
        />
      </div>

      {/* Corner resize handles */}
      <div
        className="nodrag resize-handle absolute -top-1.5 -left-1.5 w-4 h-4 cursor-nw-resize flex items-center justify-center"
        onMouseDown={handleResizeMouseDown}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ pointerEvents: "auto" }}
      >
        <div className="w-2.5 h-2.5 bg-violet-300/80 rounded-sm border border-violet-500 shadow-sm hover:bg-violet-200 transition-colors" />
      </div>
      <div
        className="nodrag resize-handle absolute -top-1.5 -right-1.5 w-4 h-4 cursor-ne-resize flex items-center justify-center"
        onMouseDown={handleResizeMouseDown}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ pointerEvents: "auto" }}
      >
        <div className="w-2.5 h-2.5 bg-violet-300/80 rounded-sm border border-violet-500 shadow-sm hover:bg-violet-200 transition-colors" />
      </div>
      <div
        className="nodrag resize-handle absolute -bottom-1.5 -left-1.5 w-4 h-4 cursor-sw-resize flex items-center justify-center"
        onMouseDown={handleResizeMouseDown}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ pointerEvents: "auto" }}
      >
        <div className="w-2.5 h-2.5 bg-violet-300/80 rounded-sm border border-violet-500 shadow-sm hover:bg-violet-200 transition-colors" />
      </div>
      <div
        className="nodrag resize-handle absolute -bottom-1.5 -right-1.5 w-4 h-4 cursor-se-resize flex items-center justify-center"
        onMouseDown={handleResizeMouseDown}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ pointerEvents: "auto" }}
      >
        <div className="w-2.5 h-2.5 bg-violet-300/80 rounded-sm border border-violet-500 shadow-sm hover:bg-violet-200 transition-colors" />
      </div>

      {/* Delete button */}
      <button
        onClick={handleDelete}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className="nodrag absolute -top-2.5 -right-2.5 w-5 h-5 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-full flex items-center justify-center text-[var(--text-muted)] hover:text-rose-400 hover:border-rose-400 transition-colors shadow-md z-30 cursor-pointer"
        style={{ pointerEvents: "auto" }}
        title="Delete boundary"
      >
        <Trash2 size={10} />
      </button>
    </div>
  );
});