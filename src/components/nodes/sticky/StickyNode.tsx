import React, { memo, useState, useRef, useEffect } from "react";
import { Trash2 } from "lucide-react";
import { useWorkspaceStore } from "../../../store";
import { STICKY_COLORS, getNextColor } from "./stickyColors";

export const StickyNode: React.FC<{ id: string; data: any }> = memo(({ id, data }) => {
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode);
  const deleteNode = useWorkspaceStore((state) => state.deleteNode);

  const initialColor = STICKY_COLORS.find((c) => c.name === data.color) || STICKY_COLORS[0];
  const [color, setColor] = useState(initialColor);
  const [content, setContent] = useState(data.content || "");
  const [isEditing, setIsEditing] = useState(false);

  const [width, setWidth] = useState(data.width || 200);
  const [height, setHeight] = useState(data.height || 150);
  const isResizing = useRef(false);
  const startDimensions = useRef({ width: 0, height: 0, x: 0, y: 0 });

  const handleColorSwitch = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextColor = getNextColor(color.name);
    setColor(nextColor);
    updateNode(id, { color: nextColor.name });
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
  };

  const handleContentBlur = () => {
    setIsEditing(false);
    if (content !== data.content) {
      updateNode(id, { content });
    }
  };

  const handleContentFocus = () => {
    setIsEditing(true);
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing.current = true;
    startDimensions.current = {
      width,
      height,
      x: e.clientX,
      y: e.clientY
    };
    document.addEventListener("mousemove", handleResize);
    document.addEventListener("mouseup", stopResize);
  };

  const handleResize = (e: MouseEvent) => {
    if (!isResizing.current) return;
    const deltaX = e.clientX - startDimensions.current.x;
    const deltaY = e.clientY - startDimensions.current.y;
    const newWidth = Math.max(150, startDimensions.current.width + deltaX);
    const newHeight = Math.max(100, startDimensions.current.height + deltaY);
    setWidth(newWidth);
    setHeight(newHeight);
    updateNode(id, { width: newWidth, height: newHeight });
  };

  const stopResize = () => {
    isResizing.current = false;
    document.removeEventListener("mousemove", handleResize);
    document.removeEventListener("mouseup", stopResize);
  };

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", handleResize);
      document.removeEventListener("mouseup", stopResize);
    };
  }, []);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteNode(id);
  };

  return (
    <div
      className={`rounded-lg ${color.bg} shadow-lg overflow-hidden flex flex-col transition-shadow duration-200 hover:shadow-xl`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
      }}
    >
      {/* Header - Color indicator and controls */}
      <div
        className={`${color.headerBg} px-2 py-1.5 flex items-center justify-between select-none cursor-move flex-shrink-0`}
      >
        <div className="flex items-center space-x-1.5">
          <div className="w-3 h-3 rounded-full bg-slate-700/20" />
          <div className="w-2 h-2 rounded-full bg-slate-700/10" />
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={handleColorSwitch}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="nodrag w-4 h-4 rounded-full bg-slate-700/20 hover:bg-slate-700/40 transition-colors cursor-pointer"
            title="Switch color"
          />
          <button
            onClick={handleDelete}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="nodrag text-slate-600 hover:text-slate-800 p-0.5 rounded transition-colors cursor-pointer"
            title="Delete note"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Content area */}
      <div
        className="flex-1 p-2 min-h-0 overflow-hidden"
        onClick={handleContentFocus}
      >
        <textarea
          value={content}
          onChange={handleContentChange}
          onBlur={handleContentBlur}
          onFocus={handleContentFocus}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder="Type your note..."
          className={`nodrag w-full h-full bg-transparent resize-none text-slate-700 placeholder-slate-400 font-sans text-xs leading-relaxed focus:outline-none ${
            isEditing ? "cursor-text" : "cursor-pointer"
          }`}
          style={{
            overflowY: isEditing ? "auto" : "hidden",
          }}
          readOnly={!isEditing}
          onClick={(e) => {
            if (!isEditing) {
              e.stopPropagation();
            }
          }}
        />
      </div>

      {/* Resize Handle */}
      <div
        onMouseDown={startResize}
        onPointerDown={(e) => e.stopPropagation()}
        className="nodrag absolute right-0 bottom-0 w-4 h-4 cursor-se-resize flex items-end justify-end p-0.5 z-50 select-none group"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className="text-slate-500 opacity-60 group-hover:opacity-100 transition-opacity"
        >
          <line x1="2" y1="10" x2="10" y2="2" stroke="currentColor" strokeWidth="1.5" />
          <line x1="5" y1="10" x2="10" y2="5" stroke="currentColor" strokeWidth="1.5" />
          <line x1="8" y1="10" x2="10" y2="8" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>
    </div>
  );
});