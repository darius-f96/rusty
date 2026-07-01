import React from "react";
import { Sparkles } from "lucide-react";
import { CustomSelect } from "../../CustomSelect";
import { useWorkspaceStore } from "../../../store";
import { Chat } from "../../ui/Chat";
import { ChatInput } from "../../ui/ChatInput";

interface ExplorerChatContentProps {
  selectedNode: any;
  nodeStatus: string;
  explorerInput: string;
  setExplorerInput: (val: string) => void;
  isSummarizing: boolean;
  handleExplorerSendMessage: () => void;
  handleExplorerSummarize: () => void;
  handleStopExplorer: () => void;
  streamingMessageId: string | null;
  exploreModel: string;
  summarizeModel: string;
  allAvailableModels: { id: string; name: string }[];
}

const EMPTY_ARRAY: any[] = [];

export const ExplorerChatContent: React.FC<ExplorerChatContentProps> = ({
  selectedNode,
  nodeStatus,
  explorerInput,
  setExplorerInput,
  isSummarizing,
  handleExplorerSendMessage,
  handleExplorerSummarize,
  handleStopExplorer,
  streamingMessageId,
  exploreModel,
  summarizeModel,
  allAvailableModels,
}) => {
  const globalChatHistory = useWorkspaceStore(
    (state) => state.globalChatHistory[selectedNode?.id || ""] || EMPTY_ARRAY
  );
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode);

  const chatMessages = globalChatHistory.map((msg, idx) => ({
    id: msg.id || `global-msg-${idx}`,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp || "",
    attachments: msg.attachments,
  }));

  return (
    <div className="flex flex-col h-full bg-[var(--bg-app)]">
      {/* Chat sub-header with model dropdowns */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 select-none flex-shrink-0">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-[9px] font-mono uppercase text-violet-400 flex-shrink-0">Chat</span>
          <CustomSelect
            value={exploreModel}
            onChange={(val) => updateNode(selectedNode.id, { exploreModel: val })}
            options={allAvailableModels}
            placeholder={allAvailableModels.length === 0 ? (exploreModel || "None") : "Chat model"}
            className="flex-1 min-w-0 nodrag nopan"
            buttonClassName="w-full flex items-center justify-between bg-[var(--bg-app)] text-[var(--text-light)] border border-[var(--border-color)] focus:border-violet-500 rounded px-1.5 py-1 outline-none cursor-pointer text-left transition-all hover:border-violet-500/50 text-[10px] font-mono"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-[9px] font-mono uppercase text-amber-400 flex-shrink-0">Summ</span>
          <CustomSelect
            value={summarizeModel}
            onChange={(val) => updateNode(selectedNode.id, { summarizeModel: val })}
            options={allAvailableModels}
            placeholder={allAvailableModels.length === 0 ? (summarizeModel || "None") : "Summ model"}
            className="flex-1 min-w-0 nodrag nopan"
            buttonClassName="w-full flex items-center justify-between bg-[var(--bg-app)] text-[var(--text-light)] border border-[var(--border-color)] focus:border-amber-500 rounded px-1.5 py-1 outline-none cursor-pointer text-left transition-all hover:border-amber-500/50 text-[10px] font-mono"
          />
        </div>
      </div>

      {/* Reusable Chat History List */}
      <Chat
        messages={chatMessages}
        isStreaming={nodeStatus === "running"}
        streamingMessageId={streamingMessageId}
        compact
      />

      {/* Reusable Chat Input area */}
      <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 flex items-center space-x-2 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <ChatInput
            value={explorerInput}
            onChange={setExplorerInput}
            onSend={() => handleExplorerSendMessage()}
            disabled={nodeStatus === "running"}
            isStreaming={nodeStatus === "running"}
            onStop={handleStopExplorer}
            placeholder="Discuss task, plan changes... (type @ to reference files)"
          />
        </div>
        <button
          onClick={handleExplorerSummarize}
          disabled={nodeStatus === "running" || isSummarizing || globalChatHistory.length === 0}
          className="bg-amber-600/90 hover:bg-amber-500/95 disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] text-white text-xs font-mono font-bold px-3 py-2.5 rounded-xl flex items-center justify-center space-x-1.5 transition-all cursor-pointer h-[38px] shadow-md flex-shrink-0"
          title="Generate global architectural summary"
        >
          <Sparkles size={12} className={isSummarizing ? "animate-spin" : ""} />
          <span>{isSummarizing ? "Summarize" : "Summarize"}</span>
        </button>
      </div>
    </div>
  );
};
