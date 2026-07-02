import React, { useState, useRef, useEffect, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { Workspace } from "./components/Workspace";
import { useWorkspaceStore } from "./store";
import { SearchPalette } from "./components/SearchPalette";
import { AlertModal } from "./components/AlertModal";
import { TerminalPanel } from "./components/TerminalPanel";

function App() {
  const addDevLog = useWorkspaceStore((state) => state.addDevLog);
  const initTerminalState = useWorkspaceStore((state) => state.initTerminalState);
  const [searchOpen, setSearchOpen] = useState(false);

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = localStorage.getItem("sidebar_width");
    if (stored) {
      const val = parseInt(stored, 10);
      if (!isNaN(val) && val >= 200 && val <= 600) {
        return val;
      }
    }
    return 320;
  });

  const [isSidebarExplorerOpen, setIsSidebarExplorerOpen] = useState(true);
  const [sidebarView, setSidebarView] = useState<"explorer" | "git">("explorer");
  const [lastSidebarWidth, setLastSidebarWidth] = useState(320);

  useEffect(() => {
    const handleReveal = () => {
      setSidebarView("explorer");
      setIsSidebarExplorerOpen(true);
      if (sidebarWidthRef.current <= 56) {
        const targetWidth = lastSidebarWidth > 56 ? lastSidebarWidth : 320;
        setSidebarWidth(targetWidth);
        sidebarWidthRef.current = targetWidth;
        if (sidebarElementRef.current) {
          sidebarElementRef.current.style.width = `${targetWidth}px`;
        }
      }
    };
    window.addEventListener("reveal-file-in-tree", handleReveal);
    return () => window.removeEventListener("reveal-file-in-tree", handleReveal);
  }, [lastSidebarWidth]);

  const toggleExplorer = useCallback(() => {
    if (!isSidebarExplorerOpen) {
      setSidebarView("explorer");
      setSidebarWidth(lastSidebarWidth);
      setIsSidebarExplorerOpen(true);
    } else if (sidebarView === "explorer") {
      setLastSidebarWidth(sidebarWidth);
      setSidebarWidth(56);
      setIsSidebarExplorerOpen(false);
    } else {
      setSidebarView("explorer");
    }
  }, [isSidebarExplorerOpen, sidebarView, sidebarWidth, lastSidebarWidth]);
  const isSidebarDraggingRef = useRef(false);
  const sidebarWidthRef = useRef(sidebarWidth);
  const sidebarElementRef = useRef<HTMLDivElement>(null);

  const handleSidebarMouseMove = useCallback((moveEvent: MouseEvent) => {
    if (!isSidebarDraggingRef.current) return;
    const startX = (isSidebarDraggingRef as any)._startX as number;
    const startWidth = (isSidebarDraggingRef as any)._startWidth as number;
    const dx = moveEvent.clientX - startX;
    const newWidth = Math.max(200, Math.min(600, startWidth + dx));
    sidebarWidthRef.current = newWidth;
    // Directly mutate DOM — no React re-render
    if (sidebarElementRef.current) {
      sidebarElementRef.current.style.width = `${newWidth}px`;
    }
  }, []);

  const handleSidebarMouseUp = useCallback(() => {
    isSidebarDraggingRef.current = false;
    document.removeEventListener("mousemove", handleSidebarMouseMove);
    document.removeEventListener("mouseup", handleSidebarMouseUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    // Commit the final width to React state once
    setSidebarWidth(sidebarWidthRef.current);
  }, [handleSidebarMouseMove]);

  const handleSidebarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isSidebarDraggingRef.current = true;
    (isSidebarDraggingRef as any)._startX = e.clientX;
    (isSidebarDraggingRef as any)._startWidth = sidebarWidthRef.current;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleSidebarMouseMove);
    document.addEventListener("mouseup", handleSidebarMouseUp);
  }, [handleSidebarMouseMove, handleSidebarMouseUp]);

  // Keep widthRef in sync when state changes (e.g. from collapse/expand buttons)
  // and save active sidebar width if expanded
  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
    if (sidebarWidth > 56) {
      localStorage.setItem("sidebar_width", String(sidebarWidth));
    }
  }, [sidebarWidth]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", handleSidebarMouseMove);
      document.removeEventListener("mouseup", handleSidebarMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [handleSidebarMouseMove, handleSidebarMouseUp]);

  // Load secure configuration on startup
  useEffect(() => {
    useWorkspaceStore.getState().loadSecureConfig().then(() => {
      const rootPath = useWorkspaceStore.getState().rootPath;
      if (rootPath) {
        useWorkspaceStore.getState().loadSkills().catch((err) => {
          console.error("Failed to load skills on startup:", err);
        });
      }
    }).catch((err) => {
      console.error("Failed to load secure configuration on startup:", err);
    });
  }, []);

  // Initialize terminal bar state
  useEffect(() => {
    initTerminalState(import.meta.env.DEV);
  }, [initTerminalState]);

  // Global console/rejection interceptor
  useEffect(() => {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    console.log = (...args: any[]) => {
      originalLog(...args);
      const text = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
      addDevLog("log", text);
    };

    console.error = (...args: any[]) => {
      originalError(...args);
      const text = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
      addDevLog("error", text);
    };

    console.warn = (...args: any[]) => {
      originalWarn(...args);
      const text = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
      addDevLog("warn", text);
    };

    const handleWindowError = (event: ErrorEvent) => {
      addDevLog("error", `Uncaught Error: ${event.message} at ${event.filename}:${event.lineno}`);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const text = reason instanceof Error ? reason.stack || reason.message : String(reason);
      addDevLog("error", `Unhandled Promise Rejection: ${text}`);
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    addDevLog("system", "Developer Terminal capturing logs.");

    return () => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, [addDevLog]);



  // Global Keyboard Shortcuts (Cmd+W or Ctrl+W to close active tab, Cmd+1 to toggle sidebar)
  // Also blocks reload (Cmd/Ctrl+R, F5) and devtools (F12, Cmd/Ctrl+Shift+I/J/C, Cmd/Ctrl+Alt+I)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // Reload (hard + soft)
      if (mod && key === "r") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === "F5") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // DevTools shortcuts
      if (e.key === "F12") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (mod && e.shiftKey && (key === "i" || key === "j" || key === "c")) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (mod && e.altKey && key === "i") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // View-source (Cmd/Ctrl+U)
      if (mod && key === "u") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (mod && key === "w") {
        e.preventDefault();
        e.stopPropagation();

        const state = useWorkspaceStore.getState();
        const activeGroup = state.editorGroups.find((g) => g.id === state.activeGroupId);
        const currentActive = activeGroup?.activeTabId;
        if (currentActive) {
          state.closeTab(currentActive, state.activeGroupId);
          console.log(`Shortcut captured: Closed active tab ${currentActive}`);
        }
      } else if (mod && key === "k") {
        e.preventDefault();
        e.stopPropagation();
        setSearchOpen(true);
      } else if (mod && (e.key === "1" || e.code === "Digit1")) {
        e.preventDefault();
        e.stopPropagation();
        toggleExplorer();
      }
    };

    // Disable the right-click context menu across the entire application so the
    // user cannot access "Reload", "Inspect Element", or view the UI's HTML.
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("contextmenu", handleContextMenu);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [toggleExplorer]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[var(--bg-app)] text-[var(--text-light)] font-sans">
      {/* 1. Header Bar */}
      <Header onSearchOpen={() => setSearchOpen(true)} />

      {/* 2. Workspace Cards Content Area */}
      <div className="flex-1 flex min-h-0 w-full p-3 pt-1 gap-3 overflow-hidden">
        {/* Sidebar with explorer and icon dock */}
        <Sidebar
          sidebarWidth={sidebarWidth}
          setSidebarWidth={setSidebarWidth}
          onSidebarMouseDown={handleSidebarMouseDown}
          containerRef={sidebarElementRef}
          isExplorerOpen={isSidebarExplorerOpen}
          setIsExplorerOpen={setIsSidebarExplorerOpen}
          sidebarView={sidebarView}
          setSidebarView={setSidebarView}
          lastWidth={lastSidebarWidth}
          setLastWidth={setLastSidebarWidth}
        />

        {/* Main Workspace Card Panel */}
        <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative bg-[var(--bg-editor)] border border-[var(--border-color)] rounded-[20px] shadow-2xl">
          {/* Workspace dynamic tabs and contents */}
          <Workspace />

          {/* Collapsible Bottom Terminal Panel (Pinned Globally) */}
          <TerminalPanel />
        </div>
      </div>
      {/* Search Command Palette Overlay */}
      {searchOpen && (
        <SearchPalette onClose={() => setSearchOpen(false)} />
      )}
      {/* Global alert modal (replaces native alert()) */}
      <AlertModal />
    </div>
  );
}

export default App;
