import React from "react";
import { Code, MessageSquare, Terminal, Folder, FileText } from "lucide-react";

interface SidePaneTabsProps {
  selectedNode: any;
  activeTab: "description" | "diff" | "chat" | "console" | "vfs";
  setActiveTab: (tab: "description" | "diff" | "chat" | "console" | "vfs") => void;
  nodeStatus: string;
}

export const SidePaneTabs: React.FC<SidePaneTabsProps> = ({
  selectedNode,
  activeTab,
  setActiveTab,
  nodeStatus
}) => {
  return (
    <div className="flex border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/10 text-xs font-mono select-none justify-between items-center pr-3 flex-shrink-0">
      <div className="flex">
        {selectedNode.type === "taskNode" && (
          <button
            onClick={() => setActiveTab("description")}
            className={`flex items-center space-x-1.5 px-4 py-2.5 border-b-2 transition-all ${
              activeTab === "description"
                ? "border-[var(--accent-color)] text-[var(--text-light)] bg-[var(--accent-bg)] font-semibold"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-light)]"
            }`}
          >
            <FileText size={14} />
            <span>Description</span>
          </button>
        )}
        {selectedNode.type !== "globalChatNode" && (
          <button
            onClick={() => setActiveTab("diff")}
            className={`flex items-center space-x-1.5 px-4 py-2.5 border-b-2 transition-all ${
              activeTab === "diff"
                ? "border-[var(--accent-color)] text-[var(--text-light)] bg-[var(--accent-bg)] font-semibold"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-light)]"
            }`}
          >
            <Code size={14} />
            <span>VFS Diff</span>
          </button>
        )}
        <button
          onClick={() => setActiveTab("chat")}
          className={`flex items-center space-x-1.5 px-4 py-2.5 border-b-2 transition-all ${
            activeTab === "chat"
              ? "border-[var(--accent-color)] text-[var(--text-light)] bg-[var(--accent-bg)] font-semibold"
              : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-light)]"
          }`}
        >
          <MessageSquare size={14} />
          <span>{selectedNode.type === "globalChatNode" ? "Explorer Chat" : "Chat"}</span>
        </button>
        {selectedNode.type !== "contextNode" && (
          <button
            onClick={() => setActiveTab("console")}
            className={`flex items-center space-x-1.5 px-4 py-2.5 border-b-2 transition-all relative ${
              activeTab === "console"
                ? "border-[var(--accent-color)] text-[var(--text-light)] bg-[var(--accent-bg)] font-semibold"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-light)]"
            }`}
          >
            <Terminal size={14} />
            <span>Console Stream</span>
            {nodeStatus === "running" && (
              <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] animate-ping" />
            )}
          </button>
        )}
        {(selectedNode.type === "taskNode" || selectedNode.type === "globalChatNode") && (
          <button
            onClick={() => setActiveTab("vfs")}
            className={`flex items-center space-x-1.5 px-4 py-2.5 border-b-2 transition-all ${
              activeTab === "vfs"
                ? "border-[var(--accent-color)] text-[var(--text-light)] bg-[var(--accent-bg)] font-semibold"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-light)]"
            }`}
          >
            <Folder size={14} />
            <span>VFS</span>
          </button>
        )}
      </div>
    </div>
  );
};
