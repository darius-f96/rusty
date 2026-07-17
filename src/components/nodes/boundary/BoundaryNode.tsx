import React, { memo, useState, useRef, useEffect, useContext } from "react";
import { Trash2, GripHorizontal, Minus, Plus } from "lucide-react";
import { useViewport } from "@xyflow/react";
import { useWorkspaceStore } from "../../../store";
import { CanvasTabContext } from "../../tabs/canvas/CanvasTabContext";

export const BoundaryNode: React.FC<{ id: string; data: any }> = memo(({ id, data }) => {
  const { tabId } = useContext(CanvasTabContext);
  const { zoom } = useViewport();
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode);
  const updateNodePosition = useWorkspaceStore((state) => state.updateNodePosition);
  const deleteNode = useWorkspaceStore((state) => state.deleteNode);
  const nodePosition = useWorkspaceStore((state) => {
    const ctx = state.canvasContexts[tabId];
    if (!ctx) return { x: 0, y: 0 };
    const n = ctx.nodes.find((nd) => nd.id === id);
    return n ? n.position : { x: 0, y: 0 };
  });

  const [name, setName] = useState(data.name || "Boundary");
  const [isEditingName, setIsEditingName] = useState(false);

  const isResizingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const startDimensions = useRef({
    width: 0,
    height: 0,
    pointerX: 0,
    pointerY: 0,
    nodeX: 0,
    nodeY: 0,
    corner: "se" as ResizeCorner,
  });
  const startDragPos = useRef({ x: 0, y: 0, nodeX: 0, nodeY: 0 });
  const dataRef = useRef(data);
  const posRef = useRef(nodePosition);
  const zoomRef = useRef(zoom);

  type ResizeCorner = "nw" | "ne" | "sw" | "se";

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    posRef.current = nodePosition;
  }, [nodePosition]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    setName(data.name || "Boundary");
  }, [data.name]);

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

  const handleResizeMouseDown = (corner: ResizeCorner) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingRef.current = true;
    startDimensions.current = {
      width: dataRef.current.width || 300,
      height: dataRef.current.height || 200,
      pointerX: e.clientX,
      pointerY: e.clientY,
      nodeX: posRef.current.x,
      nodeY: posRef.current.y,
      corner,
    };
    document.addEventListener("mousemove", handleResizeMouseMove);
    document.addEventListener("mouseup", handleResizeMouseUp);
  };

  const handleResizeMouseMove = (e: MouseEvent) => {
    if (!isResizingRef.current) return;
    const start = startDimensions.current;
    const deltaX = (e.clientX - start.pointerX) / zoomRef.current;
    const deltaY = (e.clientY - start.pointerY) / zoomRef.current;
    const fromLeft = start.corner === "nw" || start.corner === "sw";
    const fromTop = start.corner === "nw" || start.corner === "ne";
    const newWidth = Math.max(150, start.width + (fromLeft ? -deltaX : deltaX));
    const newHeight = Math.max(100, start.height + (fromTop ? -deltaY : deltaY));
    const newX = fromLeft ? start.nodeX + start.width - newWidth : start.nodeX;
    const newY = fromTop ? start.nodeY + start.height - newHeight : start.nodeY;

    updateNodePosition(id, newX, newY);
    updateNode(id, { width: newWidth, height: newHeight });
  };

  const handleResizeMouseUp = () => {
    isResizingRef.current = false;
    document.removeEventListener("mousemove", handleResizeMouseMove);
    document.removeEventListener("mouseup", handleResizeMouseUp);
  };

  const handleDragMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingRef.current = true;
    startDragPos.current = {
      x: e.clientX,
      y: e.clientY,
      nodeX: posRef.current.x,
      nodeY: posRef.current.y
    };
    document.addEventListener("mousemove", handleDragMouseMove);
    document.addEventListener("mouseup", handleDragMouseUp);
  };

  const handleDragMouseMove = (e: MouseEvent) => {
    if (!isDraggingRef.current) return;
    const deltaX = (e.clientX - startDragPos.current.x) / zoomRef.current;
    const deltaY = (e.clientY - startDragPos.current.y) / zoomRef.current;
    const newX = startDragPos.current.nodeX + deltaX;
    const newY = startDragPos.current.nodeY + deltaY;
    updateNodePosition(id, newX, newY);
  };

  const handleDragMouseUp = () => {
    isDraggingRef.current = false;
    document.removeEventListener("mousemove", handleDragMouseMove);
    document.removeEventListener("mouseup", handleDragMouseUp);
  };

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", handleResizeMouseMove);
      document.removeEventListener("mouseup", handleResizeMouseUp);
      document.removeEventListener("mousemove", handleDragMouseMove);
      document.removeEventListener("mouseup", handleDragMouseUp);
    };
  }, []);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteNode(id);
  };

  const width = data.width || 300;
  const height = data.height || 200;
  const fontSize = Math.min(32, Math.max(10, data.fontSize || 12));

  const changeFontSize = (delta: number) => {
    updateNode(id, { fontSize: Math.min(32, Math.max(10, fontSize + delta)) });
  };

  return (
    <div
      className="relative select-none nodrag nopan"
      style={{
        width,
        height,
        pointerEvents: "none",
      }}
    >
      {/* Name label above the boundary (outside the box) */}
      <div
        className="absolute left-0 flex items-center gap-1 group/label"
        style={{ zIndex: 10, pointerEvents: "auto", bottom: `calc(100% + 4px)` }}
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
            className="nodrag nopan bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded px-1.5 py-0.5 font-sans text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)] min-w-32 w-auto"
            style={{ fontSize }}
            autoFocus
          />
        ) : (
          <span
            onDoubleClick={handleNameDoubleClick}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="nodrag nopan font-sans font-semibold text-[var(--text-muted)] bg-[var(--bg-sidebar)]/80 px-1.5 py-0.5 rounded border border-transparent hover:border-[var(--border-color)] cursor-pointer whitespace-nowrap max-w-[min(320px,80vw)] overflow-hidden text-ellipsis"
            style={{ fontSize, lineHeight: 1.25 }}
            title="Double-click to rename"
          >
            {name}
          </span>
        )}
        <div className="flex items-center opacity-0 group-hover/label:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); changeFontSize(-2); }}
            onPointerDown={(e) => e.stopPropagation()}
            className="nodrag nopan p-0.5 text-[var(--text-muted)] hover:text-[var(--text-light)]"
            title="Decrease title size"
          >
            <Minus size={12} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); changeFontSize(2); }}
            onPointerDown={(e) => e.stopPropagation()}
            className="nodrag nopan p-0.5 text-[var(--text-muted)] hover:text-[var(--text-light)]"
            title="Increase title size"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Boundary rectangle - click-through, visual only */}
      <div
        className="w-full h-full border-2 border-dashed border-[var(--color-secondary-border)] bg-[var(--color-secondary-bg)]/[0.08] rounded-lg"
        style={{ pointerEvents: "none" }}
      />

      {/* Drag bar at top edge - the only part that moves the boundary */}
      <div
        className="nodrag nopan absolute top-0 left-0 right-0 h-5 flex items-center justify-center cursor-move rounded-t-lg hover:bg-[var(--color-secondary-bg)] transition-colors group"
        style={{ pointerEvents: "auto" }}
        onMouseDown={handleDragMouseDown}
        onPointerDown={(e) => e.stopPropagation()}
        title="Drag to move boundary"
      >
        <GripHorizontal
          size={14}
          className="text-[var(--color-secondary)] group-hover:text-[var(--color-secondary)] transition-colors pointer-events-none"
        />
      </div>

      {/* Corner resize handles */}
      <div
        className="nodrag nopan resize-handle absolute -top-1.5 -left-1.5 w-4 h-4 cursor-nw-resize flex items-center justify-center"
        onMouseDown={handleResizeMouseDown("nw")}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ pointerEvents: "auto" }}
      >
        <div className="w-2.5 h-2.5 bg-[var(--color-secondary-bg)] rounded-sm border border-[var(--color-secondary-border)] shadow-sm hover:bg-[var(--color-secondary-bg)] transition-colors" />
      </div>
      <div
        className="nodrag nopan resize-handle absolute -top-1.5 -right-1.5 w-4 h-4 cursor-ne-resize flex items-center justify-center"
        onMouseDown={handleResizeMouseDown("ne")}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ pointerEvents: "auto" }}
      >
        <div className="w-2.5 h-2.5 bg-[var(--color-secondary-bg)] rounded-sm border border-[var(--color-secondary-border)] shadow-sm hover:bg-[var(--color-secondary-bg)] transition-colors" />
      </div>
      <div
        className="nodrag nopan resize-handle absolute -bottom-1.5 -left-1.5 w-4 h-4 cursor-sw-resize flex items-center justify-center"
        onMouseDown={handleResizeMouseDown("sw")}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ pointerEvents: "auto" }}
      >
        <div className="w-2.5 h-2.5 bg-[var(--color-secondary-bg)] rounded-sm border border-[var(--color-secondary-border)] shadow-sm hover:bg-[var(--color-secondary-bg)] transition-colors" />
      </div>
      <div
        className="nodrag nopan resize-handle absolute -bottom-1.5 -right-1.5 w-4 h-4 cursor-se-resize flex items-center justify-center"
        onMouseDown={handleResizeMouseDown("se")}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ pointerEvents: "auto" }}
      >
        <div className="w-2.5 h-2.5 bg-[var(--color-secondary-bg)] rounded-sm border border-[var(--color-secondary-border)] shadow-sm hover:bg-[var(--color-secondary-bg)] transition-colors" />
      </div>

      {/* Delete button */}
      <button
        onClick={handleDelete}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className="nodrag nopan absolute -top-2.5 -right-2.5 w-5 h-5 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-full flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--color-status-danger)] hover:border-[var(--color-status-danger-border)] transition-colors shadow-md z-30 cursor-pointer"
        style={{ pointerEvents: "auto" }}
        title="Delete boundary"
      >
        <Trash2 size={10} />
      </button>
    </div>
  );
});
