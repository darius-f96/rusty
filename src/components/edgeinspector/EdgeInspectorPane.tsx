/**
 * EdgeInspectorPane Component
 * 
 * The main container and layout coordinator for the Edge Inspector.
 * It uses store selectors to fetch the selected edge and its connecting nodes,
 * calls state management hooks, and delegates view rendering to tab sub-components.
 */

import React, { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useWorkspaceStore } from "../../store";

// Hooks
import { useEdgeDiff } from "./useEdgeDiff";
import { useEdgeWebSocket } from "./useEdgeWebSocket";

// Components
import { EdgeInspectorHeader } from "./components/EdgeInspectorHeader";
import { EdgeInspectorTabs } from "./components/EdgeInspectorTabs";
import { ConflictsTabContent } from "./components/ConflictsTabContent";
import { EdgeDiffTabContent } from "./components/EdgeDiffTabContent";
import { ResolveChatTabContent } from "./components/ResolveChatTabContent";

interface EdgeInspectorPaneProps {
  onClose: () => void;
}

export const EdgeInspectorPane: React.FC<EdgeInspectorPaneProps> = ({ onClose }) => {
  const selectedEdgeId = useWorkspaceStore((state) => state.selectedEdgeId);
  const edges = useWorkspaceStore((state) => state.edges);
  const nodes = useWorkspaceStore((state) => state.nodes);
  const setEdgeStatus = useWorkspaceStore((state) => state.setEdgeStatus);
  const setSelectedEdgeId = useWorkspaceStore((state) => state.setSelectedEdgeId);

  const edgeStatus = useWorkspaceStore(
    (state) => state.edgeReconciliationStatus[selectedEdgeId || ""] || "idle"
  );

  const [activeTab, setActiveTab] = useState<"conflicts" | "diff" | "chat">("conflicts");

  const edge = edges.find((e) => e.id === selectedEdgeId);
  const sourceNode = edge ? nodes.find((n) => n.id === edge.source) : null;
  const targetNode = edge ? nodes.find((n) => n.id === edge.target) : null;

  const sourceModifiedFiles = (sourceNode?.data?.modifiedFiles as string[]) || [];

  // Diff hook
  const diff = useEdgeDiff(edge, sourceNode, targetNode, sourceModifiedFiles);

  // WebSocket hook
  const ws = useEdgeWebSocket(
    selectedEdgeId,
    sourceNode,
    targetNode,
    sourceModifiedFiles,
    diff.diffFile,
    diff.loadDiffContent
  );

  const handleApproveReconciliation = () => {
    if (selectedEdgeId) {
      setEdgeStatus(selectedEdgeId, "reconciled");
      setSelectedEdgeId(null);
      onClose();
    }
  };

  if (!edge || !sourceNode || !targetNode) return null;

  return (
    <div className="w-[500px] border-l border-[var(--border-color)] bg-[var(--bg-app)]/95 flex flex-col h-full text-[var(--text-normal)] font-sans shadow-2xl">
      {/* Header */}
      <EdgeInspectorHeader
        sourceNode={sourceNode}
        targetNode={targetNode}
        onClose={onClose}
      />

      {/* Tabs */}
      <EdgeInspectorTabs
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      {/* Tabs Content */}
      <div className="flex-1 overflow-hidden relative bg-[var(--bg-app)]">
        {activeTab === "conflicts" && (
          <ConflictsTabContent conflictDetails={diff.conflictDetails} />
        )}

        {activeTab === "diff" && (
          <EdgeDiffTabContent
            sourceModifiedFiles={sourceModifiedFiles}
            diffFile={diff.diffFile}
            setDiffFile={diff.setDiffFile}
            loadDiffContent={diff.loadDiffContent}
            originalCode={diff.originalCode}
            modifiedCode={diff.modifiedCode}
          />
        )}

        {activeTab === "chat" && (
          <ResolveChatTabContent
            chatMessages={ws.chatMessages}
            chatInput={ws.chatInput}
            setChatInput={ws.setChatInput}
            isResolving={ws.isResolving}
            chatEndRef={ws.chatEndRef}
            handleSendChat={ws.handleSendChat}
          />
        )}
      </div>

      {/* Footer — Approve Reconciliation */}
      <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 flex items-center justify-between flex-shrink-0">
        <span className="text-[10px] uppercase font-mono text-[var(--text-muted)]">
          Status:{" "}
          <span
            className={`font-bold ${
              edgeStatus === "reconciled"
                ? "text-emerald-400"
                : edgeStatus === "unreconciled"
                ? "text-rose-400"
                : "text-[var(--text-normal)]"
            }`}
          >
            {edgeStatus}
          </span>
        </span>
        <button
          onClick={handleApproveReconciliation}
          className="bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-mono font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all shadow-md cursor-pointer"
        >
          <CheckCircle2 size={14} />
          <span>Approve Reconciliation</span>
        </button>
      </div>
    </div>
  );
};
