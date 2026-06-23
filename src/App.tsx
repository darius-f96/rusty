import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { FileTree } from "./components/FileTree";
import { FileNode } from "./components/FileNode";
import { TaskNode } from "./components/TaskNode";
import { EditorPanel } from "./components/EditorPanel";
import { SidePane } from "./components/SidePane";
import { useWorkspaceStore, CustomProvider } from "./store";
import { invoke } from "@tauri-apps/api/core";
import { Folder, CheckSquare, Layers, Settings, Plus, X, FileCode, Cpu } from "lucide-react";

// Register custom nodes for React Flow
const nodeTypes = {
  fileNode: FileNode,
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
  const addFileNode = useWorkspaceStore((state) => state.addFileNode);
  const addTaskNode = useWorkspaceStore((state) => state.addTaskNode);
  
  const openTab = useWorkspaceStore((state) => state.openTab);
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
  const socketRef = useRef<WebSocket | null>(null);
  const consoleScrollRef = useRef<HTMLDivElement>(null);

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
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const filePath = event.dataTransfer.getData("application/reactflow-file-path");
      const fileName = event.dataTransfer.getData("application/reactflow-file-name");

      if (!filePath || !fileName) return;

      // Get drop position relative to canvas bounding rect
      const reactFlowBounds = document.getElementById("rf-canvas")?.getBoundingClientRect();
      if (!reactFlowBounds) return;

      // Calculate approximate position inside canvas view
      const x = event.clientX - reactFlowBounds.left - 100;
      const y = event.clientY - reactFlowBounds.top - 50;

      addFileNode(filePath, fileName, x, y);
    },
    [addFileNode]
  );

  // Connection selection callback
  const onNodeClick = (_event: React.MouseEvent, node: any) => {
    setSelectedNodeId(node.id);
    
    if (node.type === "fileNode") {
      openTab({
        id: `file_${node.data.path.replace(/[^a-zA-Z0-9]/g, "_")}`,
        type: "file",
        title: node.data.name,
        key: node.data.path
      });
    }
  };

  const onPaneClick = () => {
    setSelectedNodeId(null);
  };

  // Socket communication runner to coordinate Pi Sidecar edits
  const executeNode = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== "taskNode") return;

    // Detect all FileNodes connected to this TaskNode
    const connectedEdges = edges.filter((edge) => edge.target === nodeId);
    const inputFiles = connectedEdges
      .map((edge) => nodes.find((n) => n.id === edge.source))
      .filter((n): n is Exclude<typeof n, undefined> => n !== undefined && n.type === "fileNode")
      .map((n) => ({
        path: n.data.path as string,
        name: n.data.name as string,
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
    <div className="flex h-screen w-screen overflow-hidden bg-[#0d0e12] text-zinc-100 font-sans">
      {/* 1. Left Sidebar - Navigation & Filetree */}
      <div className="w-80 border-r border-zinc-800 bg-[#111318]/90 flex flex-col h-full z-10">
        {/* Workspace selector */}
        <div className="p-4 border-b border-zinc-850 space-y-3">
          <div className="flex items-center justify-between text-zinc-400">
            <div className="flex items-center space-x-2">
              <Folder size={16} className="text-indigo-400" />
              <span className="text-xs uppercase tracking-wider font-mono font-bold">Workspace</span>
            </div>
            {rootPath && (
              <span className="text-[9px] text-zinc-500 font-mono">// Click to select</span>
            )}
          </div>
          <div className="flex space-x-2">
            <input
              type="text"
              readOnly
              placeholder="Click Open to select folder..."
              value={rootPath || ""}
              onClick={handleOpenWorkspace}
              className="flex-1 bg-zinc-950/80 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-zinc-400 cursor-pointer select-none focus:outline-none truncate hover:border-zinc-700 transition-colors"
            />
            <button
              onClick={handleOpenWorkspace}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-mono font-bold text-xs px-3.5 py-1.5 rounded-lg transition-colors shadow-lg cursor-pointer flex items-center"
            >
              Open
            </button>
          </div>
        </div>

        {/* Dynamic explorer sidebar */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3 text-zinc-400">
            <span className="text-xs uppercase tracking-wider font-mono font-bold">Project Explorer</span>
            <span className="text-[10px] text-zinc-500 font-mono">// Drag items to canvas</span>
          </div>
          {fileTree.length === 0 ? (
            <div className="text-center py-8 text-xs text-zinc-600 font-mono">
              No workspace loaded. Enter a valid directory target above.
            </div>
          ) : (
            <FileTree entries={fileTree} />
          )}
        </div>

        {/* dynamic LLM selection/settings configuration */}
        <div className="p-4 border-t border-zinc-850 bg-zinc-950/30">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-full border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-800/80 text-zinc-300 text-xs font-mono py-2 rounded-lg flex items-center justify-center space-x-2 transition-all cursor-pointer"
          >
            <Settings size={14} />
            <span>LLM Provider Setup</span>
          </button>
          
          {showSettings && (
            <form onSubmit={handleAddNewProvider} className="mt-3 space-y-2 border-t border-zinc-850 pt-3 text-xs">
              <div>
                <label className="block text-[9px] uppercase font-mono text-zinc-500 mb-1">Provider ID</label>
                <input
                  type="text"
                  placeholder="e.g. ollama, openrouter"
                  value={provId}
                  onChange={(e) => setProvId(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded p-1 text-[11px] font-mono"
                  required
                />
              </div>
              <div>
                <label className="block text-[9px] uppercase font-mono text-zinc-500 mb-1">Provider Name</label>
                <input
                  type="text"
                  placeholder="e.g. Local Ollama"
                  value={provName}
                  onChange={(e) => setProvName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded p-1 text-[11px] font-mono"
                  required
                />
              </div>
              <div>
                <label className="block text-[9px] uppercase font-mono text-zinc-500 mb-1">API Base URL</label>
                <input
                  type="text"
                  placeholder="e.g. http://localhost:11434/v1"
                  value={provUrl}
                  onChange={(e) => setProvUrl(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded p-1 text-[11px] font-mono"
                />
              </div>
              <div>
                <label className="block text-[9px] uppercase font-mono text-zinc-500 mb-1">Models (Comma-separated)</label>
                <input
                  type="text"
                  placeholder="e.g. qwen2.5-coder:7b, llama3.1"
                  value={provModels}
                  onChange={(e) => setProvModels(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded p-1 text-[11px] font-mono"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-mono font-bold py-1 rounded text-xs transition-all cursor-pointer"
              >
                Register Provider
              </button>
            </form>
          )}
        </div>
      </div>

      {/* 2. Central Main Panel Workspace */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
        {/* Unified Tab Bar */}
        <div className="flex items-center justify-between border-b border-zinc-800 bg-[#111318]/70 px-4 py-1.5 select-none z-20">
          <div className="flex items-center space-x-1 overflow-x-auto scrollbar-none py-1">
            {openTabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  className={`group flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-mono border transition-all cursor-pointer select-none ${
                    isActive
                      ? "bg-indigo-600/10 border-indigo-500/30 text-white font-semibold shadow-inner"
                      : "bg-transparent border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30"
                  }`}
                >
                  {tab.type === "canvas" && <Layers size={12} className={isActive ? "text-indigo-400" : "text-zinc-500"} />}
                  {tab.type === "file" && <FileCode size={12} className={isActive ? "text-indigo-400" : "text-zinc-500"} />}
                  {tab.type === "task" && <Cpu size={12} className={isActive ? "text-indigo-400" : "text-zinc-500"} />}
                  
                  <span className="truncate max-w-[120px]">{tab.title}</span>
                  
                  {tab.id !== "canvas" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                      className="p-0.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity animate-fade-in"
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          
          {rootPath && (
            <span className="text-[10px] text-zinc-500 font-mono hidden sm:inline truncate max-w-[250px]">
              VFS: {rootPath.split("/").pop()}
            </span>
          )}
        </div>

        {/* Tab Content Display View */}
        <div className="flex-1 min-h-0 relative bg-[#0d0e12]">
          {activeTabId === "canvas" ? (
            <div className="w-full h-full flex relative">
              <div className="flex-1 flex flex-col h-full relative bg-[#0d0e12]" id="rf-canvas" onDragOver={onDragOver} onDrop={onDrop}>
                {/* Workspace Toolbar Header */}
                <div className="absolute top-4 left-4 right-4 h-14 glass-panel rounded-xl flex items-center justify-between px-4 z-10">
                  <div className="flex items-center space-x-3">
                    <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/20">
                      <Layers size={18} />
                    </span>
                    <div className="flex flex-col">
                      <span className="font-bold text-sm tracking-wide">Orchestration Canvas</span>
                      <span className="text-[10px] text-zinc-500 font-mono">Tauri VFS Sandbox Mode</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => {
                        addTaskNode(300, 200);
                      }}
                      className="bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-200 text-xs font-mono font-bold px-3 py-2 rounded-lg flex items-center space-x-1.5 transition-all shadow-md cursor-pointer"
                    >
                      <Plus size={14} className="text-indigo-400" />
                      <span>Add Task Node</span>
                    </button>
                    
                    <button
                      onClick={handleApplyChanges}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all shadow-lg glow-btn cursor-pointer"
                    >
                      <CheckSquare size={14} />
                      <span>Apply Pipeline</span>
                    </button>
                  </div>
                </div>

                {/* React Flow Board */}
                <div className="flex-1 w-full relative min-h-0">
                  <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    nodeTypes={nodeTypes}
                    onNodeClick={onNodeClick}
                    onPaneClick={onPaneClick}
                    fitView
                  >
                    <Background color="#1f2937" gap={16} size={1} variant={BackgroundVariant.Dots} />
                    <Controls className="!bg-zinc-900 !border-zinc-800 !rounded-lg" />
                    <MiniMap 
                      className="!bg-zinc-950/80 !border-zinc-850 !rounded-xl !overflow-hidden"
                      nodeColor={() => "#18181b"}
                      maskColor="rgba(0, 0, 0, 0.4)"
                      style={{ bottom: 16, right: 16 }}
                    />
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
        <div className={`border-t border-zinc-800/80 bg-[#0c0d10] flex flex-col transition-all duration-300 ${
          showDevConsole ? "h-60" : "h-9"
        } z-10 overflow-hidden font-sans`}>
          {/* Header Bar */}
          <div
            onClick={() => setShowDevConsole(!showDevConsole)}
            className="h-9 px-4 flex items-center justify-between border-b border-zinc-900 bg-zinc-950/60 hover:bg-zinc-900/20 cursor-pointer select-none text-[11px] font-mono text-zinc-400"
          >
            <div className="flex items-center space-x-3">
              <span className={`w-2 h-2 rounded-full ${
                devLogs.some(l => l.type === "error") ? "bg-rose-500 animate-pulse" : "bg-emerald-500"
              }`} />
              <span className="font-bold text-zinc-300 uppercase tracking-wider">Dev Logs Terminal</span>
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
                className="hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 px-2 py-0.5 rounded text-[10px] uppercase font-bold transition-all border border-zinc-800 hover:border-zinc-700 cursor-pointer"
              >
                Clear
              </button>
              <span className="text-[10px] text-zinc-500 font-bold uppercase">
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
                <span className="text-zinc-600">// No console logs captured yet.</span>
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
                      <span className="text-zinc-600 select-none">[{log.timestamp}]</span>
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
