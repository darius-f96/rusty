import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  CheckSquare,
  Plus,
  X,
  Cpu,
  Maximize,
  ChevronDown,
  Folder,
  Settings,
  GitCommit,
} from "lucide-react";
import { useWorkspaceStore, CustomProvider } from "../store";
import { EditorPanel } from "./EditorPanel";
import { SidePane } from "./SidePane";
import { ContextNode } from "./ContextNode";
import { TaskNode } from "./TaskNode";
import { FileIcon } from "../services/fileTypeService";
import { invoke } from "@tauri-apps/api/core";
import { AxiomIcon } from "./AxiomIcon";
import { GitHistoryTabContent } from "./GitHistoryTabContent";

// Register custom nodes for React Flow
const nodeTypes = {
  contextNode: ContextNode,
  taskNode: TaskNode,
};

export const Workspace: React.FC = () => {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
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

  const [rfInstance, setRfInstance] = useState<any>(null);
  const socketRef = useRef<WebSocket | null>(null);

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

  // Close menus on outside click
  useEffect(() => {
    const handleGlobalClick = () => {
      setContextMenu(null);
      setNodeMenuOpen(false);
    };
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, []);

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
    const target = event.target as HTMLElement;
    if (!target.classList.contains("react-flow__pane")) return;

    const reactFlowBounds = document.getElementById("rf-canvas")?.getBoundingClientRect();
    if (!reactFlowBounds || !rfInstance) return;

    const position = rfInstance.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });

    addTaskNode(position.x - 75, position.y - 30);
  }, [rfInstance, addTaskNode]);

  // WebSocket execution runner
  const executeNode = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== "taskNode") return;

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

    const socket = new WebSocket("ws://localhost:4000");
    socketRef.current = socket;

    socket.onopen = () => {
      console.log("WebSocket connection opened to sidecar");
      addLog(nodeId, "Connection established. Dispatching task execution details...");
      
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

  const handleApplyChanges = async () => {
    try {
      await invoke("apply_vfs_to_disk");
      alert("Success: In-memory shadow VFS layout flushed to local storage disk.");
      if (rootPath) {
        const tree: any[] = await invoke("get_directory_structure", { rootDir: rootPath });
        useWorkspaceStore.getState().setFileTree(tree);
        await useWorkspaceStore.getState().loadGitStatus(); // Refresh git changes
      }
    } catch (e: any) {
      alert(`Error applying VFS: ${e}`);
    }
  };

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const rawData = event.dataTransfer.getData("text/plain");
      if (!rawData) return;

      try {
        const dragData = JSON.parse(rawData);
        if (!dragData || !dragData.path || !dragData.name) return;

        let position = { x: event.clientX, y: event.clientY };
        if (rfInstance) {
          position = rfInstance.screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          });
        } else {
          const reactFlowBounds = document.getElementById("rf-canvas")?.getBoundingClientRect();
          if (reactFlowBounds) {
            position = {
              x: event.clientX - reactFlowBounds.left,
              y: event.clientY - reactFlowBounds.top,
            };
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

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
      {/* Workspace Unified Tab Bar */}
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
                {tab.type === "canvas" && <AxiomIcon size={11} className={isActive ? "text-[var(--accent-color)]" : "text-[var(--text-muted)]"} />}
                {tab.type === "file" && <FileIcon fileName={tab.title} size={11} className="flex-shrink-0" />}
                {tab.type === "task" && <Cpu size={11} className={isActive ? "text-[var(--accent-color)]" : "text-[var(--text-muted)]"} />}
                {tab.type === "llm-setup" && <Cpu size={11} className={isActive ? "text-[var(--accent-color)]" : "text-[var(--text-muted)]"} />}
                {tab.type === "settings" && <Settings size={11} className={isActive ? "text-[var(--accent-color)]" : "text-[var(--text-muted)]"} />}
                {tab.type === "git-history" && <GitCommit size={11} className={isActive ? "text-[var(--accent-color)]" : "text-[var(--text-muted)]"} />}
                
                <span className="truncate max-w-[120px]">{tab.title}</span>
                
                {tab.id !== "canvas" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="p-0.5 rounded-sm hover:bg-[var(--border-color)]/80 text-[var(--text-muted)] hover:text-[var(--text-light)] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Tab Panel Render Targets */}
      <div className="flex-1 min-h-0 relative bg-[var(--bg-app)]">
        {activeTabId === "canvas" ? (
          <div className="w-full h-full flex relative">
            <div className="flex-1 flex flex-col h-full relative bg-[var(--bg-app)]" id="rf-canvas" onDragOver={onDragOver} onDrop={onDrop}>
              {/* Top Right Dropdown */}
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

              {/* Bottom Left Controls */}
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

            {/* Sliding Drawer Inspector Pane */}
            {selectedNodeId && (
              <SidePane
                onClose={() => setSelectedNodeId(null)}
                onExecuteNode={executeNode}
              />
            )}
          </div>
        ) : activeTab?.type === "llm-setup" ? (
          <LlmIntegrationsTabContent />
        ) : activeTab?.type === "settings" ? (
          <SettingsTabContent />
        ) : activeTab?.type === "git-history" ? (
          <GitHistoryTabContent />
        ) : (
          <EditorPanel activeTab={activeTab} onExecuteNode={executeNode} />
        )}
      </div>
    </div>
  );
};

const SettingsTabContent = () => {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);
  const activeModel = useWorkspaceStore((state) => state.activeModel);

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6 font-sans text-[var(--text-normal)]">
      <div className="space-y-1">
        <h2 className="text-xl font-bold text-[var(--text-light)]">General Settings</h2>
        <p className="text-xs text-[var(--text-muted)] font-mono">Configure system preferences and path properties</p>
      </div>

      <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl p-5 space-y-4">
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">Workspace Directory</label>
          <div className="bg-[var(--bg-app)] border border-[var(--border-color)] px-3 py-2 rounded-lg font-mono text-xs text-[var(--text-light)] select-text break-all">
            {rootPath || "No workspace folder selected"}
          </div>
        </div>

        <div className="space-y-1.5 pt-2">
          <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">Active LLM Provider</label>
          <div className="bg-[var(--bg-app)] border border-[var(--border-color)] px-3 py-2 rounded-lg font-mono text-xs text-[var(--text-light)]">
            {activeCustomProviderId || "None"}
          </div>
        </div>

        <div className="space-y-1.5 pt-2">
          <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">Active Target Model</label>
          <div className="bg-[var(--bg-app)] border border-[var(--border-color)] px-3 py-2 rounded-lg font-mono text-xs text-[var(--text-light)]">
            {activeModel || "None"}
          </div>
        </div>
      </div>
    </div>
  );
};

const LlmIntegrationsTabContent = () => {
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const setActiveCustomProviderId = useWorkspaceStore((state) => state.setActiveCustomProviderId);
  const setActiveModel = useWorkspaceStore((state) => state.setActiveModel);

  const [provId, setProvId] = useState("");
  const [provName, setProvName] = useState("");
  const [provUrl, setProvUrl] = useState("http://localhost:11434/v1");
  const [provModels, setProvModels] = useState("qwen2.5-coder:7b");

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
      apiKey: "",
      apiType: "openai-completions",
      models: modelsList
    };

    useWorkspaceStore.getState().addCustomProvider(newProvider);
    alert(`LLM Provider ${provName} registered successfully!`);
    setProvId("");
    setProvName("");
  };

  return (
    <div className="p-8 max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 font-sans text-[var(--text-normal)]">
      {/* List / Config Panel */}
      <div className="space-y-5">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-[var(--text-light)]">LLM Configuration</h2>
          <p className="text-xs text-[var(--text-muted)] font-mono">Select active providers and models for task nodes</p>
        </div>

        <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl p-5 space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono font-bold">Choose Provider</label>
            <div className="grid grid-cols-1 gap-2">
              {customProviders.map((p) => {
                const isActive = p.id === activeCustomProviderId;
                return (
                  <div
                    key={p.id}
                    onClick={() => {
                      setActiveCustomProviderId(p.id);
                      if (p.models.length > 0) {
                        setActiveModel(p.models[0].id);
                      }
                    }}
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                      isActive
                        ? "border-[var(--accent-color)] bg-[var(--accent-bg)]"
                        : "border-[var(--border-color)] bg-[var(--bg-app)] hover:border-[var(--border-active)]"
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-[var(--text-light)]">{p.name}</span>
                      <span className="text-[10px] text-[var(--text-muted)] font-mono">{p.baseUrl || "Built-in integration"}</span>
                    </div>
                    {isActive && <span className="w-2 h-2 rounded-full bg-[var(--accent-color)] shadow-sm" />}
                  </div>
                );
              })}
            </div>
          </div>

          {activeCustomProviderId && (
            <div className="space-y-2 pt-2">
              <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">Choose Model</label>
              <select
                value={activeModel}
                onChange={(e) => setActiveModel(e.target.value)}
                className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2.5 text-xs text-[var(--text-light)] font-mono focus:outline-none focus:border-[var(--border-active)]"
              >
                {customProviders
                  .find((p) => p.id === activeCustomProviderId)
                  ?.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.id})
                    </option>
                  ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Register Panel */}
      <div className="space-y-5">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-[var(--text-light)]">Add Custom LLM</h2>
          <p className="text-xs text-[var(--text-muted)] font-mono">Register custom local (Ollama) or OpenAI compatible endpoints</p>
        </div>

        <form onSubmit={handleAddNewProvider} className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)] font-mono">Provider ID</label>
            <input
              type="text"
              placeholder="e.g. ollama, openrouter"
              value={provId}
              onChange={(e) => setProvId(e.target.value)}
              className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs font-mono text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)]"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)] font-mono">Provider Name</label>
            <input
              type="text"
              placeholder="e.g. Local Ollama"
              value={provName}
              onChange={(e) => setProvName(e.target.value)}
              className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs font-mono text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)]"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)] font-mono">API Base URL</label>
            <input
              type="text"
              placeholder="e.g. http://localhost:11434/v1"
              value={provUrl}
              onChange={(e) => setProvUrl(e.target.value)}
              className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs font-mono text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)] font-mono">Models (Comma-separated)</label>
            <input
              type="text"
              placeholder="e.g. qwen2.5-coder:7b, llama3.1"
              value={provModels}
              onChange={(e) => setProvModels(e.target.value)}
              className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs font-mono text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)]"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 text-white font-mono font-bold py-2 rounded-lg text-xs transition-all shadow-md cursor-pointer flex items-center justify-center"
          >
            Register Provider
          </button>
        </form>
      </div>
    </div>
  );
};
