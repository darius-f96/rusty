/**
 * EdgeInspectorHeader Component
 * 
 * Renders the top header for the Edge Inspector Pane, displaying the source
 * and target nodes' names, and provides a close button.
 */

import React from "react";
import { X, AlertTriangle, Trash2 } from "lucide-react";

interface EdgeInspectorHeaderProps {
  sourceNode: any;
  targetNode: any;
  onClose: () => void;
  onDelete?: () => void;
}

export const EdgeInspectorHeader: React.FC<EdgeInspectorHeaderProps> = ({
  sourceNode,
  targetNode,
  onClose,
  onDelete
}) => {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] bg-gradient-to-r from-rose-500/10 to-transparent flex-shrink-0">
      <div className="flex flex-col">
        <span className="font-mono text-xs text-rose-400 uppercase tracking-wider flex items-center space-x-1.5">
          <AlertTriangle size={12} />
          <span>Edge Inspector</span>
        </span>
        <span className="font-semibold text-sm truncate max-w-[280px]">
          {(sourceNode?.data as any)?.name || sourceNode?.id} → {(targetNode?.data as any)?.name || targetNode?.id}
        </span>
      </div>
      <div className="flex items-center space-x-2">
        {onDelete && (
          <button
            onClick={onDelete}
            title="Delete Connection"
            className="text-rose-400 hover:text-rose-300 transition-colors p-1 rounded-lg hover:bg-rose-500/10 cursor-pointer"
          >
            <Trash2 size={15} />
          </button>
        )}
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
