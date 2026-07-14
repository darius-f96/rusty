import React from "react";
import { X, Maximize2, Minimize2, Sparkles, ListPlus } from "lucide-react";
import { CustomSelect } from "../../CustomSelect";

interface SidePaneHeaderProps {
  selectedNode: any;
  onClose: () => void;
  isMaximized: boolean;
  onToggleMaximize: () => void;
  onGenerateTasks?: () => void;
  onSummarize?: () => void;
  isGeneratingTasks?: boolean;
  isSummarizing?: boolean;
  disableGlobalActions?: boolean;
  taskGenerationModel?: string;
  taskGenerationModels?: { id: string; name: string }[];
  onTaskGenerationModelChange?: (model: string) => void;
}

export const SidePaneHeader: React.FC<SidePaneHeaderProps> = ({
  selectedNode,
  onClose,
  isMaximized,
  onToggleMaximize,
  onGenerateTasks,
  onSummarize,
  isGeneratingTasks,
  isSummarizing,
  disableGlobalActions,
  taskGenerationModel,
  taskGenerationModels = [],
  onTaskGenerationModelChange,
}) => {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/40 select-none flex-shrink-0">
      <div className="flex flex-col">
        <span className="font-mono text-xs text-[var(--text-muted)] uppercase tracking-wider">
          {selectedNode.type === "globalChatNode" ? "Workspace Explorer" : "Inspector"}
        </span>
        <span className="font-semibold text-sm truncate max-w-[320px]">
          {selectedNode.type === "contextNode"
            ? (selectedNode.data as any).name
            : (selectedNode.data as any).name || `Task Node (${selectedNode.id})`}
        </span>
      </div>
      <div className="flex items-center space-x-1">
        {selectedNode.type === "globalChatNode" && (
          <>
            <CustomSelect
              value={taskGenerationModel || ""}
              onChange={(value) => onTaskGenerationModelChange?.(value)}
              options={taskGenerationModels}
              placeholder="Task model"
              className="w-36"
              direction="down"
            />
            <button
              onClick={onGenerateTasks}
              disabled={disableGlobalActions || isGeneratingTasks}
              className="text-emerald-400 hover:text-emerald-300 disabled:text-[var(--text-muted)] disabled:opacity-50 transition-colors px-2 py-1 rounded-lg hover:bg-emerald-500/10 cursor-pointer flex items-center gap-1 text-[10px] font-mono"
              title="Generate editable TaskNode drafts from this conversation"
            >
              <ListPlus size={14} className={isGeneratingTasks ? "animate-pulse" : ""} />
              <span>{isGeneratingTasks ? "Generating" : "Generate Tasks"}</span>
            </button>
            <button
              onClick={onSummarize}
              disabled={disableGlobalActions || isSummarizing}
              className="text-amber-400 hover:text-amber-300 disabled:text-[var(--text-muted)] disabled:opacity-50 transition-colors px-2 py-1 rounded-lg hover:bg-amber-500/10 cursor-pointer flex items-center gap-1 text-[10px] font-mono"
              title="Generate global architectural summary"
            >
              <Sparkles size={14} className={isSummarizing ? "animate-spin" : ""} />
              <span>Summarize</span>
            </button>
            <div className="h-5 w-px bg-[var(--border-color)] mx-1" />
          </>
        )}
        <button
          onClick={onToggleMaximize}
          className="text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors p-1 rounded-lg hover:bg-[var(--bg-sidebar)] cursor-pointer"
          title={isMaximized ? "Restore size" : "Maximize to fullscreen"}
        >
          {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <button
          onClick={onClose}
          className="text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors p-1 rounded-lg hover:bg-[var(--bg-sidebar)] cursor-pointer"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};
