import React, { useRef, useEffect } from "react";
import { X, Plus } from "lucide-react";
import { useWorkspaceStore } from "../store";
import { LocalTerminal } from "./LocalTerminal";

export const TerminalPanel: React.FC = () => {
  const devLogs = useWorkspaceStore((state) => state.devLogs);
  const showDevConsole = useWorkspaceStore((state) => state.showDevConsole);
  const setShowDevConsole = useWorkspaceStore((state) => state.setShowDevConsole);
  const clearDevLogs = useWorkspaceStore((state) => state.clearDevLogs);
  
  const terminalTabs = useWorkspaceStore((state) => state.terminalTabs);
  const activeTerminalTabId = useWorkspaceStore((state) => state.activeTerminalTabId);
  const addTerminalTab = useWorkspaceStore((state) => state.addTerminalTab);
  const closeTerminalTab = useWorkspaceStore((state) => state.closeTerminalTab);
  const setActiveTerminalTabId = useWorkspaceStore((state) => state.setActiveTerminalTabId);

  const consoleScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll dev logs
  useEffect(() => {
    if (showDevConsole && activeTerminalTabId === "dev-logs" && consoleScrollRef.current) {
      consoleScrollRef.current.scrollTop = consoleScrollRef.current.scrollHeight;
    }
  }, [devLogs, showDevConsole, activeTerminalTabId]);

  const activeTab = terminalTabs.find((t) => t.id === activeTerminalTabId);

  return (
    <div
      className={`border-t border-[var(--border-color)] bg-[var(--bg-header)] flex flex-col transition-all duration-300 ${
        showDevConsole ? "h-60" : "h-9"
      } z-10 overflow-hidden font-sans`}
    >
      {/* Header Bar */}
      <div
        onClick={() => setShowDevConsole(!showDevConsole)}
        className="h-9 flex items-center justify-between border-b border-[var(--border-color)]/60 bg-[var(--bg-app)]/60 cursor-pointer select-none text-[11px] font-mono text-[var(--text-muted)] flex-shrink-0 relative"
      >
        {/* Left Section: Tabs + Plus Button */}
        <div className="flex items-stretch h-full min-w-0" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-stretch h-full overflow-x-auto scrollbar-none border-r border-[var(--border-color)]/60">
            {terminalTabs.map((tab) => {
              const isActive = tab.id === activeTerminalTabId;
              return (
                <div
                  key={tab.id}
                  onClick={() => {
                    setActiveTerminalTabId(tab.id);
                    if (!showDevConsole) {
                      setShowDevConsole(true);
                    }
                  }}
                  className={`px-4 flex items-center space-x-1.5 text-[11px] font-mono cursor-pointer select-none border-r border-[var(--border-color)]/40 transition-all relative ${
                    isActive
                      ? "bg-[var(--bg-editor)] text-[var(--text-light)] font-bold border-b border-b-transparent"
                      : "bg-[var(--bg-header)] text-[var(--text-muted)] hover:text-[var(--text-normal)] hover:bg-[var(--accent-bg)]/5"
                  }`}
                >
                  {/* Top line indicator for active tab */}
                  {isActive && (
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-[var(--accent-color)]" />
                  )}

                  {tab.type === "dev-logs" && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full mr-0.5 ${
                        devLogs.some((l) => l.type === "error")
                          ? "bg-rose-500 animate-pulse"
                          : "bg-emerald-500"
                      }`}
                    />
                  )}
                  <span>{tab.name}</span>
                  
                  {tab.type !== "dev-logs" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTerminalTab(tab.id);
                      }}
                      className="hover:bg-[var(--bg-app)] hover:text-[var(--text-light)] rounded-full p-0.5 text-zinc-500 hover:text-zinc-300 transition-all cursor-pointer border-none flex items-center justify-center"
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <button
            onClick={() => addTerminalTab("local")}
            className="px-3 flex items-center hover:bg-[var(--bg-sidebar)]/40 text-[var(--text-muted)] hover:text-[var(--text-light)] transition-all cursor-pointer h-full border-none border-r border-[var(--border-color)]/60 bg-transparent"
            title="New Terminal"
          >
            <Plus size={13} />
          </button>
        </div>

        {/* Right Section: Clear button + Expand/Collapse */}
        <div className="flex items-center space-x-3 px-4" onClick={(e) => e.stopPropagation()}>
          {activeTab?.type === "dev-logs" && (
            <button
              onClick={clearDevLogs}
              className="hover:bg-[var(--bg-app)] text-[var(--text-normal)] hover:text-[var(--text-light)] px-2 py-0.5 rounded text-[10px] uppercase font-bold transition-all border border-[var(--border-color)] hover:border-[var(--border-active)] cursor-pointer bg-transparent"
            >
              Clear
            </button>
          )}
          <button
            onClick={() => setShowDevConsole(!showDevConsole)}
            className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-light)] font-bold uppercase cursor-pointer border-none bg-transparent"
          >
            {showDevConsole ? "[ Collapse ]" : "[ Expand ]"}
          </button>
        </div>
      </div>

      {/* Terminal / Logs Content */}
      {showDevConsole && (
        <div className="flex-1 min-h-0 bg-black relative">
          {terminalTabs.length === 0 ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-[var(--text-muted)] font-mono text-xs select-none">
              <span>No active terminals</span>
              <button
                onClick={() => addTerminalTab("local")}
                className="mt-2 px-3 py-1 bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 text-black font-bold rounded cursor-pointer transition-all border-none"
              >
                Open Terminal
              </button>
            </div>
          ) : (
            terminalTabs.map((tab) => {
              const isActive = tab.id === activeTerminalTabId;
              
              if (tab.type === "dev-logs") {
                return (
                  <div
                    key={tab.id}
                    ref={consoleScrollRef}
                    style={{ display: isActive ? "block" : "none" }}
                    className="w-full h-full p-4 font-mono text-[11px] overflow-y-auto space-y-1 bg-black text-zinc-400 select-text selection:bg-indigo-900 selection:text-white"
                  >
                    {devLogs.length === 0 ? (
                      <span className="text-[var(--text-muted)] select-none">// No dev console logs captured yet.</span>
                    ) : (
                      devLogs.map((log) => {
                        const colors = {
                          log: "text-zinc-400",
                          warn: "text-amber-400 font-semibold",
                          error: "text-rose-400 font-bold",
                          system: "text-indigo-400 font-bold",
                        };
                        return (
                          <div
                            key={log.id}
                            className="flex items-start space-x-2 leading-relaxed border-b border-zinc-950 pb-0.5 hover:bg-zinc-900/10"
                          >
                            <span className="text-[var(--text-muted)] select-none">[{log.timestamp}]</span>
                            <span className={colors[log.type]}>{log.text}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                );
              } else {
                return (
                  <div
                    key={tab.id}
                    style={{ display: isActive ? "block" : "none" }}
                    className="w-full h-full"
                  >
                    <LocalTerminal
                      sessionId={tab.id}
                      cwd={tab.cwd}
                      isActive={isActive}
                    />
                  </div>
                );
              }
            })
          )}
        </div>
      )}
    </div>
  );
};
