import React, { useContext } from "react";
import {
  BaseEdge,
  getBezierPath,
  EdgeLabelRenderer,
  type EdgeProps,
} from "@xyflow/react";
import { useWorkspaceStore } from "../store";
import { CanvasTabContext } from "./tabs/canvas/CanvasTabContext";

export const ReconciliationEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  selected,
}) => {
  const { tabId } = useContext(CanvasTabContext);
  const status = useWorkspaceStore(
    (state) => (state.canvasContexts[tabId] || { edgeReconciliationStatus: {} }).edgeReconciliationStatus[id] || "idle"
  );
  const setSelectedEdgeId = useWorkspaceStore((state) => state.setSelectedEdgeId);
  const setSelectedNodeId = useWorkspaceStore((state) => state.setSelectedNodeId);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Visual styling per reconciliation status
  const strokeColors: Record<string, string> = {
    idle: "#6366F1",
    unreconciled: "#EF4444",
    reconciled: "#10B981",
  };

  const strokeColor = strokeColors[status] || strokeColors.idle;

  // Animated dash for unreconciled edges
  const dashArray = status === "unreconciled" ? "8 4" : undefined;
  const animationStyle =
    status === "unreconciled"
      ? {
          animation: "dash-flow 1.2s linear infinite",
        }
      : {};



  const handleBadgeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedNodeId(null);
    setSelectedEdgeId(id);
  };

  return (
    <>
      {/* Invisible wider click target */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{ cursor: "pointer" }}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: selected ? "#6366F1" : strokeColor,
          strokeWidth: selected ? 4 : 2.5,
          strokeDasharray: dashArray,
          filter: selected
            ? "drop-shadow(0 0 6px rgba(99, 102, 241, 0.6))"
            : status === "unreconciled"
            ? "drop-shadow(0 0 4px rgba(239, 68, 68, 0.5))"
            : status === "reconciled"
            ? "drop-shadow(0 0 4px rgba(16, 185, 129, 0.4))"
            : "none",
          ...animationStyle,
        }}
      />
      {/* Status badge at midpoint */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan"
        >
          {status === "unreconciled" && (
            <button
              onClick={handleBadgeClick}
              className="bg-rose-500/90 text-white text-[9px] font-mono font-bold px-2 py-0.5 rounded-full shadow-lg hover:bg-rose-400 transition-all cursor-pointer backdrop-blur-sm"
              title="Click to resolve conflicts"
            >
              ⚠ Conflict
            </button>
          )}
          {status === "reconciled" && (
            <span className="bg-emerald-500/90 text-white text-[9px] font-mono font-bold px-2 py-0.5 rounded-full shadow-lg backdrop-blur-sm">
              ✓ Aligned
            </span>
          )}
        </div>
      </EdgeLabelRenderer>

      {/* CSS keyframes for dash animation */}
      <style>{`
        @keyframes dash-flow {
          to {
            stroke-dashoffset: -24;
          }
        }
      `}</style>
    </>
  );
};
