import React, { useState, useEffect } from "react";
import { Sparkles } from "lucide-react";
import { useWorkspaceStore } from "../../store";

// Hooks
import { useResizable } from "./useResizable";
import { useDiffContent } from "./useDiffContent";
import { useExplorerWebSocket } from "./useExplorerWebSocket";

// Components
import { SidePaneHeader } from "./components/SidePaneHeader";
import { SidePaneTabs } from "./components/SidePaneTabs";
import { DiffTabContent } from "./components/DiffTabContent";
import { ConsoleTabContent } from "./components/ConsoleTabContent";
import { ExplorerChatContent } from "./components/ExplorerChatContent";
import { PromptChatContent } from "./components/PromptChatContent";

const EMPTY_ARRAY: any[] = [];

interface SidePaneProps {
  onClose: () => void;
  onExecuteNode: (nodeId: string, customPrompt?: string) => void;
}

export const SidePane: React.FC<SidePaneProps> = ({ onClose, onExecuteNode }) => {
  const selectedNodeId = useWorkspaceStore((state) => state.selectedNodeId);
  const nodes = useWorkspaceStore((state) => state.nodes);
  const nodeStatus = useWorkspaceStore((state) => state.nodeStatus[selectedNodeId || ""] || "idle");

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const modifiedFiles = (selectedNode?.data?.modifiedFiles as string[]) || EMPTY_ARRAY;

  const [activeTab, setActiveTab] = useState<"diff" | "chat" | "console">("diff");
  const [activeDiffFile, setActiveDiffFile] = useState<string>("");

  const nodeType = selectedNode?.type || "default";
  const storageKey = `side_pane_width_${nodeType}`;

  // Resize hook
  const { width, setWidth, containerRef, startResizing } = useResizable(500, storageKey);

  // Explorer WS hook
  const explorer = useExplorerWebSocket(selectedNode);

  // Diff content hook
  const { originalCode, modifiedCode } = useDiffContent(selectedNodeId, activeDiffFile, nodeStatus);

  // Sync width when storageKey changes (different node type selected)
  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const val = parseInt(stored, 10);
      if (!isNaN(val) && val > 200 && val < 1200) {
        setWidth(val);
        if (containerRef.current) {
          containerRef.current.style.width = `${val}px`;
        }
        return;
      }
    }
    const defaultWidth = 500;
    setWidth(defaultWidth);
    if (containerRef.current) {
      containerRef.current.style.width = `${defaultWidth}px`;
    }
  }, [storageKey, setWidth, containerRef]);

  // Set default active tab based on selected node type
  useEffect(() => {
    if (!selectedNode) return;
    if (selectedNode.type === "globalChatNode") {
      setActiveTab("chat");
    } else {
      setActiveTab("diff");
    }
  }, [selectedNode?.id, selectedNode?.type]);

  // Select which file should be shown in the diff viewer
  useEffect(() => {
    if (!selectedNode) return;
    if (selectedNode.type === "contextNode") {
      const path = selectedNode.data.path as string;
      if (path && !selectedNode.data.isDir) {
        if (activeDiffFile !== path) {
          setActiveDiffFile(path);
        }
      }
    } else if (selectedNode.type === "taskNode") {
      if (modifiedFiles.length > 0) {
        if (!modifiedFiles.includes(activeDiffFile)) {
          setActiveDiffFile(modifiedFiles[0]);
        }
      } else {
        if (activeDiffFile !== "") {
          setActiveDiffFile("");
        }
      }
    }
  }, [selectedNode?.id, modifiedFiles, activeDiffFile]);

  if (!selectedNode) return null;

  return (
    <div 
      ref={containerRef}
      style={{ width: `${width}px` }} 
      className="border-l border-[var(--border-color)] bg-[var(--bg-app)]/95 flex flex-col h-full text-[var(--text-normal)] font-sans shadow-2xl relative"
    >
      {/* Resizer Handle */}
      <div
        onMouseDown={startResizing}
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-violet-500/50 active:bg-violet-500 transition-colors z-50"
        style={{ transform: "translateX(-50%)" }}
      />

      {/* Pane Header */}
      <SidePaneHeader
        selectedNode={selectedNode}
        showSettings={explorer.showSettings}
        setShowSettings={explorer.setShowSettings}
        onClose={onClose}
      />

      {/* Tabs Row */}
      <SidePaneTabs
        selectedNode={selectedNode}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        nodeStatus={nodeStatus}
      />

      {/* Tabs Content */}
      <div className="flex-1 overflow-hidden relative bg-[var(--bg-app)]">
        {activeTab === "diff" && selectedNode.type !== "globalChatNode" && (
          <DiffTabContent
            selectedNode={selectedNode}
            modifiedFiles={modifiedFiles}
            activeDiffFile={activeDiffFile}
            setActiveDiffFile={setActiveDiffFile}
            originalCode={originalCode}
            modifiedCode={modifiedCode}
          />
        )}

        {activeTab === "console" && selectedNodeId && selectedNode.type !== "contextNode" && (
          <ConsoleTabContent selectedNodeId={selectedNodeId} />
        )}

        {activeTab === "chat" && (
          selectedNode.type === "globalChatNode" ? (
            <ExplorerChatContent
              selectedNode={selectedNode}
              nodeStatus={nodeStatus}
              explorerInput={explorer.explorerInput}
              setExplorerInput={explorer.setExplorerInput}
              isSummarizing={explorer.isSummarizing}
              showSettings={explorer.showSettings}
              setShowSettings={explorer.setShowSettings}
              handleExplorerSendMessage={explorer.handleExplorerSendMessage}
              handleExplorerSummarize={explorer.handleExplorerSummarize}
              exploreModel={explorer.exploreModel}
              summarizeModel={explorer.summarizeModel}
              providers={explorer.providers}
              activeCustomProviderId={explorer.activeCustomProviderId}
              availableModels={explorer.availableModels}
            />
          ) : (
            <PromptChatContent
              selectedNode={selectedNode}
              nodeStatus={nodeStatus}
              onExecuteNode={onExecuteNode}
            />
          )
        )}
      </div>

      {/* Footer controls for executing node */}
      {selectedNode.type === "taskNode" && activeTab !== "chat" && (
        <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 flex items-center justify-between">
          <span className="text-[10px] uppercase font-mono text-[var(--text-muted)]">
            Status: <span className="font-bold text-[var(--text-normal)]">{nodeStatus}</span>
          </span>
          <button
            onClick={() => onExecuteNode(selectedNode.id)}
            disabled={nodeStatus === "running"}
            className="bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] text-white text-xs font-mono font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all glow-btn shadow-md cursor-pointer"
          >
            <Sparkles size={14} className={nodeStatus === "running" ? "animate-spin" : ""} />
            <span>{nodeStatus === "running" ? "Running..." : "Run Executor"}</span>
          </button>
        </div>
      )}
    </div>
  );
};
