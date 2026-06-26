import { useState, useRef, useCallback, useEffect } from "react";

export const useResizable = (initialWidth = 500, storageKey?: string) => {
  const [width, setWidth] = useState(() => {
    if (storageKey) {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const val = parseInt(stored, 10);
        if (!isNaN(val) && val > 200 && val < 1200) {
          return val;
        }
      }
    }
    return initialWidth;
  });

  const isResizing = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(width);

  // Sync widthRef with state changes
  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const animationFrameIdRef = useRef<number | null>(null);

  const handleMouseMove = useCallback((mouseMoveEvent: MouseEvent) => {
    if (!isResizing.current) return;
    const newWidth = window.innerWidth - mouseMoveEvent.clientX;
    if (newWidth > 200 && newWidth < 1200) {
      widthRef.current = newWidth;
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
      animationFrameIdRef.current = requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.style.width = `${widthRef.current}px`;
        }
      });
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isResizing.current = false;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
    }
    setWidth(widthRef.current);
    if (storageKey) {
      localStorage.setItem(storageKey, String(widthRef.current));
    }
  }, [handleMouseMove, storageKey]);

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
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [handleMouseMove, handleMouseUp]);

  return { width, setWidth, containerRef, startResizing };
};
