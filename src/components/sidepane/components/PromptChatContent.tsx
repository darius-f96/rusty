import React, { useState, useRef, useEffect } from "react";
import { Play } from "lucide-react";
import { useWorkspaceStore } from "../../../store";
import { processResponse } from "../../../services/responseProcessingService";
import { CustomSelect } from "../../CustomSelect";

interface PromptChatContentProps {
  selectedNode: any;
  nodeStatus: string;
  onExecuteNode: (nodeId: string, customPrompt?: string) => void;
}

const EMPTY_ARRAY: any[] = [];

const ModelSelector: React.FC<{ nodeId: string; nodeData: any }> = ({ nodeId, nodeData }) => {
  const activeModel = useWorkspaceStore((s) => s.activeModel);
  const providers = useWorkspaceStore((s) => s.customProviders);
  const updateTaskNode = useWorkspaceStore((s) => s.updateTaskNode);
  const modelOptions = providers.flatMap((p) => p.models).map((m) => ({ id: m.id, name: m.name }));
  return (
    <CustomSelect
      value={nodeData.model || activeModel}
      onChange={(val) => updateTaskNode(nodeId, { model: val })}
      options={modelOptions}
      placeholder="Model"
      className="w-28 text-[10px]"
      direction="up"
    />
  );
};

const SkillSelector: React.FC<{ nodeId: string }> = ({ nodeId }) => {
  const skills = useWorkspaceStore((s) => s.skills);
  const updateTaskNode = useWorkspaceStore((s) => s.updateTaskNode);
  return (
    <CustomSelect
      value={""}
      onChange={(val) => updateTaskNode(nodeId, { skillId: val || undefined })}
      options={[{ id: "", name: "—" }, ...skills.map((s) => ({ id: s.id, name: s.name }))]}
      placeholder="Skill"
      className="w-24 text-[10px]"
      direction="up"
    />
  );
};

export const PromptChatContent: React.FC<PromptChatContentProps> = ({
  selectedNode,
  nodeStatus,
  onExecuteNode
}) => {
  const [chatMessage, setChatMessage] = useState("");
  const globalChatHistory = useWorkspaceStore(
    (state) => state.globalChatHistory[selectedNode?.id || ""] || EMPTY_ARRAY
  );

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    if (!selectedNode?.id) return;
    const savedPos = localStorage.getItem(`scroll_pos_${selectedNode.id}`);
    if (savedPos && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = parseInt(savedPos, 10);
    }
  }, [selectedNode?.id]);

  const handleScroll = () => {
    if (!chatScrollRef.current || !selectedNode?.id) return;
    const { scrollTop, scrollHeight, clientHeight } = chatScrollRef.current;
    localStorage.setItem(`scroll_pos_${selectedNode.id}`, String(scrollTop));
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    isAtBottomRef.current = distanceFromBottom < 100;
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-app)]">
      <div
        ref={chatScrollRef}
        onScroll={handleScroll}
        className="flex-1 p-4 space-y-4 overflow-y-auto text-xs"
      >
        <div className="flex flex-col bg-[var(--bg-sidebar)]/60 border border-[var(--border-color)]/80 rounded-xl p-3 w-full space-y-1 text-left">
          <span className="font-mono text-[9px] uppercase font-bold text-violet-400">System Agent</span>
          <span className="leading-relaxed">
            I will check the attached file inputs and execute your modifications. You can type instructions below to refine my work.
          </span>
        </div>

        {globalChatHistory.map((msg: any, idx: number) => {
          if (idx === 0 && msg.role === "user") return null;

          return (
            <div
              key={idx}
              className={`flex flex-col rounded-xl p-3 border space-y-1 w-full ${
                msg.role === "user"
                  ? "bg-[var(--accent-bg)]/20 border-[var(--accent-color)]/30 text-left text-[var(--text-light)]"
                  : "bg-[var(--bg-sidebar)]/60 border border-[var(--border-color)]/80 text-left"
              }`}
            >
              <span className={`font-mono text-[9px] uppercase font-bold ${
                msg.role === "user" ? "text-[var(--accent-color)]" : "text-violet-400"
              }`}>
                {msg.role === "user" ? "User" : "System Agent"} · {msg.timestamp}
              </span>
              <div className="leading-relaxed text-[var(--text-normal)]">
                {msg.role === "user" ? msg.content : processResponse(msg.content)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Model & Skill selectors */}
      {selectedNode?.type === "taskNode" && (
        <div className="flex items-center space-x-2 px-3 py-1.5 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/10">
          <span className="text-[9px] text-[var(--text-muted)] font-sans uppercase font-semibold">M:</span>
          <ModelSelector nodeId={selectedNode.id} nodeData={selectedNode.data} />
          <span className="text-[9px] text-[var(--text-muted)] font-sans uppercase font-semibold">S:</span>
          <SkillSelector nodeId={selectedNode.id} />
        </div>
      )}

      {/* Input prompt area */}
      <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!chatMessage.trim() || nodeStatus === "running") return;
            onExecuteNode(selectedNode.id, chatMessage);
            setChatMessage("");
          }}
          className="flex items-center space-x-2 bg-[var(--bg-app)] border border-[var(--border-color)] p-1.5 rounded-lg focus-within:border-[var(--border-active)]"
        >
          <input
            type="text"
            placeholder="e.g. Refactor this helper into a separate hook..."
            value={chatMessage}
            onChange={(e) => setChatMessage(e.target.value)}
            className="flex-1 bg-transparent border-none outline-none text-xs px-2 py-1 focus:ring-0 text-[var(--text-normal)]"
          />
          <button
            type="submit"
            disabled={nodeStatus === "running"}
            className="bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] text-white text-xs font-mono font-bold px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-all glow-btn cursor-pointer"
          >
            <Play size={12} />
            <span>Prompt</span>
          </button>
        </form>
      </div>
    </div>
  );
};
