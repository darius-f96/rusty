import React, { useState, useEffect } from "react";
import { Sparkles, Octagon } from "lucide-react";
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
import { VfsExplorer } from "./components/VfsExplorer";
import { CustomSelect } from "../CustomSelect";

const EMPTY_ARRAY: any[] = [];

interface SidePaneProps {
  onClose: () => void;
  onExecuteNode: (nodeId: string, customPrompt?: string) => void;
  onStopExecution: (nodeId: string) => void;
  tabId?: string;
}

export const SidePane: React.FC<SidePaneProps> = ({ onClose, onExecuteNode, onStopExecution, tabId }) => {
  const selectedNodeId = useWorkspaceStore((state) => state.selectedNodeId);
  const nodes = useWorkspaceStore((state) => state.nodes);
  const nodeStatus = useWorkspaceStore((state) => state.nodeStatus[selectedNodeId || ""] || "idle");

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const modifiedFiles = (selectedNode?.data?.modifiedFiles as string[]) || EMPTY_ARRAY;

  const [activeTab, setActiveTab] = useState<"diff" | "chat" | "console" | "vfs">("diff");
  const [activeDiffFile, setActiveDiffFile] = useState<string>("");

  const nodeType = selectedNode?.type || "default";
  const storageKey = `side_pane_width_${nodeType}`;

  // Resize hook
  const { width, setWidth, containerRef, startResizing } = useResizable(500, storageKey);

  // Explorer WS hook
  const explorer = useExplorerWebSocket(selectedNode);

  // Diff content hook
  const { originalCode, modifiedCode, isLoading: isDiffLoading } = useDiffContent(selectedNodeId, activeDiffFile, nodeStatus);

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

  // Close sidepane on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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
            isDiffLoading={isDiffLoading}
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
              handleExplorerSendMessage={explorer.handleExplorerSendMessage}
              handleExplorerSummarize={explorer.handleExplorerSummarize}
              handleStopExplorer={explorer.handleStopExplorer}
              streamingMessageId={explorer.streamingMessageId}
              exploreModel={explorer.exploreModel}
              summarizeModel={explorer.summarizeModel}
              allAvailableModels={explorer.allAvailableModels}
            />
          ) : (
            <PromptChatContent
              selectedNode={selectedNode}
              nodeStatus={nodeStatus}
              onExecuteNode={onExecuteNode}
              onStopExecution={onStopExecution}
            />
          )
        )}

        {activeTab === "vfs" && (
          <div className="h-full" style={{ width: `${width - 8}px` }}>
            <VfsExplorer tabId={tabId} />
          </div>
        )}
      </div>

      {/* Footer controls for executing node */}
      {selectedNode.type === "taskNode" && activeTab !== "chat" && (
        <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 flex items-center justify-between gap-3">
          <span className="text-[10px] uppercase font-mono text-[var(--text-muted)]">
            Status: <span className="font-bold text-[var(--text-normal)]">{nodeStatus}</span>
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-mono text-[var(--text-muted)]">Model:</span>
            <CustomSelect
              value={(selectedNode.data as any).model || ""}
              onChange={(val) => {
                const updateTaskNode = useWorkspaceStore.getState().updateTaskNode;
                updateTaskNode(selectedNode.id, { model: val });
              }}
              options={useWorkspaceStore.getState().customProviders.flatMap((p) => p.models).map((m) => ({
                id: m.id,
                name: `${m.name}`,
              }))}
              placeholder="Select model"
              className="w-36"
            />
          </div>
          {nodeStatus === "running" ? (
            <button
              onClick={() => onStopExecution(selectedNode.id)}
              className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-mono font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all shadow-md cursor-pointer"
            >
              <Octagon size={14} />
              <span>Stop</span>
            </button>
          ) : (
            <button
              onClick={() => onExecuteNode(selectedNode.id)}
              className="bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] text-white text-xs font-mono font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all glow-btn shadow-md cursor-pointer"
            >
              <Sparkles size={14} />
              <span>Run Executor</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
