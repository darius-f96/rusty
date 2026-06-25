import React, { useState, useCallback, useEffect, useRef } from "react";
import { ReactFlow, Background, BackgroundVariant } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  CheckSquare,
  Plus,
  Maximize,
  ChevronDown,
  Folder,
} from "lucide-react";
import { useWorkspaceStore } from "../../store";
import { SidePane } from "../SidePane";
import { ContextNode } from "../ContextNode";
import { TaskNode } from "../TaskNode";
import { invoke } from "@tauri-apps/api/core";

const nodeTypes = {
  contextNode: ContextNode,
  taskNode: TaskNode,
};

interface CanvasTabProps {
  onExecuteNode: (nodeId: string) => void;
}

export const CanvasTab: React.FC<CanvasTabProps> = ({ onExecuteNode }) => {
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

  const [rfInstance, setRfInstance] = useState<any>(null);
  const connectionStartRef = useRef<any>(null);

  const onConnectStart = useCallback((_: any, { nodeId, handleId, handleType }: any) => {
    connectionStartRef.current = { nodeId, handleId, handleType };
  }, []);

  const onConnectEnd = useCallback(
    (event: any) => {
      if (!connectionStartRef.current) return;

      const target = event.target as Element;
      const isPane = target.classList.contains("react-flow__pane") || target.closest(".react-flow__pane");

      if (isPane && rfInstance) {
        const { nodeId, handleId } = connectionStartRef.current;
        const startNode = nodes.find((n) => n.id === nodeId);
        
        if (startNode && startNode.type === "taskNode" && handleId && handleId.startsWith("context-in")) {
          const clientX = event.clientX || (event.touches && event.touches[0]?.clientX);
          const clientY = event.clientY || (event.touches && event.touches[0]?.clientY);

          if (clientX !== undefined && clientY !== undefined) {
            const projected = rfInstance.screenToFlowPosition({ x: clientX, y: clientY });
            useWorkspaceStore.getState().addAndConnectContextNode(
              projected.x,
              projected.y,
              nodeId,
              handleId
            );
          }
        }
      }

      connectionStartRef.current = null;
    },
    [nodes, rfInstance]
  );

  const isValidConnection = useCallback(
    (connection: any) => {
      const { source, target, sourceHandle, targetHandle } = connection;
      if (source === target) return false;

      const sourceNode = nodes.find((n) => n.id === source);
      const targetNode = nodes.find((n) => n.id === target);
      if (!sourceNode || !targetNode) return false;

      // Context node are not allowed to be connected to other ContextNodes
      if (sourceNode.type === "contextNode" && targetNode.type === "contextNode") {
        return false;
      }

      // Context node is not allowed to connect to more than one TaskNode
      if (sourceNode.type === "contextNode") {
        const hasExisting = edges.some(
          (e) => e.source === source && e.target !== target
        );
        if (hasExisting) return false;

        // Must connect to task node context-in handles
        if (targetNode.type !== "taskNode" || !targetHandle?.startsWith("context-in")) {
          return false;
        }
      }

      // Enforce target logic for task nodes
      if (sourceNode.type === "taskNode" && targetNode.type === "taskNode") {
        if (sourceHandle !== "task-out" || targetHandle !== "task-in") {
          return false;
        }
      }

      return true;
    },
    [nodes, edges]
  );
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

  const handleApplyChanges = async () => {
    try {
      await invoke("apply_vfs_to_disk");
      alert("Success: In-memory shadow VFS layout flushed to local storage disk.");
      if (rootPath) {
        const tree: any[] = await invoke("get_directory_structure", { rootDir: rootPath });
        useWorkspaceStore.getState().setFileTree(tree);
        await useWorkspaceStore.getState().loadGitStatus();
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
          isDir: dragData.isDir,
        });
      } catch (err) {
        console.log("App canvas drop: Not a JSON string.", err);
      }
    },
    [addContextNode, rfInstance]
  );

  return (
    <div className="w-full h-full flex relative">
      <div
        className="flex-1 flex flex-col h-full relative bg-[var(--bg-canvas)]"
        id="rf-canvas"
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
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
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            isValidConnection={isValidConnection}
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
          onExecuteNode={onExecuteNode}
        />
      )}
    </div>
  );
};
