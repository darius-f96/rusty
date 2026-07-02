import React, { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "../store";

interface LocalTerminalProps {
  sessionId: string;
  cwd?: string;
  isActive: boolean;
}

export const LocalTerminal: React.FC<LocalTerminalProps> = ({ sessionId, cwd, isActive }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const isSessionCreatedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!containerRef.current) return;

    // Instantiate XTerm
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: 'Fira Code, Menlo, Monaco, Consolas, "Courier New", monospace',
      theme: {
        background: "#000000",
        foreground: "#cccccc",
        cursor: "#ffffff",
        selectionBackground: "rgba(255, 255, 255, 0.3)",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    let unlisten: (() => void) | null = null;

    const initTerminal = async () => {
      try {
        const terminalCwd = cwd || rootPath;
        
        // Listen to outputs from the backend
        const unsubscribe = await listen("terminal-output", (event) => {
          const payload = event.payload as { session_id: string; data: string };
          if (payload.session_id === sessionId) {
            term.write(payload.data);
          }
        });

        // Listen to process exit notifications
        const unsubscribeExit = await listen("terminal-exit", (event) => {
          const payload = event.payload as { session_id: string };
          if (payload.session_id === sessionId) {
            term.write("\r\n[Process completed]\r\n");
          }
        });

        unlisten = () => {
          unsubscribe();
          unsubscribeExit();
        };

        // Create terminal session in Rust
        const cols = term.cols;
        const rows = term.rows;
        await invoke("create_terminal_session", {
          sessionId,
          cols,
          rows,
          cwd: terminalCwd,
        });
        isSessionCreatedRef.current = true;

        // Handle user input
        term.onData((data) => {
          invoke("write_to_terminal", { sessionId, input: data }).catch((err) => {
            console.error("Failed to write to terminal:", err);
          });
        });

        // Focus the terminal
        if (isActive) {
          term.focus();
        }

      } catch (err: any) {
        term.write(`\r\nError initializing terminal: ${err.message || String(err)}\r\n`);
      }
    };

    initTerminal();

    // Resize observer to handle container size changes
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && terminalRef.current && isSessionCreatedRef.current) {
        fitAddonRef.current.fit();
        const cols = terminalRef.current.cols;
        const rows = terminalRef.current.rows;
        invoke("resize_terminal", { sessionId, cols, rows }).catch((err) => {
          console.error("Failed to resize terminal:", err);
        });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (unlisten) unlisten();
      // Clean up session in Rust backend
      invoke("close_terminal_session", { sessionId }).catch((err) => {
        console.error("Failed to close terminal session:", err);
      });
      term.dispose();
    };
  }, [sessionId, cwd, rootPath]);

  // Recalculate size and focus when tab becomes active
  useEffect(() => {
    if (isActive && terminalRef.current && fitAddonRef.current && isSessionCreatedRef.current) {
      const timer = setTimeout(() => {
        if (fitAddonRef.current && terminalRef.current) {
          fitAddonRef.current.fit();
          const cols = terminalRef.current.cols;
          const rows = terminalRef.current.rows;
          invoke("resize_terminal", { sessionId, cols, rows }).catch((err) => {
            console.error("Failed to resize terminal:", err);
          });
          terminalRef.current.focus();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isActive, sessionId]);

  return (
    <div className="w-full h-full bg-black overflow-hidden p-2">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
};
