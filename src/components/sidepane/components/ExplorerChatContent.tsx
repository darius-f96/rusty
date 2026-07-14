import React from "react";
import { X, Check } from "lucide-react";
import { CustomSelect } from "../../CustomSelect";
import { useWorkspaceStore } from "../../../store";
import { Chat } from "../../ui/Chat";
import { AgentQuestion, ChatInput } from "../../ui/ChatInput";
import type { SubagentActivity } from "../../ui/Chat";
import type { GeneratedTaskDraft } from "../useExplorerWebSocket";
import type { GeneratedTaskNodeSpec } from "../../../store";

interface ExplorerChatContentProps {
  selectedNode: any;
  nodeStatus: string;
  explorerInput: string;
  setExplorerInput: (val: string) => void;
  handleExplorerSendMessage: () => void;
  generatedTaskDraft: GeneratedTaskDraft[];
  setGeneratedTaskDraft: React.Dispatch<React.SetStateAction<GeneratedTaskDraft[]>>;
  onCreateTaskNodes: (tasks: GeneratedTaskNodeSpec[]) => void | Promise<void>;
  handleStopExplorer: () => void;
  streamingMessageId: string | null;
  exploreModel: string;
  summarizeModel: string;
  allAvailableModels: { id: string; name: string }[];
  subagents: SubagentActivity[];
  agentQuestion: AgentQuestion | null;
  handleAgentQuestionAnswer: (answer: string) => void;
}

const EMPTY_ARRAY: any[] = [];

export const ExplorerChatContent: React.FC<ExplorerChatContentProps> = ({
  selectedNode,
  nodeStatus,
  explorerInput,
  setExplorerInput,
  handleExplorerSendMessage,
  generatedTaskDraft,
  setGeneratedTaskDraft,
  onCreateTaskNodes,
  handleStopExplorer,
  streamingMessageId,
  exploreModel,
  summarizeModel,
  allAvailableModels,
  subagents,
  agentQuestion,
  handleAgentQuestionAnswer,
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
          <span className="text-[9px] font-mono uppercase text-red-400 flex-shrink-0">Chat</span>
          <CustomSelect
            value={exploreModel}
            onChange={(val) => updateNode(selectedNode.id, { exploreModel: val })}
            options={allAvailableModels}
            placeholder={allAvailableModels.length === 0 ? (exploreModel || "None") : "Chat model"}
            className="flex-1 min-w-0 nodrag nopan"
            buttonClassName="w-full flex items-center justify-between bg-[var(--bg-app)] text-[var(--text-light)] border border-[var(--border-color)] focus:border-red-700 rounded px-1.5 py-1 outline-none cursor-pointer text-left transition-all hover:border-red-700/50 text-[10px] font-mono"
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
        scrollKey={selectedNode?.id}
        followLatest
        subagents={subagents}
      />

      {generatedTaskDraft.length > 0 && (
        <div className="border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/40 p-3 max-h-[45%] overflow-y-auto flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono uppercase font-bold text-amber-400">Review generated tasks</span>
            <button onClick={() => setGeneratedTaskDraft([])} className="text-[var(--text-muted)] hover:text-[var(--text-light)]"><X size={13} /></button>
          </div>
          <div className="space-y-2">
            {generatedTaskDraft.map((task, index) => (
              <div key={index} className="rounded border border-[var(--border-color)] bg-[var(--bg-app)] p-2 flex gap-2">
                <input type="checkbox" checked={task.selected} onChange={(event) => setGeneratedTaskDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, selected: event.target.checked } : item))} className="mt-1" />
                <div className="flex-1 space-y-1">
                  <input value={task.title} onChange={(event) => setGeneratedTaskDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} className="w-full bg-transparent text-xs font-semibold text-[var(--text-light)] border-b border-[var(--border-color)] focus:outline-none focus:border-amber-500" />
                  <textarea value={task.description} onChange={(event) => setGeneratedTaskDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} rows={3} className="w-full resize-y bg-transparent text-[10px] font-mono text-[var(--text-normal)] focus:outline-none" />
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={async () => {
              const tasks = generatedTaskDraft.filter((task) => task.selected && task.title.trim() && task.description.trim()).map(({ title, description }) => ({ title: title.trim(), description: description.trim() }));
              await onCreateTaskNodes(tasks);
              if (tasks.length) setGeneratedTaskDraft([]);
            }}
            disabled={!generatedTaskDraft.some((task) => task.selected && task.title.trim() && task.description.trim())}
            className="mt-2 w-full bg-emerald-600/90 hover:bg-emerald-500 disabled:opacity-40 text-white rounded px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5"
          ><Check size={13} /> Add selected tasks</button>
        </div>
      )}

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
            agentQuestion={agentQuestion}
            onAgentQuestionAnswer={handleAgentQuestionAnswer}
            placeholder="Discuss task, plan changes... (type @ to reference files)"
          />
        </div>
      </div>
    </div>
  );
};
