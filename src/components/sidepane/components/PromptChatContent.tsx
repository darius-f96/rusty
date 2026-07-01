import React, { useState } from "react";
import { useWorkspaceStore } from "../../../store";
import { CustomSelect } from "../../CustomSelect";
import { Chat } from "../../ui/Chat";
import { ChatInput } from "../../ui/ChatInput";

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

  const chatMessages = [
    {
      id: "system-agent-init",
      role: "assistant" as const,
      content: "I will check the attached file inputs and execute your modifications. You can type instructions below to refine my work.",
      timestamp: "",
    },
    ...globalChatHistory
      .filter((msg: any, idx: number) => !(idx === 0 && msg.role === "user"))
      .map((msg: any, idx: number) => ({
        id: `task-msg-${idx}`,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp || "",
      })),
  ];

  const handleSend = () => {
    if (!chatMessage.trim() || nodeStatus === "running") return;
    onExecuteNode(selectedNode.id, chatMessage);
    setChatMessage("");
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-app)]">
      {/* Reusable Chat History List */}
      <Chat
        messages={chatMessages}
        isStreaming={nodeStatus === "running"}
      />

      {/* Model & Skill selectors */}
      {selectedNode?.type === "taskNode" && (
        <div className="flex items-center space-x-2 px-3 py-1.5 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/10 flex-shrink-0">
          <span className="text-[9px] text-[var(--text-muted)] font-sans uppercase font-semibold">M:</span>
          <ModelSelector nodeId={selectedNode.id} nodeData={selectedNode.data} />
          <span className="text-[9px] text-[var(--text-muted)] font-sans uppercase font-semibold">S:</span>
          <SkillSelector nodeId={selectedNode.id} />
        </div>
      )}

      {/* Reusable Chat Input area */}
      <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 flex-shrink-0">
        <ChatInput
          value={chatMessage}
          onChange={setChatMessage}
          onSend={handleSend}
          disabled={nodeStatus === "running"}
          placeholder="Refine work, prompt modifications... (type @ to reference files)"
        />
      </div>
    </div>
  );
};
