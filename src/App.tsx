import React, { useState, useRef, useEffect, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { Workspace } from "./components/Workspace";
import { useWorkspaceStore } from "./store";

function App() {
  const devLogs = useWorkspaceStore((state) => state.devLogs);
  const showDevConsole = useWorkspaceStore((state) => state.showDevConsole);
  const setShowDevConsole = useWorkspaceStore((state) => state.setShowDevConsole);
  const clearDevLogs = useWorkspaceStore((state) => state.clearDevLogs);
  const addDevLog = useWorkspaceStore((state) => state.addDevLog);

  const [sidebarWidth, setSidebarWidth] = useState(320);
  const isSidebarDraggingRef = useRef(false);
  const sidebarWidthRef = useRef(320);
  const sidebarElementRef = useRef<HTMLDivElement>(null);
  const consoleScrollRef = useRef<HTMLDivElement>(null);

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
  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
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
    useWorkspaceStore.getState().loadSecureConfig().catch((err) => {
      console.error("Failed to load secure configuration on startup:", err);
    });
  }, []);

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

  // Dev Console Auto Scroll
  useEffect(() => {
    if (showDevConsole && consoleScrollRef.current) {
      consoleScrollRef.current.scrollTop = consoleScrollRef.current.scrollHeight;
    }
  }, [devLogs, showDevConsole]);

  // Global Keyboard Shortcuts (Cmd+W or Ctrl+W to close active tab)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w") {
        e.preventDefault();
        e.stopPropagation();

        const state = useWorkspaceStore.getState();
        const currentActive = state.activeTabId;
        if (currentActive && currentActive !== "canvas") {
          state.closeTab(currentActive);
          console.log(`Shortcut captured: Closed active tab ${currentActive}`);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[var(--bg-app)] text-[var(--text-light)] font-sans">
      {/* 1. Header Bar */}
      <Header />

      {/* 2. Workspace Cards Content Area */}
      <div className="flex-1 flex min-h-0 w-full p-4 pt-2 gap-4 overflow-hidden">
        {/* Sidebar with explorer and icon dock */}
        <Sidebar
          sidebarWidth={sidebarWidth}
          setSidebarWidth={setSidebarWidth}
          onSidebarMouseDown={handleSidebarMouseDown}
          containerRef={sidebarElementRef}
        />

        {/* Main Workspace Card Panel */}
        <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative bg-[var(--bg-editor)] border border-[var(--border-color)] rounded-[20px] shadow-2xl">
          {/* Workspace dynamic tabs and contents */}
          <Workspace />

          {/* Collapsible Bottom Developer Console (Pinned Globally) */}
          <div className={`border-t border-[var(--border-color)] bg-[var(--bg-header)] flex flex-col transition-all duration-300 ${
            showDevConsole ? "h-60" : "h-9"
          } z-10 overflow-hidden font-sans`}>
            {/* Header Bar */}
            <div
              onClick={() => setShowDevConsole(!showDevConsole)}
              className="h-9 px-4 flex items-center justify-between border-b border-[var(--border-color)]/60 bg-[var(--bg-app)]/60 hover:bg-[var(--bg-sidebar)]/20 cursor-pointer select-none text-[11px] font-mono text-[var(--text-muted)] flex-shrink-0"
            >
              <div className="flex items-center space-x-3">
                <span className={`w-2 h-2 rounded-full ${
                  devLogs.some(l => l.type === "error") ? "bg-rose-500 animate-pulse" : "bg-emerald-500"
                }`} />
                <span className="font-bold text-[var(--text-light)] uppercase tracking-wider">Dev Logs Terminal</span>
                <span>
                  ({devLogs.filter(l => l.type === "error").length} Errors, {devLogs.filter(l => l.type === "warn").length} Warnings)
                </span>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearDevLogs();
                  }}
                  className="hover:bg-[var(--bg-app)] text-[var(--text-normal)] hover:text-[var(--text-light)] px-2 py-0.5 rounded text-[10px] uppercase font-bold transition-all border border-[var(--border-color)] hover:border-[var(--border-active)] cursor-pointer"
                >
                  Clear
                </button>
                <span className="text-[10px] text-[var(--text-muted)] font-bold uppercase">
                  {showDevConsole ? "[ Collapse ]" : "[ Expand ]"}
                </span>
              </div>
            </div>

            {/* Outputs Scroll Container */}
            {showDevConsole && (
              <div 
                ref={consoleScrollRef}
                className="flex-1 p-4 font-mono text-[11px] overflow-y-auto space-y-1 bg-black text-zinc-400 select-text selection:bg-indigo-900 selection:text-white"
              >
                {devLogs.length === 0 ? (
                  <span className="text-[var(--text-muted)] select-none">// No dev console logs captured yet.</span>
                ) : (
                  devLogs.map((log) => {
                    const colors = {
                      log: "text-zinc-400",
                      warn: "text-amber-400 font-semibold",
                      error: "text-rose-400 font-bold",
                      system: "text-indigo-400 font-bold"
                    };
                    return (
                      <div key={log.id} className="flex items-start space-x-2 leading-relaxed border-b border-zinc-950 pb-0.5 hover:bg-zinc-900/10">
                        <span className="text-[var(--text-muted)] select-none">[{log.timestamp}]</span>
                        <span className={colors[log.type]}>{log.text}</span>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
