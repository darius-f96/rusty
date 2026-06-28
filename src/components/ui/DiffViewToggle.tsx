import React from "react";
import { Columns2, ArrowUpDown } from "lucide-react";
import { DiffViewMode } from "../../hooks/useDiffViewMode";

interface DiffViewToggleProps {
  viewMode: DiffViewMode;
  isAutoMode: boolean;
  onToggle: () => void;
  onEnableAuto: () => void;
}

export const DiffViewToggle: React.FC<DiffViewToggleProps> = ({
  viewMode,
  isAutoMode,
  onToggle,
  onEnableAuto,
}) => {
  return (
    <div className="flex items-center space-x-1 border border-[var(--border-color)] rounded-md p-0.5 bg-[var(--bg-app)]">
      <button
        onClick={onEnableAuto}
        className={`px-1.5 py-0.5 text-[9px] font-mono rounded transition-colors ${
          isAutoMode
            ? "bg-[var(--accent-color)] text-white"
            : "text-[var(--text-muted)] hover:text-[var(--text-light)]"
        }`}
        title="Auto: automatically switch based on screen width"
      >
        Auto
      </button>
      <button
        onClick={onToggle}
        className={`p-1 rounded transition-colors ${
          !isAutoMode && viewMode === "side-by-side"
            ? "bg-[var(--accent-color)] text-white"
            : "text-[var(--text-muted)] hover:text-[var(--text-light)]"
        }`}
        title="Side by side"
      >
        <Columns2 size={12} />
      </button>
      <button
        onClick={onToggle}
        className={`p-1 rounded transition-colors ${
          !isAutoMode && viewMode === "inline"
            ? "bg-[var(--accent-color)] text-white"
            : "text-[var(--text-muted)] hover:text-[var(--text-light)]"
        }`}
        title="Inline (one above the other)"
      >
        <ArrowUpDown size={12} />
      </button>
    </div>
  );
};