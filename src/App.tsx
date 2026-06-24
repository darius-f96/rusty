import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { FileTree } from "./components/FileTree";
import { ContextNode } from "./components/ContextNode";
import { TaskNode } from "./components/TaskNode";
import { EditorPanel } from "./components/EditorPanel";
import { SidePane } from "./components/SidePane";
import { FileIcon } from "./services/fileTypeService";
import { useWorkspaceStore, CustomProvider } from "./store";
import { invoke } from "@tauri-apps/api/core";
import { Folder, CheckSquare, Layers, Settings, Plus, X, Cpu, Maximize, ChevronDown } from "lucide-react";

// Register custom nodes for React Flow
const nodeTypes = {
  contextNode: ContextNode,
  taskNode: TaskNode,
};

function App() {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const setRootPath = useWorkspaceStore((state) => state.setRootPath);
  const fileTree = useWorkspaceStore((state) => state.fileTree);
  const setFileTree = useWorkspaceStore((state) => state.setFileTree);
  
  const nodes = useWorkspaceStore((state) => state.nodes);
  const edges = useWorkspaceStore((state) => state.edges);
  const onNodesChange = useWorkspaceStore((state) => state.onNodesChange);
  const onEdgesChange = useWorkspaceStore((state) => state.onEdgesChange);
  const onConnect = useWorkspaceStore((state) => state.onConnect);
  
  const selectedNodeId = useWorkspaceStore((state) => state.selectedNodeId);
  const setSelectedNodeId = useWorkspaceStore((state) => state.setSelectedNodeId);
  const addContextNode = useWorkspaceStore((state) => state.addContextNode);
  const addTaskNode = useWorkspaceStore((state) => state.addTaskNode);
  
  const openTabs = useWorkspaceStore((state) => state.openTabs);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const setActiveTabId = useWorkspaceStore((state) => state.setActiveTabId);
  const closeTab = useWorkspaceStore((state) => state.closeTab);

  const activeTab = openTabs.find((t) => t.id === activeTabId);
  
  const addLog = useWorkspaceStore((state) => state.addLog);
  const clearLogs = useWorkspaceStore((state) => state.clearLogs);
  const setNodeStatus = useWorkspaceStore((state) => state.setNodeStatus);

  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);

  // Dev Console Hooks
  const addDevLog = useWorkspaceStore((state) => state.addDevLog);
  const devLogs = useWorkspaceStore((state) => state.devLogs);
  const showDevConsole = useWorkspaceStore((state) => state.showDevConsole);
  const setShowDevConsole = useWorkspaceStore((state) => state.setShowDevConsole);
  const clearDevLogs = useWorkspaceStore((state) => state.clearDevLogs);

  const [showSettings, setShowSettings] = useState(false);
  const [rfInstance, setRfInstance] = useState<any>(null);
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    screenX: number;
    screenY: number;
  } | null>(null);

  const getCanvasCenter = useCallback(() => {
    if (rfInstance) {
      const reactFlowBounds = document.getElementById("rf-canvas")?.getBoundingClientRect();
      if (reactFlowBounds) {
        const x = reactFlowBounds.left + reactFlowBounds.width / 2;
        const y = reactFlowBounds.top + reactFlowBounds.height / 2;
        return rfInstance.screenToFlowPosition({ x, y });
      }
    }
    return { x: 300, y: 200 };
  }, [rfInstance]);
  const socketRef = useRef<WebSocket | null>(null);
  const consoleScrollRef = useRef<HTMLDivElement>(null);

  const [sidebarWidth, setSidebarWidth] = useState(320);
  const isSidebarDraggingRef = useRef(false);

  const handleSidebarMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isSidebarDraggingRef.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isSidebarDraggingRef.current) return;
      const dx = moveEvent.clientX - startX;
      const newWidth = Math.max(200, Math.min(600, startWidth + dx));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      isSidebarDraggingRef.current = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
  };

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

  // Close context menu & dropdown on outside click
  useEffect(() => {
    const handleGlobalClick = () => {
      setContextMenu(null);
      setNodeMenuOpen(false);
    };
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, []);

  // Settings state for new custom providers
  const [provId, setProvId] = useState("");
  const [provName, setProvName] = useState("");
  const [provUrl, setProvUrl] = useState("http://localhost:11434/v1");
  const [provKey] = useState("");
  const [provModels, setProvModels] = useState("qwen2.5-coder:7b");

  // Load default repository tree if workspace is loaded
  const loadDirectory = async (path: string) => {
    try {
      const tree: any[] = await invoke("get_directory_structure", { rootDir: path });
      setFileTree(tree);
      setRootPath(path);
    } catch (e) {
      console.error("Failed to load project directory structure:", e);
    }
  };

  // Open directory selection dialog
  const handleOpenWorkspace = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Workspace Folder"
      });
      if (selected && typeof selected === "string") {
        console.log("Selected workspace directory:", selected);
        loadDirectory(selected);
      }
    } catch (err: any) {
      console.error("Failed to open directory dialog:", err);
    }
  };

  // Handles dragging files onto React Flow canvas
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    console.log("App: onDragOver triggered. target:", event.target);
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      console.log("App: onDrop triggered. target:", event.target);

      const rawData = event.dataTransfer.getData("text/plain");
      console.log("App: onDrop rawData:", rawData);
      if (!rawData) {
        console.warn("App: onDrop dataTransfer rawData is empty or missing text/plain!");
        return;
      }

      try {
        const dragData = JSON.parse(rawData);
        console.log("App: onDrop parsed JSON dragData:", dragData);
        if (!dragData || !dragData.path || !dragData.name) {
          console.warn("App: dragData missing path or name fields");
          return;
        }

        let position = { x: event.clientX, y: event.clientY };
        if (rfInstance) {
          position = rfInstance.screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          });
          console.log("App: onDrop projected position with rfInstance:", position);
        } else {
          const reactFlowBounds = document.getElementById("rf-canvas")?.getBoundingClientRect();
          if (reactFlowBounds) {
            position = {
              x: event.clientX - reactFlowBounds.left,
              y: event.clientY - reactFlowBounds.top,
            };
            console.log("App: onDrop projected position fallback:", position);
          }
        }

        addContextNode(position.x - 75, position.y - 30, {
          path: dragData.path,
          name: dragData.name,
          isDir: dragData.isDir
        });
      } catch (err) {
        console.log("App canvas drop: Not a JSON string (could be file from Finder).", err);
      }
    },
    [addContextNode, rfInstance]
  );

  // Connection selection callback
  const onNodeClick = (_event: React.MouseEvent, node: any) => {
    if (node.type !== "contextNode") {
      setSelectedNodeId(node.id);
    } else {
      setSelectedNodeId(null);
    }
  };

  const onPaneClick = () => {
    setSelectedNodeId(null);
    setContextMenu(null);
  };

  const onPaneContextMenu = useCallback(
    (event: any) => {
      event.preventDefault();
      const bounds = document.getElementById("rf-canvas")?.getBoundingClientRect();
      if (bounds && rfInstance) {
        setContextMenu({
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
          screenX: event.clientX,
          screenY: event.clientY,
        });
      }
    },
    [rfInstance]
  );

  const handleAddNodeFromContextMenu = useCallback(
    (type: "task" | "context") => {
      if (!contextMenu || !rfInstance) return;
      const flowPosition = rfInstance.screenToFlowPosition({
        x: contextMenu.screenX,
        y: contextMenu.screenY,
      });
      if (type === "task") {
        addTaskNode(flowPosition.x - 75, flowPosition.y - 30);
      } else {
        addContextNode(flowPosition.x - 75, flowPosition.y - 30);
      }
      setContextMenu(null);
    },
    [contextMenu, rfInstance, addTaskNode, addContextNode]
  );

  const onPaneDoubleClick = useCallback((event: React.MouseEvent) => {
    // Only spawn node if we double clicked the canvas pane itself
    const target = event.target as HTMLElement;
    if (!target.classList.contains("react-flow__pane")) return;

    const reactFlowBounds = document.getElementById("rf-canvas")?.getBoundingClientRect();
    if (!reactFlowBounds || !rfInstance) return;

    // Get position relative to canvas bounding box
    const position = rfInstance.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });

    addTaskNode(position.x - 75, position.y - 30);
    console.log("Pane double clicked: Created task node at position", position);
  }, [rfInstance, addTaskNode]);

  // Socket communication runner to coordinate Pi Sidecar edits
  const executeNode = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== "taskNode") return;

    // Detect all Context Nodes connected to this TaskNode
    const connectedEdges = edges.filter((edge) => edge.target === nodeId);
    const inputFiles = connectedEdges
      .map((edge) => nodes.find((n) => n.id === edge.source))
      .filter((n): n is Exclude<typeof n, undefined> => n !== undefined && n.type === "contextNode" && !!n.data.path)
      .map((n) => ({
        path: n.data.path as string,
        name: n.data.fileName as string,
        isDir: !!n.data.isDir
      }));

    console.log("WebSocket [executeNode] starting task execution", { nodeId, inputFiles });

    clearLogs(nodeId);
    setNodeStatus(nodeId, "running");
    addLog(nodeId, `Connecting to local agent sidecar...`);
    addLog(nodeId, `Detected ${inputFiles.length} connected context file(s): ${inputFiles.map(f => f.name).join(", ") || "none"}`);

    // Create WebSocket connection
    const socket = new WebSocket("ws://localhost:4000");
    socketRef.current = socket;

    socket.onopen = () => {
      console.log("WebSocket connection opened to sidecar");
      addLog(nodeId, "Connection established. Dispatching task execution details...");
      
      // Determine if it uses custom provider details
      const provider = customProviders.find(p => p.id === activeCustomProviderId);

      socket.send(
        JSON.stringify({
          type: "execute_node",
          nodeId,
          instructions: node.data.prompt,
          model: node.data.model,
          workspaceRoot: rootPath,
          inputFiles,
          customProvider: provider && provider.id !== "anthropic" && provider.id !== "openai" ? provider : null
        })
      );
    };

    socket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("WebSocket received message:", data);

        if (data.type === "log" && data.nodeId === nodeId) {
          addLog(nodeId, data.message);
          return;
        }

        // Handle VFS read intercept request
        if (data.type === "read_file") {
          try {
            console.log(`WebSocket [read_file] intercept for: ${data.path}`);
            const content: string = await invoke("read_file_vfs", { path: data.path });
            socket.send(JSON.stringify({ type: "read_file_response", requestId: data.requestId, content }));
          } catch (err: any) {
            console.error("WebSocket [read_file] intercept error:", err);
            socket.send(JSON.stringify({ type: "read_file_response", requestId: data.requestId, error: err.message }));
          }
          return;
        }

        // Handle VFS write intercept request
        if (data.type === "write_file") {
          try {
            console.log(`WebSocket [write_file] intercept for: ${data.path}`);
            await invoke("write_file_vfs", { path: data.path, content: data.content });
            socket.send(JSON.stringify({ type: "write_file_response", requestId: data.requestId }));
          } catch (err: any) {
            console.error("WebSocket [write_file] intercept error:", err);
            socket.send(JSON.stringify({ type: "write_file_response", requestId: data.requestId, error: err.message }));
          }
          return;
        }

        if (data.type === "execution_complete" && data.nodeId === nodeId) {
          const modified = data.result?.modified || [];
          console.log("WebSocket [execution_complete] modified files:", modified);
          addLog(nodeId, `AI task execution successfully completed. Modified: ${modified.join(", ") || "none"}`);
          
          // Save modified files to node data so diff viewer can access it
          useWorkspaceStore.getState().updateTaskNode(nodeId, { modifiedFiles: modified });
          
          setNodeStatus(nodeId, "success");
          socket.close();
        }

        if (data.type === "execution_error" && data.nodeId === nodeId) {
          console.error("WebSocket [execution_error]:", data.error);
          addLog(nodeId, `AI Execution Error: ${data.error}`);
          setNodeStatus(nodeId, "error");
          socket.close();
        }
      } catch (err: any) {
        console.error("WebSocket onmessage processing error:", err);
        addLog(nodeId, `Client Error: failed to parse/execute sidecar message: ${err.message}`);
      }
    };

    socket.onerror = (err) => {
      console.error("Sidecar connection failed:", err);
      addLog(nodeId, "Fatal: Agent sidecar connection closed unexpectedly. Ensure Express server is running on port 4000.");
      setNodeStatus(nodeId, "error");
    };

    socket.onclose = () => {
      console.log("WebSocket connection closed");
    };
  };

  // Commit memory changes to physical disk
  const handleApplyChanges = async () => {
    try {
      await invoke("apply_vfs_to_disk");
      alert("Success: In-memory shadow VFS layout flushed to local storage disk.");
      // Reload filesystem hierarchy to reflect new files
      if (rootPath) {
        loadDirectory(rootPath);
      }
    } catch (e: any) {
      alert(`Error applying VFS: ${e}`);
    }
  };

  const handleAddNewProvider = (e: React.FormEvent) => {
    e.preventDefault();
    if (!provId || !provName) return;

    const modelsList = provModels.split(",").map((m) => {
      const id = m.trim();
      return { id, name: id.split("/").pop() || id };
    });

    const newProvider: CustomProvider = {
      id: provId,
      name: provName,
      baseUrl: provUrl,
      apiKey: provKey,
      apiType: "openai-completions",
      models: modelsList
    };

    useWorkspaceStore.getState().addCustomProvider(newProvider);
    alert(`LLM Provider ${provName} registered successfully!`);
    setProvId("");
    setProvName("");
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-app)] text-[var(--text-light)] font-sans">
      {/* 1. Left Sidebar - Navigation & Filetree */}
      <div 
        className="border-r border-[var(--border-color)] bg-[var(--bg-sidebar)]/90 flex flex-col h-full z-10 relative"
        style={{ width: `${sidebarWidth}px` }}
      >
        {/* Workspace selector */}
        <div className="p-4 border-b border-[var(--border-color)] space-y-3">
          <div className="flex items-center justify-between text-zinc-400">
            <div className="flex items-center space-x-2">
              <Folder size={16} className="text-[var(--accent-color)]" />
              <span className="text-xs uppercase tracking-wider font-mono font-bold">Workspace</span>
            </div>
            {rootPath && (
              <span className="text-[9px] text-[var(--text-muted)] font-mono">// Click to select</span>
            )}
          </div>
          <div className="flex space-x-2">
            <input
              type="text"
              readOnly
              placeholder="Click Open to select folder..."
              value={rootPath || ""}
              onClick={handleOpenWorkspace}
              className="flex-1 bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--text-muted)] cursor-pointer select-none focus:outline-none truncate hover:border-[var(--border-active)] transition-colors"
            />
            <button
              onClick={handleOpenWorkspace}
              className="bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 text-white font-mono font-bold text-xs px-3.5 py-1.5 rounded-lg transition-colors shadow-lg cursor-pointer flex items-center"
            >
              Open
            </button>
          </div>
        </div>

        {/* Dynamic explorer sidebar */}
        <div className="flex-1 overflow-auto px-4 py-3 min-w-0">
          <div className="flex items-center justify-between mb-3 text-zinc-400">
            <span className="text-xs uppercase tracking-wider font-mono font-bold">Project Explorer</span>
            <span className="text-[10px] text-[var(--text-muted)] font-mono">// Drag items to canvas</span>
          </div>
          {fileTree.length === 0 ? (
            <div className="text-center py-8 text-xs text-[var(--text-muted)] font-mono">
              No workspace loaded. Enter a valid directory target above.
            </div>
          ) : (
            <FileTree entries={fileTree} />
          )}
        </div>

        {/* dynamic LLM selection/settings configuration */}
        <div className="p-4 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/30">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-full border border-[var(--border-color)] bg-[var(--bg-sidebar)]/40 hover:bg-[var(--bg-sidebar)]/80 text-[var(--text-normal)] text-xs font-mono py-2 rounded-lg flex items-center justify-center space-x-2 transition-all cursor-pointer"
          >
            <Settings size={14} />
            <span>LLM Provider Setup</span>
          </button>
          
          {showSettings && (
            <form onSubmit={handleAddNewProvider} className="mt-3 space-y-2 border-t border-[var(--border-color)] pt-3 text-xs">
              <div>
                <label className="block text-[9px] uppercase font-mono text-[var(--text-muted)] mb-1">Provider ID</label>
                <input
                  type="text"
                  placeholder="e.g. ollama, openrouter"
                  value={provId}
                  onChange={(e) => setProvId(e.target.value)}
                  className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded p-1 text-[11px] font-mono"
                  required
                />
              </div>
              <div>
                <label className="block text-[9px] uppercase font-mono text-[var(--text-muted)] mb-1">Provider Name</label>
                <input
                  type="text"
                  placeholder="e.g. Local Ollama"
                  value={provName}
                  onChange={(e) => setProvName(e.target.value)}
                  className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded p-1 text-[11px] font-mono"
                  required
                />
              </div>
              <div>
                <label className="block text-[9px] uppercase font-mono text-[var(--text-muted)] mb-1">API Base URL</label>
                <input
                  type="text"
                  placeholder="e.g. http://localhost:11434/v1"
                  value={provUrl}
                  onChange={(e) => setProvUrl(e.target.value)}
                  className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded p-1 text-[11px] font-mono"
                />
              </div>
              <div>
                <label className="block text-[9px] uppercase font-mono text-[var(--text-muted)] mb-1">Models (Comma-separated)</label>
                <input
                  type="text"
                  placeholder="e.g. qwen2.5-coder:7b, llama3.1"
                  value={provModels}
                  onChange={(e) => setProvModels(e.target.value)}
                  className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded p-1 text-[11px] font-mono"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 text-white font-mono font-bold py-1 rounded text-xs transition-all cursor-pointer"
              >
                Register Provider
              </button>
            </form>
          )}
        </div>

        {/* Draggable Sidebar Resizer Handle */}
        <div
          onMouseDown={handleSidebarMouseDown}
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--accent-color)]/50 active:bg-[var(--accent-color)] hover:w-1.5 transition-all z-20"
        />
      </div>

      {/* 2. Central Main Panel Workspace */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
        {/* Unified Tab Bar */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-header)] h-9 select-none z-20">
          <div className="flex items-stretch h-full overflow-x-auto scrollbar-none">
            {openTabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  className={`group flex items-center space-x-2 px-4 h-full border-r border-[var(--border-color)] text-[11px] font-mono cursor-pointer select-none transition-all ${
                    isActive
                      ? "bg-[var(--bg-app)] text-[var(--text-light)] font-semibold border-t-2 border-t-[var(--accent-color)]"
                      : "bg-[var(--bg-header)] text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--accent-bg)]"
                  }`}
                >
                  {tab.type === "canvas" && <Layers size={11} className={isActive ? "text-[var(--accent-color)]" : "text-[var(--text-muted)]"} />}
                  {tab.type === "file" && <FileIcon fileName={tab.title} size={11} className="flex-shrink-0" />}
                  {tab.type === "task" && <Cpu size={11} className={isActive ? "text-[var(--accent-color)]" : "text-[var(--text-muted)]"} />}
                  
                  <span className="truncate max-w-[120px]">{tab.title}</span>
                  
                  {tab.id !== "canvas" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                      className="p-0.5 rounded-sm hover:bg-[var(--border-color)]/80 text-[var(--text-muted)] hover:text-[var(--text-light)] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity animate-fade-in"
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          
          {rootPath && (
            <span className="text-[10px] text-[var(--text-muted)] font-mono hidden sm:inline truncate max-w-[250px] px-4">
              VFS: {rootPath.split("/").pop()}
            </span>
          )}
        </div>

        {/* Tab Content Display View */}
        <div className="flex-1 min-h-0 relative bg-[var(--bg-app)]">
          {activeTabId === "canvas" ? (
            <div className="w-full h-full flex relative">
              <div className="flex-1 flex flex-col h-full relative bg-[var(--bg-app)]" id="rf-canvas" onDragOver={onDragOver} onDrop={onDrop}>
                {/* Top Right Small Dropdown */}
                <div className="absolute top-4 right-4 z-10 flex flex-col items-end">
                  <button
                    id="add-node-dropdown-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setNodeMenuOpen(!nodeMenuOpen);
                    }}
                    className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] hover:bg-[var(--bg-header)] text-[var(--text-light)] text-xs font-mono font-semibold px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-all shadow-md hover:border-[var(--border-active)] cursor-pointer nodrag"
                  >
                    <Plus size={14} className="text-[var(--accent-color)]" />
                    <span>Add Node</span>
                    <ChevronDown size={12} className="text-[var(--text-muted)]" />
                  </button>
                  {nodeMenuOpen && (
                    <div className="mt-1 w-44 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-xl py-1 z-20 font-mono text-xs border border-[var(--border-color)]">
                      <button
                        onClick={() => {
                          const center = getCanvasCenter();
                          addTaskNode(center.x - 75, center.y - 30);
                          setNodeMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
                      >
                        <CheckSquare size={13} className="text-[var(--accent-color)]" />
                        <span>Create Task Node</span>
                      </button>
                      <button
                        onClick={() => {
                          const center = getCanvasCenter();
                          addContextNode(center.x - 75, center.y - 30);
                          setNodeMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
                      >
                        <Folder size={13} className="text-emerald-400" />
                        <span>Create Context Node</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Bottom Left Canvas Controls */}
                <div className="absolute bottom-4 left-4 z-10 flex items-center space-x-2">
                  <button
                    onClick={() => rfInstance?.fitView()}
                    className="bg-[var(--bg-sidebar)]/80 border border-[var(--border-color)] hover:bg-[var(--bg-header)] text-[var(--text-normal)] text-xs font-mono font-bold px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-all shadow-md cursor-pointer hover:border-[var(--border-active)]"
                  >
                    <Maximize size={13} className="text-[var(--accent-color)]" />
                    <span>Center</span>
                  </button>

                  <button
                    onClick={handleApplyChanges}
                    className="bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/85 text-white text-xs font-mono font-bold px-3.5 py-1.5 rounded-lg flex items-center space-x-1.5 transition-all shadow-lg glow-btn cursor-pointer"
                  >
                    <CheckSquare size={13} />
                    <span>Apply Pipeline</span>
                  </button>
                </div>

                {/* Custom Floating Context Menu */}
                {contextMenu && (
                  <div
                    style={{
                      top: contextMenu.y,
                      left: contextMenu.x,
                    }}
                    className="absolute bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-2xl py-1 z-30 font-mono text-xs w-48"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => handleAddNodeFromContextMenu("task")}
                      className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
                    >
                      <CheckSquare size={13} className="text-[var(--accent-color)]" />
                      <span>Add Task Node</span>
                    </button>
                    <button
                      onClick={() => handleAddNodeFromContextMenu("context")}
                      className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
                    >
                      <Folder size={13} className="text-emerald-400" />
                      <span>Add Context Node</span>
                    </button>
                  </div>
                )}

                {/* React Flow Board */}
                <div 
                  className="flex-1 w-full relative min-h-0" 
                  onDoubleClick={onPaneDoubleClick}
                  onDragOver={onDragOver}
                  onDrop={onDrop}
                >
                  <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    nodeTypes={nodeTypes}
                    onNodeClick={onNodeClick}
                    onPaneClick={onPaneClick}
                    onPaneContextMenu={onPaneContextMenu}
                    onInit={setRfInstance}
                    onDragOver={onDragOver}
                    onDrop={onDrop}
                    proOptions={{ hideAttribution: true }}
                    maxZoom={1.2}
                    minZoom={0.2}
                    fitView
                    fitViewOptions={{ maxZoom: 1.2 }}
                  >
                    <Background color="#1f2937" gap={16} size={1} variant={BackgroundVariant.Dots} />
                  </ReactFlow>
                </div>
              </div>

              {/* Sliding Inspector Side Pane */}
              {selectedNodeId && (
                <SidePane
                  onClose={() => setSelectedNodeId(null)}
                  onExecuteNode={executeNode}
                />
              )}
            </div>
          ) : (
            <EditorPanel activeTab={activeTab} onExecuteNode={executeNode} />
          )}
        </div>

        {/* Collapsible Bottom Developer Console (Pinned Globally) */}
        <div className={`border-t border-[var(--border-color)] bg-[var(--bg-header)] flex flex-col transition-all duration-300 ${
          showDevConsole ? "h-60" : "h-9"
        } z-10 overflow-hidden font-sans`}>
          {/* Header Bar */}
          <div
            onClick={() => setShowDevConsole(!showDevConsole)}
            className="h-9 px-4 flex items-center justify-between border-b border-[var(--border-color)]/60 bg-[var(--bg-app)]/60 hover:bg-[var(--bg-sidebar)]/20 cursor-pointer select-none text-[11px] font-mono text-[var(--text-muted)]"
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
                <span className="text-[var(--text-muted)] select-none">// No console logs captured yet.</span>
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
  );
}

export default App;
