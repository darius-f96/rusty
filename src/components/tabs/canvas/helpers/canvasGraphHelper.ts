import { Node, Edge, Connection } from "@xyflow/react";

export const canvasGraphHelper = {
  isValidConnection: (connection: Connection, nodes: Node[], edges: Edge[]): boolean => {
    const { source, target, sourceHandle, targetHandle } = connection;
    if (source === target) return false;

    const sourceNode = nodes.find((n) => n.id === source);
    const targetNode = nodes.find((n) => n.id === target);
    if (!sourceNode || !targetNode) return false;

    // Context nodes are not allowed to be connected to other ContextNodes
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

  getCanvasCenter: (rfInstance: any): { x: number; y: number } => {
    if (rfInstance) {
      const reactFlowBounds = document.getElementById("rf-canvas")?.getBoundingClientRect();
      if (reactFlowBounds) {
        const x = reactFlowBounds.left + reactFlowBounds.width / 2;
        const y = reactFlowBounds.top + reactFlowBounds.height / 2;
        return rfInstance.screenToFlowPosition({ x, y });
      }
    }
    return { x: 300, y: 200 };
  },

  styleEdges: (edges: Edge[]): Edge[] => {
    return edges.map((edge) => {
      if (edge.sourceHandle === "task-out" && edge.targetHandle === "task-in") {
        return { ...edge, type: "reconciliationEdge" };
      }
      return edge;
    });
  }
};
