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
import { DescriptionTabContent } from "./components/DescriptionTabContent";
import { DiffTabContent } from "./components/DiffTabContent";
import { ConsoleTabContent } from "./components/ConsoleTabContent";
import { ExplorerChatContent } from "./components/ExplorerChatContent";
import { PromptChatContent } from "./components/PromptChatContent";
import { VfsExplorer } from "./components/VfsExplorer";
import { CustomSelect } from "../CustomSelect";
import { VfsRegistry, VFS_CHANGED_EVENT } from "../../services/vfs";
import { canvasFileService } from "../tabs/canvas/services/canvasFileService";
import { notify } from "../../notificationStore";
import { selectableProviderModels } from "../../store/providerHelpers";
import { TokenBadge, TokenUsageLike } from "../ui/TokenBadge/TokenBadge";

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
  const selectedChatMessageCount = useWorkspaceStore((state) => state.globalChatHistory[selectedNodeId || ""]?.length || 0);
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const modifiedFiles = (selectedNode?.data?.modifiedFiles as string[]) || EMPTY_ARRAY;
  const originalFileContents = (selectedNode?.data?.originalFileContents as Record<string, string>) || {};
  const generatedFileContents = (selectedNode?.data?.generatedFileContents as Record<string, string>) || {};

  const [activeTab, setActiveTab] = useState<"description" | "diff" | "chat" | "console" | "vfs">("description");
  const [activeDiffFile, setActiveDiffFile] = useState<string>("");
  const [isMaximized, setIsMaximized] = useState(false);

  const nodeType = selectedNode?.type || "default";
  const storageKey = `side_pane_width_${nodeType}`;

  // Resize hook
  const { width, setWidth, containerRef, startResizing } = useResizable(500, storageKey);

  // Explorer WS hook
  const explorer = useExplorerWebSocket(selectedNode);

  const [nodeUsage, setNodeUsage] = useState<TokenUsageLike | null>(null);
  useEffect(() => {
    setNodeUsage(null);
    if (!selectedNodeId) return;
    const handleNodeUsage = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId: string; usage: TokenUsageLike }>).detail;
      if (detail?.nodeId === selectedNodeId) setNodeUsage(detail.usage);
    };
    window.addEventListener("axiom-node-usage", handleNodeUsage);
    return () => window.removeEventListener("axiom-node-usage", handleNodeUsage);
  }, [selectedNodeId]);

  // The VFS tracker is the source of truth for files owned by a task. Chat tool
  // writes update that tracker directly, so keep the node's UI cache in sync.
  useEffect(() => {
    if (!tabId || !selectedNodeId || selectedNode?.type !== "taskNode") return;

    let cancelled = false;
    const syncModifiedFiles = async () => {
      try {
        const trackedFiles = await VfsRegistry.getOrCreate(tabId).getNodeFiles(selectedNodeId);
        if (cancelled) return;

        const latestNode = useWorkspaceStore.getState().canvasContexts[tabId]?.nodes
          .find((node) => node.id === selectedNodeId);
        const currentFiles = (latestNode?.data?.modifiedFiles as string[]) || [];
        const originalFileContents = (latestNode?.data?.originalFileContents as Record<string, string>) || {};
        const generatedFileContents = (latestNode?.data?.generatedFileContents as Record<string, string>) || {};
        if (
          trackedFiles.length !== currentFiles.length ||
          trackedFiles.some((file, index) => file !== currentFiles[index])
        ) {
          useWorkspaceStore.getState().updateTaskNode(selectedNodeId, {
            modifiedFiles: trackedFiles,
            originalFileContents: Object.fromEntries(
              trackedFiles
                .filter((file) => originalFileContents[file] !== undefined)
                .map((file) => [file, originalFileContents[file]])
            ),
            generatedFileContents: Object.fromEntries(
              trackedFiles
                .filter((file) => generatedFileContents[file] !== undefined)
                .map((file) => [file, generatedFileContents[file]])
            ),
          });
        }
      } catch (err) {
        console.error("[SidePane] Failed to sync task files from VFS:", err);
      }
    };

    const handleVfsChanged = (event: Event) => {
      const changedTabId = (event as CustomEvent<{ tabId: string }>).detail?.tabId;
      if (changedTabId === tabId) void syncModifiedFiles();
    };

    void syncModifiedFiles();
    window.addEventListener(VFS_CHANGED_EVENT, handleVfsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(VFS_CHANGED_EVENT, handleVfsChanged);
    };
  }, [
    tabId,
    selectedNodeId,
    selectedNode?.type,
    selectedNode?.data?.modifiedFiles,
    selectedNode?.data?.originalFileContents,
    selectedNode?.data?.generatedFileContents,
  ]);

  // Diff content hook
  const { originalCode, modifiedCode, isLoading: isDiffLoading } = useDiffContent(
    selectedNodeId,
    activeDiffFile,
    nodeStatus,
    tabId,
    originalFileContents[activeDiffFile],
    generatedFileContents[activeDiffFile]
  );

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
    } else if (selectedNode.type === "taskNode") {
      setActiveTab("description");
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
      style={{ width: isMaximized ? "100%" : `${width}px` }} 
      className={`border-l border-[var(--border-color)] bg-[var(--bg-app)]/95 flex flex-col h-full text-[var(--text-normal)] font-sans shadow-2xl z-[40] max-w-full ${
        isMaximized ? "absolute inset-0" : "absolute right-0 top-0 bottom-0"
      }`}
    >
      {/* Resizer Handle */}
      {!isMaximized && (
        <div
          onMouseDown={startResizing}
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[var(--color-status-danger-bg)] active:bg-[var(--color-status-danger-solid)] transition-colors z-50"
          style={{ transform: "translateX(-50%)" }}
        />
      )}

      {/* Pane Header */}
      <SidePaneHeader
        selectedNode={selectedNode}
        onClose={onClose}
        isMaximized={isMaximized}
        onToggleMaximize={() => setIsMaximized(!isMaximized)}
        onGenerateTasks={() => {
          setActiveTab("chat");
          explorer.handleOpenTaskGeneration();
        }}
        onStopGenerateTasks={explorer.handleStopTaskGeneration}
        onSummarize={explorer.handleExplorerSummarize}
        isGeneratingTasks={explorer.isGeneratingTasks}
        isSummarizing={explorer.isSummarizing}
        disableGlobalActions={nodeStatus === "running" || selectedChatMessageCount === 0}
        taskGenerationModel={explorer.taskGenerationModel}
        taskGenerationModels={explorer.allAvailableModels}
        onTaskGenerationModelChange={(model) => useWorkspaceStore.getState().updateTaskNode(selectedNode.id, { taskGenerationModel: model })}
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
        {activeTab === "description" && selectedNode.type === "taskNode" && (
          <DescriptionTabContent selectedNode={selectedNode} tabId={tabId} />
        )}

        {activeTab === "diff" && selectedNode.type !== "globalChatNode" && (
          <DiffTabContent
            selectedNode={selectedNode}
            modifiedFiles={modifiedFiles}
            activeDiffFile={activeDiffFile}
            setActiveDiffFile={setActiveDiffFile}
            originalCode={originalCode}
            modifiedCode={modifiedCode}
            isDiffLoading={isDiffLoading}
            tabId={tabId}
          />
        )}

        {activeTab === "console" && selectedNodeId && selectedNode.type !== "contextNode" && (
          <ConsoleTabContent selectedNodeId={selectedNodeId} tabId={tabId} />
        )}

        {activeTab === "chat" && (
          selectedNode.type === "globalChatNode" ? (
            <ExplorerChatContent
              selectedNode={selectedNode}
              nodeStatus={nodeStatus}
              explorerInput={explorer.explorerInput}
              setExplorerInput={explorer.setExplorerInput}
              handleExplorerSendMessage={explorer.handleExplorerSendMessage}
              generatedTaskDraft={explorer.generatedTaskDraft}
              setGeneratedTaskDraft={explorer.setGeneratedTaskDraft}
              generatedContextDraft={explorer.generatedContextDraft}
              setGeneratedContextDraft={explorer.setGeneratedContextDraft}
              isTaskGenerationPromptOpen={explorer.isTaskGenerationPromptOpen}
              setIsTaskGenerationPromptOpen={explorer.setIsTaskGenerationPromptOpen}
              taskGenerationInstructions={explorer.taskGenerationInstructions}
              setTaskGenerationInstructions={explorer.setTaskGenerationInstructions}
              taskGenerationFailure={explorer.taskGenerationFailure}
              taskGenerationModel={explorer.taskGenerationModel}
              isGeneratingTasks={explorer.isGeneratingTasks}
              handleGenerateTaskDraft={explorer.handleGenerateTaskDraft}
              onCreateTaskNodes={async (tasks, contexts) => {
                if (!tabId) return;
                const created = useWorkspaceStore.getState().addTaskNodesBatch(tabId, selectedNode.id, tasks, contexts);
                if (created.length > 0) {
                  await canvasFileService.autoSaveCanvas(tabId);
                  notify(
                    "Generated Nodes Created",
                    `Added ${created.length} task node${created.length === 1 ? "" : "s"}${contexts.length ? ` and ${contexts.length} code context node${contexts.length === 1 ? "" : "s"}` : ""}.`,
                    "success"
                  );
                }
              }}
              handleStopExplorer={explorer.handleStopExplorer}
              streamingMessageId={explorer.streamingMessageId}
              exploreModel={explorer.exploreModel}
              summarizeModel={explorer.summarizeModel}
              allAvailableModels={explorer.allAvailableModels}
              subagents={explorer.subagents}
              agentQuestion={explorer.agentQuestion}
              handleAgentQuestionAnswer={explorer.handleAgentQuestionAnswer}
            />
          ) : (
            <PromptChatContent
              selectedNode={selectedNode}
              nodeStatus={nodeStatus}
              explorerInput={explorer.explorerInput}
              setExplorerInput={explorer.setExplorerInput}
              handleExplorerSendMessage={explorer.handleExplorerSendMessage}
              handleStopExplorer={explorer.handleStopExplorer}
              streamingMessageId={explorer.streamingMessageId}
              subagents={explorer.subagents}
              agentQuestion={explorer.agentQuestion}
              handleAgentQuestionAnswer={explorer.handleAgentQuestionAnswer}
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
          <span className="flex items-center gap-2 text-[10px] uppercase font-mono text-[var(--text-muted)]">
            Status: <span className="font-bold text-[var(--text-normal)]">{nodeStatus}</span>
            {nodeUsage && <TokenBadge usage={nodeUsage} live={nodeStatus === "running"} />}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-mono text-[var(--text-muted)]">Model:</span>
            <CustomSelect
              value={(selectedNode.data as any).model || ""}
              onChange={(val) => {
                const updateTaskNode = useWorkspaceStore.getState().updateTaskNode;
                updateTaskNode(selectedNode.id, { model: val });
              }}
              options={selectableProviderModels(customProviders, activeCustomProviderId).map(({ model }) => ({
                id: model.id,
                name: model.name,
              }))}
              placeholder="Select model"
              className="w-36"
            />
          </div>
          {nodeStatus === "running" ? (
            <button
              onClick={() => onStopExecution(selectedNode.id)}
              className="bg-[var(--color-status-danger-solid)] hover:bg-[var(--color-status-danger-solid)] text-[var(--color-status-danger-solid-foreground)] text-xs font-mono font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all shadow-md cursor-pointer"
            >
              <Octagon size={14} />
              <span>Stop</span>
            </button>
          ) : (
            <button
              onClick={() => onExecuteNode(selectedNode.id)}
              className="bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] text-[var(--color-primary-foreground)] text-xs font-mono font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all glow-btn shadow-md cursor-pointer"
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
