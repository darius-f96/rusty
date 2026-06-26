import React from "react";
import { Code, MessageSquare, Terminal } from "lucide-react";
import { useWorkspaceStore } from "../../../store";

interface SidePaneTabsProps {
  selectedNode: any;
  activeTab: "diff" | "chat" | "console";
  setActiveTab: (tab: "diff" | "chat" | "console") => void;
  nodeStatus: string;
}

export const SidePaneTabs: React.FC<SidePaneTabsProps> = ({
  selectedNode,
  activeTab,
  setActiveTab,
  nodeStatus
}) => {
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const providers = useWorkspaceStore((state) => state.customProviders);
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode);

  return (
    <div className="flex border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/10 text-xs font-mono select-none justify-between items-center pr-3 flex-shrink-0">
      <div className="flex">
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
          <span>{selectedNode.type === "globalChatNode" ? "Explorer Chat" : "Prompt Chat"}</span>
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
      </div>

      {selectedNode.type === "taskNode" && (
        <div className="flex items-center space-x-1.5 py-1">
          <span className="text-[10px] text-[var(--text-muted)] font-sans uppercase font-semibold">Model:</span>
          <select
            value={(selectedNode.data as any).model || activeModel}
            onChange={(e) => updateNode(selectedNode.id, { model: e.target.value })}
            className="bg-[var(--bg-app)] text-[var(--text-normal)] border border-[var(--border-color)] rounded px-1.5 py-0.5 outline-none text-[10px] max-w-[140px] focus:border-[var(--border-active)] cursor-pointer"
          >
            {providers.flatMap((p) => p.models).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
            {providers.flatMap((p) => p.models).length === 0 && (
              <option value="">No models</option>
            )}
          </select>
        </div>
      )}
    </div>
  );
};
