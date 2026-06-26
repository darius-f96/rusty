import { useState, useRef, useCallback, useEffect } from "react";

export const useResizable = (initialWidth = 500) => {
  const [width, setWidth] = useState(initialWidth);
  const isResizing = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(initialWidth);

  const handleMouseMove = useCallback((mouseMoveEvent: MouseEvent) => {
    if (!isResizing.current) return;
    const newWidth = window.innerWidth - mouseMoveEvent.clientX;
    if (newWidth > 300 && newWidth < 1000) {
      widthRef.current = newWidth;
      if (containerRef.current) {
        containerRef.current.style.width = `${newWidth}px`;
      }
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isResizing.current = false;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setWidth(widthRef.current);
  }, [handleMouseMove]);

  const startResizing = useCallback((mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    isResizing.current = true;
    widthRef.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove, handleMouseUp, width]);

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [handleMouseMove, handleMouseUp]);

  return { width, containerRef, startResizing };
};
