import React from "react";
import { X } from "lucide-react";

interface SidePaneHeaderProps {
  selectedNode: any;
  onClose: () => void;
}

export const SidePaneHeader: React.FC<SidePaneHeaderProps> = ({
  selectedNode,
  onClose
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
