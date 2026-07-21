import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { ReactFlow, Background, BackgroundVariant, ReactFlowProvider, useViewport } from "@xyflow/react";
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
  Plug,
  Link2
} from "lucide-react";
import { useWorkspaceStore } from "../../../store";
import { notify } from "../../../notificationStore";
import { SidePane } from "../../sidepane/SidePane";
import { ReconciliationGraphPane } from "../../sidepane/ReconciliationGraphPane";
import { ContextNode } from "../../nodes/ContextNode";
import { TaskNode } from "../../nodes/TaskNode";
import { GlobalChatNode } from "../../nodes/GlobalChatNode";
import { McpNode } from "../../nodes/McpNode";
import { StickyNode } from "../../nodes/sticky";
import { BoundaryNode } from "../../nodes/boundary";
import { invoke } from "@tauri-apps/api/core";
import { VfsRegistry, VFS_CHANGED_EVENT, type VfsChangedDetail } from "../../../services/vfs";
import { CanvasTabContext } from "./CanvasTabContext";
import { canvasFileService } from "./services/canvasFileService";
import { getNodeConfig } from "../../nodes/AxiomNodeConfig";
import { reconciliationService, withoutReconciliationFiles } from "../../../services/reconciliationService";
import { buildReconciliationTaskFileRecords, normalizeReconciliationPath } from "../../../services/reconciliationPaths";
import { queryDuplicateTrackedFiles } from "../../../services/vfs/orchestrators/queryOrchestrator";
import {
  CANVAS_NODE_FOCUS_EVENT,
  focusCanvasNode,
  type CanvasNodeFocusDetail,
} from "../../../services/canvasNodeNavigation";

const nodeTypes = {
  contextNode: ContextNode,
  taskNode: TaskNode,
  globalChatNode: GlobalChatNode,
  mcpNode: McpNode,
  stickyNode: StickyNode,
  boundaryNode: BoundaryNode,
};

const edgeTypes = {};

interface AxiomTabProps {
  tab: { id: string; title: string };
  onExecuteNode: (nodeId: string) => void;
  onStopExecution: (nodeId: string) => void;
}

export const AxiomTab: React.FC<AxiomTabProps> = (props) => {
  return (
    <ReactFlowProvider>
      <AxiomTabContent {...props} />
    </ReactFlowProvider>
  );
};

const AxiomTabContent: React.FC<AxiomTabProps> = ({ tab, onExecuteNode, onStopExecution }) => {
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
  const isPipelineApplied = !!context.isPipelineApplied;
  const isReconciliationRunning = context.nodeStatus?.[`__reconciliation__:${tab.id}`] === "running";
  const hasGlobalChatNode = nodes.some((node) => node.type === "globalChatNode");

  const flowNodes = useMemo(() => {
    return nodes.map((n) => {
      if (n.type === "boundaryNode") {
        return { ...n, selectable: false, draggable: false, zIndex: 0 };
      }
      if (n.type === "taskNode" && n.data?.isMinimized === false) {
        return { ...n, zIndex: 1000 };
      }
      return { ...n, zIndex: n.zIndex ?? 10 };
    });
  }, [nodes]);

  const selectedNodes = useMemo(() => {
    return flowNodes.filter((n) => n.selected);
  }, [flowNodes]);

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
  const setSelectedEdgeId = useWorkspaceStore((state) => state.setSelectedEdgeId);

  // Modal State for saving pipelines
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveTitle, setSaveTitle] = useState(tab.title);

  // Reconcile changes: check where issues are with same file changes and fix them
  const handleReconcileCode = useCallback(() => {
    setHasOpenedReconciliationGraphPane(true);
    setShowReconciliationGraphPane(true);
  }, []);

  const [showReconciliationGraphPane, setShowReconciliationGraphPane] = useState(false);
  const [hasOpenedReconciliationGraphPane, setHasOpenedReconciliationGraphPane] = useState(false);
  const [rfInstance, setRfInstance] = useState<any>(null);
  const connectionStartRef = useRef<any>(null);
  const initRef = useRef(false);

  // A TaskNode write makes only the affected collision results stale. Remove
  // those files from the reconciliation owner/ledger immediately, even while
  // the reconciliation pane is hidden or has not been reopened yet.
  useEffect(() => {
    const handleTaskVfsChange = (event: Event) => {
      const detail = (event as CustomEvent<VfsChangedDetail>).detail;
      if (detail?.tabId !== tab.id || !detail.nodeId || detail.nodeId.startsWith("__reconciliation_node__:")) return;
      const currentContext = useWorkspaceStore.getState().canvasContexts[tab.id];
      if (!currentContext?.nodes.some((node) => node.type === "taskNode" && node.id === detail.nodeId)) return;
      const ledger = currentContext.reconciliationSnapshot?.ledger || {};
      const affected = (detail.paths || []).map((filePath) => {
        try {
          return normalizeReconciliationPath(rootPath, filePath);
        } catch {
          return filePath;
        }
      }).filter((filePath) => !!ledger[filePath] || currentContext.reconciliationSnapshot?.files.includes(filePath));
      if (affected.length === 0) return;

      void (async () => {
        await reconciliationService.removeFiles(tab.id, affected);
        const latestContext = useWorkspaceStore.getState().canvasContexts[tab.id];
        useWorkspaceStore.getState().updateCanvasContext(tab.id, {
          reconciliationSnapshot: withoutReconciliationFiles(latestContext?.reconciliationSnapshot, affected),
          isPipelineApplied: false,
        });
        await canvasFileService.autoSaveCanvas(tab.id);
      })().catch((err) => console.error("[AxiomTab] Failed to invalidate reconciled files:", err));
    };
    window.addEventListener(VFS_CHANGED_EVENT, handleTaskVfsChange);
    return () => window.removeEventListener(VFS_CHANGED_EVENT, handleTaskVfsChange);
  }, [rootPath, tab.id]);

  // Re-audit persisted ledger entries on canvas mount and TaskNode state
  // changes. This covers task executions that happened while this canvas view
  // was not mounted and therefore could not receive the live VFS event.
  useEffect(() => {
    const snapshot = context.reconciliationSnapshot;
    if (!snapshot || snapshot.files.length === 0) return;
    const taskFileRecords = buildReconciliationTaskFileRecords(
      rootPath,
      nodes.filter((node) => node.type === "taskNode").map((node) => ({
        id: node.id,
        modifiedFiles: Array.isArray(node.data?.modifiedFiles) ? node.data.modifiedFiles as string[] : [],
        generatedFileContents: (node.data?.generatedFileContents as Record<string, string>) || {},
      })),
      snapshot.files,
    );
    const ledger = snapshot.ledger || {};
    const invalidFiles = snapshot.files.filter((filePath) => (
      !ledger[filePath] ||
      !taskFileRecords[filePath] ||
      ledger[filePath].sourceSignature !== taskFileRecords[filePath].sourceSignature
    ));
    if (invalidFiles.length === 0) return;
    void (async () => {
      await reconciliationService.removeFiles(tab.id, invalidFiles);
      const latest = useWorkspaceStore.getState().canvasContexts[tab.id]?.reconciliationSnapshot;
      useWorkspaceStore.getState().updateCanvasContext(tab.id, {
        reconciliationSnapshot: withoutReconciliationFiles(latest, invalidFiles),
        isPipelineApplied: false,
      });
      await canvasFileService.autoSaveCanvas(tab.id);
    })().catch((err) => console.error("[AxiomTab] Failed to audit reconciliation ledger:", err));
  }, [context.reconciliationSnapshot, nodes, rootPath, tab.id]);

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
    [nodes]
  );

  const getPossibleConnection = useCallback((node1: any, node2: any) => {
    if (!node1 || !node2 || node1.id === node2.id) return null;

    const checkDirection = (src: any, dst: any) => {
      // 1. Task -> Task
      if (src.type === "taskNode" && dst.type === "taskNode") {
        const conn = {
          source: src.id,
          target: dst.id,
          sourceHandle: "task-out",
          targetHandle: "task-in",
        };
        if (isValidConnection(conn)) {
          const alreadyConnected = edges.some(
            (e) =>
              e.source === conn.source &&
              e.target === conn.target &&
              e.sourceHandle === conn.sourceHandle &&
              e.targetHandle === conn.targetHandle
          );
          if (!alreadyConnected) return conn;
        }
      }

      // 2. Context/MCP -> Task
      if ((src.type === "contextNode" || src.type === "mcpNode") && dst.type === "taskNode") {
        const isSrcAbove = src.position.y < dst.position.y;
        const sourceHandle = isSrcAbove ? "context-out-bottom" : "context-out-top";
        const targetHandle = isSrcAbove ? "context-in-top" : "context-in-bottom";

        const conn = {
          source: src.id,
          target: dst.id,
          sourceHandle,
          targetHandle,
        };
        if (isValidConnection(conn)) {
          const alreadyConnected = edges.some(
            (e) =>
              e.source === conn.source &&
              e.target === conn.target &&
              e.sourceHandle === conn.sourceHandle &&
              e.targetHandle === conn.targetHandle
          );
          if (!alreadyConnected) return conn;
        }
      }

      return null;
    };

    let firstTry = checkDirection(node1, node2);
    if (firstTry) return firstTry;

    let secondTry = checkDirection(node2, node1);
    if (secondTry) return secondTry;

    return null;
  }, [isValidConnection, edges]);

  const possibleConnection = useMemo(() => {
    if (selectedNodes.length !== 2) return null;
    return getPossibleConnection(selectedNodes[0], selectedNodes[1]);
  }, [selectedNodes, getPossibleConnection]);

  const handleConnectSelected = useCallback(() => {
    if (possibleConnection) {
      useWorkspaceStore.getState().onConnectForTab(tab.id, possibleConnection);
    }
  }, [possibleConnection, tab.id]);

  const [nodeMenuOpen, setNodeMenuOpen] = useState(false);
  const [boundaryMenuOpen, setBoundaryMenuOpen] = useState(false);
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

  const boundaryNodes = useMemo(
    () => nodes.filter((node) => node.type === "boundaryNode"),
    [nodes],
  );
  const globalChatNode = useMemo(
    () => nodes.find((node) => node.type === "globalChatNode"),
    [nodes],
  );

  useEffect(() => {
    const handleNodeFocus = (event: Event) => {
      const detail = (event as CustomEvent<CanvasNodeFocusDetail>).detail;
      if (detail?.tabId !== tab.id || !rfInstance) return;
      const targetNode = nodes.find((node) => node.id === detail.nodeId);
      if (!targetNode) return;
      void rfInstance.fitView({
        nodes: [targetNode],
        padding: targetNode.type === "boundaryNode" ? 0.18 : 0.4,
        minZoom: 0.15,
        maxZoom: 1.2,
        duration: 450,
      });
    };
    window.addEventListener(CANVAS_NODE_FOCUS_EVENT, handleNodeFocus);
    return () => window.removeEventListener(CANVAS_NODE_FOCUS_EVENT, handleNodeFocus);
  }, [nodes, rfInstance, tab.id]);

  useEffect(() => {
    const handleGlobalClick = () => {
      setContextMenu(null);
      setNodeMenuOpen(false);
      setBoundaryMenuOpen(false);
      setActionMenuOpen(false);
    };
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, []);

  // Trigger auto-save when nodes, edges, or chat history change (if this canvas has been saved before)
  useEffect(() => {
    if (!context.hasBeenSaved) return;

    const timer = setTimeout(() => {
      console.log(`[AxiomTab] Auto-saving canvas tab: ${tab.id}`);
      canvasFileService.autoSaveCanvas(tab.id);
    }, 1500);

    return () => clearTimeout(timer);
  }, [nodes, edges, context.globalChatHistory, context.hasBeenSaved, tab.id]);

  // Undo / Redo keyboard shortcuts (Cmd+Z / Cmd+Shift+Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.key !== "z" && e.key !== "Z") return;

      // Don't intercept when user is typing in a text input or textarea
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;

      e.preventDefault();
      if (e.shiftKey) {
        useWorkspaceStore.getState().redoCanvasTab(tab.id);
      } else {
        useWorkspaceStore.getState().undoCanvasTab(tab.id);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tab.id]);

  const onNodeClick = (_event: React.MouseEvent, _node: any) => {
    setSelectedEdgeId(null);
    // Node selection is handled by React Flow. We do not automatically open the side pane here.
  };

  const onEdgeClick = useCallback((_event: React.MouseEvent, edge: any) => {
    const currentSelectedId = useWorkspaceStore.getState().selectedNodeId;
    const selectedNodeInThisCanvas = nodes.find((n) => n.id === currentSelectedId);
    if (!selectedNodeInThisCanvas || selectedNodeInThisCanvas.type !== "globalChatNode") {
      setSelectedNodeId(null);
    }
    setSelectedEdgeId(edge.id);
  }, [setSelectedNodeId, setSelectedEdgeId, nodes]);

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
    if (isReconciliationRunning) {
      notify("Reconciliation Running", "Wait for reconciliation to finish or stop it before applying Axiom.", "info");
      return;
    }
    try {
      const reconciledFiles = await reconciliationService.getFiles(tab.id);
      const reconciliationSnapshot = useWorkspaceStore.getState().canvasContexts[tab.id]?.reconciliationSnapshot;
      const taskNodes = (useWorkspaceStore.getState().canvasContexts[tab.id]?.nodes || [])
        .filter((node) => node.type === "taskNode")
        .map((node) => ({
          id: node.id,
          modifiedFiles: Array.isArray(node.data?.modifiedFiles) ? node.data.modifiedFiles as string[] : [],
          generatedFileContents: (node.data?.generatedFileContents as Record<string, string>) || {},
        }));
      for (const taskNode of taskNodes) {
        for (const filePath of taskNode.modifiedFiles) {
          normalizeReconciliationPath(rootPath, filePath);
        }
      }
      const duplicateFiles = await queryDuplicateTrackedFiles(tab.id, rootPath);
      const collisionFiles = Object.keys(duplicateFiles);
      const collisionSet = new Set(collisionFiles);
      const obsoleteOwnerFiles = reconciledFiles.filter((filePath) => !collisionSet.has(filePath));
      if (obsoleteOwnerFiles.length > 0) {
        await reconciliationService.removeFiles(tab.id, obsoleteOwnerFiles);
        useWorkspaceStore.getState().updateCanvasContext(tab.id, {
          reconciliationSnapshot: withoutReconciliationFiles(reconciliationSnapshot, obsoleteOwnerFiles),
          isPipelineApplied: false,
        });
      }
      const activeReconciledFiles = reconciledFiles.filter((filePath) => collisionSet.has(filePath));
      const taskFileRecords = buildReconciliationTaskFileRecords(rootPath, taskNodes, activeReconciledFiles);
      const taskOwnedFiles = Object.keys(taskFileRecords);
      if (taskOwnedFiles.length === 0) {
        notify("Nothing to Apply", "No TaskNode-owned VFS files are available.", "info");
        return;
      }
      const ledger = reconciliationSnapshot?.ledger || {};
      const unreconciledFiles = collisionFiles.filter((filePath) => {
        const entry = ledger[filePath];
        return !activeReconciledFiles.includes(filePath) ||
          entry?.status !== "reconciled" ||
          entry.sourceSignature !== taskFileRecords[filePath]?.sourceSignature;
      });
      if (unreconciledFiles.length > 0) {
        notify(
          "Reconciliation Required",
          `${unreconciledFiles.length} overlapping file${unreconciledFiles.length === 1 ? " still requires" : "s still require"} reconciliation before Apply Axiom.`,
          "info",
        );
        handleReconcileCode();
        return;
      }
      const vfs = VfsRegistry.getOrCreate(tab.id);
      const staleFiles: string[] = [];
      for (const filePath of collisionFiles) {
        const currentContent = await vfs.readFile(filePath);
        if (currentContent !== reconciliationSnapshot?.generatedFileContents[filePath]) {
          staleFiles.push(filePath);
        }
      }
      if (staleFiles.length > 0) {
        notify(
          "Reconciliation Out of Date",
          `${staleFiles.length} reconciliation-owned file${staleFiles.length === 1 ? " has" : "s have"} changed since the last reconciliation. Reconcile again before applying.`,
          "info"
        );
        handleReconcileCode();
        return;
      }
      const ordinaryChangedFiles = taskOwnedFiles.filter((filePath) => !collisionSet.has(filePath));
      // Stale absolute VFS keys are copied to their active-workspace target;
      // ownership remains with the TaskNode and they do not enter the ledger.
      for (const filePath of ordinaryChangedFiles) {
        const record = taskFileRecords[filePath];
        const sourcePath = record?.sourcePath || filePath;
        const taskContent = record?.taskContent ?? await vfs.readFile(sourcePath);
        let currentContent: string | undefined;
        try {
          currentContent = await vfs.readFile(filePath);
        } catch {
          currentContent = undefined;
        }
        if (sourcePath !== filePath || currentContent !== taskContent) {
          await vfs.writeFile(filePath, taskContent);
        }
      }
      const applyFiles = Array.from(new Set([...collisionFiles, ...ordinaryChangedFiles]));
      await vfs.applyToDisk(applyFiles);
      // Set applied status to true
      useWorkspaceStore.getState().updateCanvasContext(tab.id, { isPipelineApplied: true });
      void canvasFileService.autoSaveCanvas(tab.id);
      notify(
        "Applied",
        `Applied ${collisionFiles.length} reconciled collision file${collisionFiles.length === 1 ? "" : "s"} and ${ordinaryChangedFiles.length} ordinary changed file${ordinaryChangedFiles.length === 1 ? "" : "s"}. The VFS and ledger remain available.`,
        "success"
      );
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
      useWorkspaceStore.getState().updateCanvasContext(tab.id, { hasBeenSaved: true });
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
      <div className="w-full h-full flex flex-row relative terminal-theme-tab">
        <div
          className="flex-1 min-h-0 relative bg-[var(--bg-canvas)]"
          id={`rf-canvas-${tab.id}`}
          onDragOver={onDragOver}
        >
          {/* Top Right Dropdowns */}
          <div className="absolute top-4 right-4 z-10 flex items-center space-x-2">
            {/* Global Chat Node navigation */}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (globalChatNode) focusCanvasNode(tab.id, globalChatNode.id);
                setBoundaryMenuOpen(false);
                setNodeMenuOpen(false);
                setActionMenuOpen(false);
              }}
              disabled={!globalChatNode}
              title={globalChatNode ? `Jump to ${String(globalChatNode.data?.name || "Global Chat")}` : "No Global Chat Node in this Axiom"}
              className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] hover:bg-[var(--bg-header)] disabled:opacity-40 disabled:cursor-not-allowed text-[var(--text-light)] text-xs font-mono font-semibold px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-all shadow-md hover:border-[var(--border-active)] cursor-pointer nodrag"
            >
              <Globe size={14} className="text-[var(--color-status-warning)]" />
              <span>Jump to Global Node</span>
            </button>

            {/* Boundary navigation */}
            <div className="relative">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  if (boundaryNodes.length === 0) return;
                  setBoundaryMenuOpen(!boundaryMenuOpen);
                  setNodeMenuOpen(false);
                  setActionMenuOpen(false);
                }}
                disabled={boundaryNodes.length === 0}
                title={boundaryNodes.length > 0 ? "Jump to a boundary" : "No boundaries in this Axiom"}
                className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] hover:bg-[var(--bg-header)] disabled:opacity-40 disabled:cursor-not-allowed text-[var(--text-light)] text-xs font-mono font-semibold px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-all shadow-md hover:border-[var(--border-active)] cursor-pointer nodrag"
              >
                <Square size={14} className="text-[var(--color-secondary)]" />
                <span>Boundaries</span>
                <ChevronDown size={12} className="text-[var(--text-muted)]" />
              </button>
              {boundaryMenuOpen && (
                <div className="absolute right-0 mt-1 w-56 max-h-64 overflow-y-auto bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-xl py-1 z-20 font-mono text-xs">
                  {boundaryNodes.map((boundary, index) => (
                    <button
                      key={boundary.id}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        focusCanvasNode(tab.id, boundary.id);
                        setBoundaryMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
                      title={String(boundary.data?.name || `Boundary ${index + 1}`)}
                    >
                      <Square size={13} className="text-[var(--color-secondary)] flex-shrink-0" />
                      <span className="truncate">{String(boundary.data?.name || `Boundary ${index + 1}`)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Add Node Dropdown */}
            <div className="relative">
              <button
                id="add-node-dropdown-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setNodeMenuOpen(!nodeMenuOpen);
                  setBoundaryMenuOpen(false);
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
                    <Folder size={13} className="text-[var(--color-status-success)]" />
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
                    <Plug size={13} className="text-[var(--color-status-info)]" />
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
                    <StickyNote size={13} className="text-[var(--color-status-warning)]" />
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
                    <Square size={13} className="text-[var(--color-status-danger)]" />
                    <span>Create Boundary</span>
                  </button>
                  <div className="border-t border-[var(--border-color)] my-1" />
                  <button
                    onClick={() => {
                      const center = getCanvasCenter();
                      addGlobalChatNode(center.x - 75, center.y - 30, tab.id);
                      setNodeMenuOpen(false);
                    }}
                    disabled={hasGlobalChatNode}
                    title={hasGlobalChatNode ? "Only one Global Explorer can be added to an Axiom" : undefined}
                    className={`w-full text-left px-3 py-2 text-[var(--text-normal)] transition-colors flex items-center space-x-2 ${
                      hasGlobalChatNode
                        ? "cursor-not-allowed opacity-50"
                        : "hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] cursor-pointer"
                    }`}
                  >
                    <Globe size={13} className="text-[var(--color-status-danger)]" />
                    <span>{hasGlobalChatNode ? "Global Explorer already added" : "Create Global Explorer"}</span>
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
                  setBoundaryMenuOpen(false);
                  setNodeMenuOpen(false);
                }}
                className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] hover:bg-[var(--bg-header)] text-[var(--text-light)] text-xs font-mono font-semibold px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-all shadow-md hover:border-[var(--border-active)] cursor-pointer nodrag"
              >
                <Settings size={14} className="text-[var(--color-status-danger)]" />
                <span>Action</span>
                <ChevronDown size={12} className="text-[var(--text-muted)]" />
              </button>
              {actionMenuOpen && (
                <div className="absolute right-0 mt-1 w-48 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-xl py-1 z-20 font-mono text-xs border border-[var(--border-color)]">
                  <button
                    onClick={() => {
                      handleReconcileCode();
                      setActionMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
                  >
                    <GitMerge size={13} className="text-[var(--color-status-danger)]" />
                    <span>Reconcile Changes</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSavePipeline();
                      setActionMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
                  >
                    <Save size={13} className="text-[var(--color-status-success)]" />
                    <span>Save Axiom</span>
                  </button>
                  <div className="border-t border-[var(--border-color)] my-1" />
                  <button
                    onClick={() => {
                      if (!isReconciliationRunning) {
                        handleApplyChanges();
                        setActionMenuOpen(false);
                      }
                    }}
                    disabled={isReconciliationRunning}
                    className={`w-full text-left px-3 py-2 flex items-center space-x-2 transition-colors ${
                      isReconciliationRunning
                        ? "text-[var(--color-status-warning)] cursor-not-allowed opacity-75"
                        : isPipelineApplied
                        ? "hover:bg-[var(--accent-bg)] text-[var(--color-status-success)] cursor-pointer"
                        : "hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] cursor-pointer"
                    }`}
                  >
                    {isReconciliationRunning ? (
                      <>
                        <GitMerge size={13} className="text-[var(--color-status-warning)] animate-pulse" />
                        <span>Reconciliation Running</span>
                      </>
                    ) : isPipelineApplied ? (
                      <>
                        <CheckSquare size={13} className="text-[var(--color-status-success)]" />
                        <span>Apply Axiom Again</span>
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
                <Folder size={13} className="text-[var(--color-status-success)]" />
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
                <Plug size={13} className="text-[var(--color-status-info)]" />
                <span>Add MCP Node</span>
              </button>
              <button
                onClick={() => handleAddNodeFromContextMenu("sticky")}
                className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
              >
                <StickyNote size={13} className="text-[var(--color-status-warning)]" />
                <span>Add Sticky Note</span>
              </button>
              <button
                onClick={() => handleAddNodeFromContextMenu("boundary")}
                className="w-full text-left px-3 py-2 hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] text-[var(--text-normal)] transition-colors cursor-pointer flex items-center space-x-2"
              >
                <Square size={13} className="text-[var(--color-status-danger)]" />
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
                disabled={hasGlobalChatNode}
                title={hasGlobalChatNode ? "Only one Global Explorer can be added to an Axiom" : undefined}
                className={`w-full text-left px-3 py-2 text-[var(--text-normal)] transition-colors flex items-center space-x-2 ${
                  hasGlobalChatNode
                    ? "cursor-not-allowed opacity-50"
                    : "hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)] cursor-pointer"
                }`}
              >
                <Globe size={13} className="text-[var(--color-status-danger)]" />
                <span>{hasGlobalChatNode ? "Global Explorer already added" : "Add Global Explorer"}</span>
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
              edges={edges}
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
              multiSelectionKeyCode={["Meta", "Control"]}
            >
              <Background color="var(--color-border-default)" gap={16} size={1} variant={BackgroundVariant.Dots} />
            </ReactFlow>
          </div>

          {possibleConnection && selectedNodes.length === 2 && (
            <FloatingConnectButton
              nodeA={selectedNodes[0]}
              nodeB={selectedNodes[1]}
              onConnect={handleConnectSelected}
            />
          )}
        </div>

        {/* Sliding Drawer Inspector Pane */}
        {(() => {
          const selectedNode = flowNodes.find((n) => n.id === selectedNodeId);
          const showSidePane = selectedNodeId && selectedNode && (
            selectedNode.type === "globalChatNode"
              ? true
              : (selectedNodes.length === 1 && selectedNodes[0].id === selectedNodeId)
          ) && getNodeConfig(selectedNode.type || "").hasSidepane;
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


        {/* Reconciliation Graph Pane */}
        {hasOpenedReconciliationGraphPane && (
          <ReconciliationGraphPane
            onClose={() => setShowReconciliationGraphPane(false)}
            tabId={tab.id}
            isOpen={showReconciliationGraphPane}
          />
        )}

        {/* Save Axiom Prompt Modal */}
        {showSaveModal && (
          <div className="absolute inset-0 bg-[var(--color-surface-overlay)] backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl w-full max-w-md shadow-2xl overflow-hidden font-mono">
              <div className="px-4 py-3 bg-[var(--bg-header)] border-b border-[var(--border-color)] flex items-center justify-between">
                <span className="text-[var(--text-light)] text-sm font-bold flex items-center space-x-2">
                  <Save size={16} className="text-[var(--color-status-success)]" />
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
                  Enter a filename/title for this Axiom. It will be serialized under <code className="text-[var(--color-status-success)] font-bold">.axiom/canvas/</code>.
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
                  className="px-4 py-1.5 bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/90 text-[var(--color-primary-foreground)] rounded-lg text-xs font-semibold cursor-pointer transition-colors shadow-md hover:shadow-lg"
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

const FloatingConnectButton: React.FC<{
  nodeA: any;
  nodeB: any;
  onConnect: () => void;
}> = ({ nodeA, nodeB, onConnect }) => {
  const { x: viewportX, y: viewportY, zoom } = useViewport();

  const getCenter = (node: any) => {
    const width = node.measured?.width ?? (node.type === "taskNode" ? 320 : 288);
    const height = node.measured?.height ?? 120;
    return {
      x: node.position.x + width / 2,
      y: node.position.y + height / 2,
    };
  };

  const centerA = getCenter(nodeA);
  const centerB = getCenter(nodeB);
  const midX = (centerA.x + centerB.x) / 2;
  const midY = (centerA.y + centerB.y) / 2;

  const left = midX * zoom + viewportX;
  const top = midY * zoom + viewportY;

  return (
    <button
      onClick={onConnect}
      style={{
        position: "absolute",
        left: `${left}px`,
        top: `${top}px`,
        transform: "translate(-50%, -50%)",
        zIndex: 1000,
      }}
      className="bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/90 text-[var(--color-primary-foreground)] rounded-full p-3 shadow-2xl border border-[var(--border-color)] cursor-pointer flex items-center justify-center transition-all hover:scale-110 active:scale-95 duration-200"
      title="Connect nodes"
    >
      <Link2 size={18} />
    </button>
  );
};
