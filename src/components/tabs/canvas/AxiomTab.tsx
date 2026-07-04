import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { ReactFlow, Background, BackgroundVariant } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  CheckSquare,
  Plus,
  Maximize,
  ChevronDown,
  Folder,
  Globe,
  GitMerge,
  Save,
  Settings,
  X,
  StickyNote,
  Square,
  Plug
} from "lucide-react";
import { useWorkspaceStore } from "../../../store";
import { notify } from "../../../notificationStore";
import { SidePane } from "../../sidepane/SidePane";
import { EdgeInspectorPane } from "../../edgeinspector/EdgeInspectorPane";
import { ReconciliationGraphPane } from "../../sidepane/ReconciliationGraphPane";
import { ContextNode } from "../../nodes/ContextNode";
import { TaskNode } from "../../nodes/TaskNode";
import { GlobalChatNode } from "../../nodes/GlobalChatNode";
import { McpNode } from "../../nodes/McpNode";
import { ReconciliationEdge } from "../../ReconciliationEdge";
import { StickyNode } from "../../nodes/sticky";
import { BoundaryNode } from "../../nodes/boundary";
import { invoke } from "@tauri-apps/api/core";
import { CanvasTabContext } from "./CanvasTabContext";
import { canvasFileService } from "./services/canvasFileService";
import { getNodeConfig } from "../../nodes/AxiomNodeConfig";

const nodeTypes = {
  contextNode: ContextNode,
  taskNode: TaskNode,
  globalChatNode: GlobalChatNode,
  mcpNode: McpNode,
  stickyNode: StickyNode,
  boundaryNode: BoundaryNode,
};

const edgeTypes = {
  reconciliationEdge: ReconciliationEdge,
};

interface AxiomTabProps {
  tab: { id: string; title: string };
  onExecuteNode: (nodeId: string) => void;
  onStopExecution: (nodeId: string) => void;
}

export const AxiomTab: React.FC<AxiomTabProps> = ({ tab, onExecuteNode, onStopExecution }) => {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  
  // Resolve tab-specific context from the store
  const context = useWorkspaceStore((state) => state.canvasContexts[tab.id]) || {
    nodes: [],
    edges: [],
    nodeStatus: {},
    edgeReconciliationStatus: {},
    isPipelineApplied: false
  };

  const nodes = context.nodes || [];
  const edges = context.edges || [];
  const edgeReconciliationStatus = context.edgeReconciliationStatus || {};
  const isPipelineApplied = !!context.isPipelineApplied;

  const flowNodes = useMemo(() => {
    return nodes.map((n) => {
      if (n.type === "boundaryNode") {
        return { ...n, selectable: false, draggable: false, zIndex: 0 };
      }
      return { ...n, zIndex: n.zIndex ?? 10 };
    });
  }, [nodes]);

  const onNodesChange = useCallback((changes: any[]) => {
    useWorkspaceStore.getState().onNodesChangeForTab(tab.id, changes);
  }, [tab.id]);

  const onEdgesChange = useCallback((changes: any[]) => {
    useWorkspaceStore.getState().onEdgesChangeForTab(tab.id, changes);
  }, [tab.id]);

  const onConnect = useCallback((connection: any) => {
    useWorkspaceStore.getState().onConnectForTab(tab.id, connection);
  }, [tab.id]);

  const selectedNodeId = useWorkspaceStore((state) => state.selectedNodeId);
  const setSelectedNodeId = useWorkspaceStore((state) => state.setSelectedNodeId);
  const addContextNode = useWorkspaceStore((state) => state.addContextNode);
  const addTaskNode = useWorkspaceStore((state) => state.addTaskNode);
  const addGlobalChatNode = useWorkspaceStore((state) => state.addGlobalChatNode);
  const addMcpNode = useWorkspaceStore((state) => state.addMcpNode);
  const addStickyNode = useWorkspaceStore((state) => state.addStickyNode);
  const addBoundaryNode = useWorkspaceStore((state) => state.addBoundaryNode);
  const selectedEdgeId = useWorkspaceStore((state) => state.selectedEdgeId);
  const setSelectedEdgeId = useWorkspaceStore((state) => state.setSelectedEdgeId);
  const setEdgeStatus = useWorkspaceStore((state) => state.setEdgeStatus);

  // Modal State for saving pipelines
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveTitle, setSaveTitle] = useState(tab.title);

  // Convert task-to-task edges to use custom reconciliation edge type
  const styledEdges = useMemo(() => {
    return edges.map((edge) => {
      if (edge.sourceHandle === "task-out" && edge.targetHandle === "task-in") {
        return { ...edge, type: "reconciliationEdge" };
      }
      return edge;
    });
  }, [edges]);

  // Reconciliate Graph: mark all sequence wires as unreconciled to trigger checks
  const handleReconciliateGraph = useCallback(() => {
    const sequenceEdges = edges.filter(
      (e) => e.sourceHandle === "task-out" && e.targetHandle === "task-in"
    );
    if (sequenceEdges.length === 0) {
      notify("Reconcile", "No task-to-task connections to reconciliate.", "info");
      return;
    }
    sequenceEdges.forEach((edge) => {
      const currentStatus = edgeReconciliationStatus[edge.id];
      if (currentStatus !== "reconciled") {
        setEdgeStatus(edge.id, "unreconciled");
      }
    });
    setShowReconciliationGraphPane(true);
  }, [edges, edgeReconciliationStatus, setEdgeStatus]);

  const [showReconciliationGraphPane, setShowReconciliationGraphPane] = useState(false);
  const [rfInstance, setRfInstance] = useState<any>(null);
  const connectionStartRef = useRef<any>(null);
  const initRef = useRef(false);

  const onConnectStart = useCallback((_: any, { nodeId, handleId, handleType }: any) => {
    connectionStartRef.current = { nodeId, handleId, handleType };
  }, []);

  const onInit = useCallback((instance: any) => {
    setRfInstance(instance);
    if (!initRef.current) {
      initRef.current = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          instance.fitView({ maxZoom: 1.2 });
        });
      });
    }
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
              handleId,
              tab.id
            );
          }
        }
      }

      connectionStartRef.current = null;
    },
    [nodes, rfInstance, tab.id]
  );

  const isValidConnection = useCallback(
    (connection: any) => {
      const { source, target, sourceHandle, targetHandle } = connection;
      if (source === target) return false;

      const sourceNode = nodes.find((n) => n.id === source);
      const targetNode = nodes.find((n) => n.id === target);
      if (!sourceNode || !targetNode) return false;

      if (sourceNode.type === "contextNode" && targetNode.type === "contextNode") {
        return false;
      }
      if (sourceNode.type === "mcpNode" && targetNode.type === "mcpNode") {
        return false;
      }

      if (sourceNode.type === "contextNode" || sourceNode.type === "mcpNode") {
        const hasExisting = edges.some(
          (e) => e.source === source && e.target !== target
        );
        if (hasExisting) return false;

        if (targetNode.type !== "taskNode" || !targetHandle?.startsWith("context-in")) {
          return false;
        }
      }

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
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    screenX: number;
    screenY: number;
  } | null>(null);

  const getCanvasCenter = useCallback(() => {
    if (rfInstance) {
      const reactFlowBounds = document.getElementById(`rf-canvas-${tab.id}`)?.getBoundingClientRect();
      if (reactFlowBounds) {
        const x = reactFlowBounds.left + reactFlowBounds.width / 2;
        const y = reactFlowBounds.top + reactFlowBounds.height / 2;
        return rfInstance.screenToFlowPosition({ x, y });
      }
    }
    return { x: 300, y: 200 };
  }, [rfInstance, tab.id]);

  useEffect(() => {
    const handleGlobalClick = () => {
      setContextMenu(null);
      setNodeMenuOpen(false);
      setActionMenuOpen(false);
    };
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, []);

  const onNodeClick = (_event: React.MouseEvent, node: any) => {
    setSelectedEdgeId(null);
    if (node.type === "contextNode" || node.type === "mcpNode" || node.type === "stickyNode" || node.type === "boundaryNode") {
      return;
    }
    setSelectedNodeId(node.id);
  };

  const onEdgeClick = useCallback((_event: React.MouseEvent, edge: any) => {
    setSelectedNodeId(null);
    setSelectedEdgeId(edge.id);
  }, [setSelectedNodeId, setSelectedEdgeId]);

  const onPaneClick = () => {
    setSelectedEdgeId(null);
    const currentSelectedId = useWorkspaceStore.getState().selectedNodeId;
    if (!currentSelectedId) {
      setContextMenu(null);
      return;
    }
    const selectedNodeInThisCanvas = nodes.find((n) => n.id === currentSelectedId);
    if (!selectedNodeInThisCanvas) {
      setContextMenu(null);
      return;
    }
    if (selectedNodeInThisCanvas.type === "globalChatNode") {
      return;
    }
    setSelectedNodeId(null);
    setContextMenu(null);
  };

  const onPaneContextMenu = useCallback(
    (event: any) => {
      event.preventDefault();
      const bounds = document.getElementById(`rf-canvas-${tab.id}`)?.getBoundingClientRect();
      if (bounds) {
        setContextMenu({
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
          screenX: event.clientX,
          screenY: event.clientY,
        });
      }
    },
    [tab.id]
  );

  const onNodeContextMenu = useCallback(
    (event: any, node: any) => {
      if (node.type !== "boundaryNode") return;
      event.preventDefault();
      const bounds = document.getElementById(`rf-canvas-${tab.id}`)?.getBoundingClientRect();
      if (bounds) {
        setContextMenu({
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
          screenX: event.clientX,
          screenY: event.clientY,
        });
      }
    },
    [tab.id]
  );

  const handleAddNodeFromContextMenu = useCallback(
    (type: "task" | "context" | "sticky" | "boundary") => {
      if (!contextMenu || !rfInstance) return;
      const flowPosition = rfInstance.screenToFlowPosition({
        x: contextMenu.screenX,
        y: contextMenu.screenY,
      });
      if (type === "task") {
        addTaskNode(flowPosition.x - 75, flowPosition.y - 30, tab.id);
      } else if (type === "context") {
        addContextNode(flowPosition.x - 75, flowPosition.y - 30, undefined, tab.id);
      } else if (type === "sticky") {
        addStickyNode(flowPosition.x - 100, flowPosition.y - 75, tab.id);
      } else if (type === "boundary") {
        addBoundaryNode(flowPosition.x - 150, flowPosition.y - 100, tab.id);
      }
      setContextMenu(null);
    },
    [contextMenu, rfInstance, addTaskNode, addContextNode, addStickyNode, addBoundaryNode, tab.id]
  );

  const onPaneDoubleClick = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains("react-flow__pane")) return;

    const reactFlowBounds = document.getElementById(`rf-canvas-${tab.id}`)?.getBoundingClientRect();
    if (!reactFlowBounds || !rfInstance) return;

    const position = rfInstance.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });

    addTaskNode(position.x - 75, position.y - 30, tab.id);
  }, [rfInstance, addTaskNode, tab.id]);

  const handleApplyChanges = async () => {
    try {
      await invoke("apply_vfs_to_disk", { tabId: tab.id });
      // Set applied status to true
      useWorkspaceStore.getState().updateCanvasContext(tab.id, { isPipelineApplied: true });
      notify("Applied", "In-memory shadow VFS layout flushed to local storage disk.", "success");
      if (rootPath) {
        const tree: any[] = await invoke("get_directory_structure", { rootDir: rootPath });
        useWorkspaceStore.getState().setFileTree(tree);
        await useWorkspaceStore.getState().loadGitStatus();
      }
    } catch (e: any) {
      notify("Error", `Error applying VFS: ${e}`, "error");
    }
  };

  const handleSavePipeline = async () => {
    setShowSaveModal(true);
  };

  const confirmSavePipeline = async () => {
    try {
      if (!saveTitle.trim()) {
        notify("Invalid input", "Please enter a valid title", "info");
        return;
      }
      const filePath = await canvasFileService.saveCanvas(tab.id, saveTitle);
      useWorkspaceStore.getState().updateTabTitle(tab.id, saveTitle);
      setShowSaveModal(false);
      notify("Saved", `Pipeline saved to: ${filePath}`, "success");
    } catch (e: any) {
      notify("Save failed", `Error saving pipeline: ${e.message || e}`, "error");
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
          const reactFlowBounds = document.getElementById(`rf-canvas-${tab.id}`)?.getBoundingClientRect();
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
        }, tab.id);
      } catch (err) {
        console.log("App canvas drop: Not a JSON string.", err);
      }
    },
    [addContextNode, rfInstance, tab.id]
  );

  return (
    <CanvasTabContext.Provider value={{ tabId: tab.id }}>
      <div className="w-full h-full flex flex-row relative">
        <div
          className="flex-1 min-h-0 relative bg-[var(--bg-canvas)]"
          id={`rf-canvas-${tab.id}`}
          onDragOver={onDragOver}
        >
          {/* Top Right Dropdowns */}
          <div className="absolute top-4 right-4 z-10 flex items-center space-x-2">
            {/* Add Node Dropdown */}
            <div className="relative">
              <button
                id="add-node-dropdown-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setNodeMenuOpen(!nodeMenuOpen);
                  setActionMenuOpen(false);
                }}
                className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] hover:bg-[var(--bg-header)] text-[var(--text-light)] text-xs font-mono font-semibold px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-all shadow-md hover:border-[var(--border-active)] cursor-pointer nodrag"
              >
                <Plus size={14} className="text-[var(--accent-color)]" />
                <span>Add Node</span>
                <ChevronDown size={12} className="text-[var(--text-muted)]" />
              </button>
              {nodeMenuOpen && (
                <div className="absolute right-0 mt-1 w-44 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-xl py-1 z-20 font-mono text-xs border border-[var(--border-color)]">
                  <button
                    onClick={() => {
                      const center = getCanvasCenter();
                      addTaskNode(center.x - 75, center.y - 30, tab.id);
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
                      addContextNode(center.x - 75, center.y - 30, undefined, tab.id);
                      setNodeMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
                  >
                    <Folder size={13} className="text-emerald-400" />
                    <span>Create Context Node</span>
                  </button>
                  <button
                    onClick={() => {
                      const center = getCanvasCenter();
                      addMcpNode(center.x - 75, center.y - 30, tab.id);
                      setNodeMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
                  >
                    <Plug size={13} className="text-sky-400" />
                    <span>Create MCP Node</span>
                  </button>
                  <button
                    onClick={() => {
                      const center = getCanvasCenter();
                      addStickyNode(center.x - 100, center.y - 75, tab.id);
                      setNodeMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
                  >
                    <StickyNote size={13} className="text-amber-400" />
                    <span>Create Sticky Note</span>
                  </button>
                  <button
                    onClick={() => {
                      const center = getCanvasCenter();
                      addBoundaryNode(center.x - 150, center.y - 100, tab.id);
                      setNodeMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
                  >
                    <Square size={13} className="text-violet-400" />
                    <span>Create Boundary</span>
                  </button>
                  <div className="border-t border-[var(--border-color)] my-1" />
                  <button
                    onClick={() => {
                      const center = getCanvasCenter();
                      addGlobalChatNode(center.x - 75, center.y - 30, tab.id);
                      setNodeMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
                  >
                    <Globe size={13} className="text-violet-400" />
                    <span>Create Global Explorer</span>
                  </button>
                </div>
              )}
            </div>

            {/* Pipeline Actions Dropdown */}
            <div className="relative">
              <button
                id="pipeline-actions-dropdown-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setActionMenuOpen(!actionMenuOpen);
                  setNodeMenuOpen(false);
                }}
                className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] hover:bg-[var(--bg-header)] text-[var(--text-light)] text-xs font-mono font-semibold px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-all shadow-md hover:border-[var(--border-active)] cursor-pointer nodrag"
              >
                <Settings size={14} className="text-violet-400" />
                <span>Action</span>
                <ChevronDown size={12} className="text-[var(--text-muted)]" />
              </button>
              {actionMenuOpen && (
                <div className="absolute right-0 mt-1 w-48 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-xl py-1 z-20 font-mono text-xs border border-[var(--border-color)]">
                  <button
                    onClick={() => {
                      handleReconciliateGraph();
                      setActionMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
                  >
                    <GitMerge size={13} className="text-violet-400" />
                    <span>Reconciliate Graph</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSavePipeline();
                      setActionMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
                  >
                    <Save size={13} className="text-emerald-400" />
                    <span>Save Axiom</span>
                  </button>
                  <div className="border-t border-[var(--border-color)] my-1" />
                  <button
                    onClick={() => {
                      if (!isPipelineApplied) {
                        handleApplyChanges();
                        setActionMenuOpen(false);
                      }
                    }}
                    disabled={isPipelineApplied}
                    className={`w-full text-left px-3 py-2 flex items-center space-x-2 transition-colors ${
                      isPipelineApplied
                        ? "text-emerald-400 cursor-not-allowed opacity-90"
                        : "hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] cursor-pointer"
                    }`}
                  >
                    {isPipelineApplied ? (
                      <>
                        <CheckSquare size={13} className="text-emerald-400" />
                        <span>Axiom Applied</span>
                      </>
                    ) : (
                      <>
                        <CheckSquare size={13} className="text-[var(--accent-color)]" />
                        <span>Apply Axiom</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
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
              <button
                onClick={() => {
                  if (!contextMenu || !rfInstance) return;
                  const flowPosition = rfInstance.screenToFlowPosition({
                    x: contextMenu.screenX,
                    y: contextMenu.screenY,
                  });
                  addMcpNode(flowPosition.x - 75, flowPosition.y - 30, tab.id);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
              >
                <Plug size={13} className="text-sky-400" />
                <span>Add MCP Node</span>
              </button>
              <button
                onClick={() => handleAddNodeFromContextMenu("sticky")}
                className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
              >
                <StickyNote size={13} className="text-amber-400" />
                <span>Add Sticky Note</span>
              </button>
              <button
                onClick={() => handleAddNodeFromContextMenu("boundary")}
                className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
              >
                <Square size={13} className="text-violet-400" />
                <span>Add Boundary</span>
              </button>
              <div className="border-t border-[var(--border-color)] my-1" />
              <button
                onClick={() => {
                  if (!contextMenu || !rfInstance) return;
                  const flowPosition = rfInstance.screenToFlowPosition({
                    x: contextMenu.screenX,
                    y: contextMenu.screenY,
                  });
                  addGlobalChatNode(flowPosition.x - 75, flowPosition.y - 30, tab.id);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
              >
                <Globe size={13} className="text-violet-400" />
                <span>Add Global Explorer</span>
              </button>
            </div>
          )}

          {/* React Flow Board */}
          <div
            className="absolute inset-0"
            onDoubleClick={onPaneDoubleClick}
            onDragOver={onDragOver}
          >
            <ReactFlow
              style={{ width: "100%", height: "100%" }}
              nodes={flowNodes}
              edges={styledEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              onPaneClick={onPaneClick}
              onPaneContextMenu={onPaneContextMenu}
              onNodeContextMenu={onNodeContextMenu}
              onInit={onInit}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onConnectStart={onConnectStart}
              onConnectEnd={onConnectEnd}
              isValidConnection={isValidConnection}
              proOptions={{ hideAttribution: true }}
              maxZoom={1.2}
              minZoom={0.2}
              elevateNodesOnSelect={false}
            >
              <Background color="#1f2937" gap={16} size={1} variant={BackgroundVariant.Dots} />
            </ReactFlow>
          </div>
        </div>

        {/* Sliding Drawer Inspector Pane */}
        {(() => {
          const selectedNode = flowNodes.find((n) => n.id === selectedNodeId);
          const showSidePane = selectedNodeId && selectedNode && getNodeConfig(selectedNode.type || "").hasSidepane;
          if (!showSidePane) return null;
          return (
            <SidePane
              onClose={() => setSelectedNodeId(null)}
              onExecuteNode={onExecuteNode}
              onStopExecution={onStopExecution}
              tabId={tab.id}
            />
          );
        })()}

        {/* Edge Inspector Pane */}
        {selectedEdgeId && !selectedNodeId && (
          <EdgeInspectorPane
            onClose={() => setSelectedEdgeId(null)}
          />
        )}

        {/* Reconciliation Graph Pane */}
        {showReconciliationGraphPane && (
          <ReconciliationGraphPane
            onClose={() => setShowReconciliationGraphPane(false)}
            tabId={tab.id}
          />
        )}

        {/* Save Axiom Prompt Modal */}
        {showSaveModal && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl w-full max-w-md shadow-2xl overflow-hidden font-mono">
              <div className="px-4 py-3 bg-[var(--bg-header)] border-b border-[var(--border-color)] flex items-center justify-between">
                <span className="text-[var(--text-light)] text-sm font-bold flex items-center space-x-2">
                  <Save size={16} className="text-emerald-400" />
                  <span>Save Axiom Canvas</span>
                </span>
                <button
                  onClick={() => setShowSaveModal(false)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="p-4 flex flex-col space-y-3">
                <p className="text-xs text-[var(--text-normal)]">
                  Enter a filename/title for this Axiom. It will be serialized under <code className="text-emerald-400 font-bold">.axiom/canvas/</code>.
                </p>
                <div className="flex flex-col space-y-1">
                  <label htmlFor="axiom-title-input" className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Axiom Title</label>
                  <input
                    id="axiom-title-input"
                    type="text"
                    value={saveTitle}
                    onChange={(e) => setSaveTitle(e.target.value)}
                    placeholder="e.g. build_and_test_axiom"
                    className="w-full bg-[var(--bg-canvas)] border border-[var(--border-color)] focus:border-[var(--accent-color)] text-[var(--text-light)] rounded-lg px-3 py-2 text-sm outline-none transition-colors"
                  />
                </div>
              </div>
              <div className="px-4 py-3 bg-[var(--bg-header)] border-t border-[var(--border-color)] flex items-center justify-end space-x-2">
                <button
                  onClick={() => setShowSaveModal(false)}
                  className="px-3.5 py-1.5 border border-[var(--border-color)] hover:bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:text-[var(--text-light)] rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmSavePipeline}
                  className="px-4 py-1.5 bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/90 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors shadow-md hover:shadow-lg"
                >
                  Save Axiom
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </CanvasTabContext.Provider>
  );
};
