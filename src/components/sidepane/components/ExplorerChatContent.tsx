import React from "react";
import { X, Check, AlertTriangle, GitBranch, Sparkles } from "lucide-react";
import { CustomSelect } from "../../CustomSelect";
import { useWorkspaceStore } from "../../../store";
import { Chat } from "../../ui/Chat";
import { AgentQuestion, ChatInput } from "../../ui/ChatInput";
import type { SubagentActivity } from "../../ui/Chat";
import type { GeneratedTaskDraft, TaskGenerationFailure } from "../useExplorerWebSocket";
import type { GeneratedTaskNodeSpec } from "../../../store";

interface ExplorerChatContentProps {
  selectedNode: any;
  nodeStatus: string;
  explorerInput: string;
  setExplorerInput: (val: string) => void;
  handleExplorerSendMessage: () => void;
  generatedTaskDraft: GeneratedTaskDraft[];
  setGeneratedTaskDraft: React.Dispatch<React.SetStateAction<GeneratedTaskDraft[]>>;
  isTaskGenerationPromptOpen: boolean;
  setIsTaskGenerationPromptOpen: (open: boolean) => void;
  taskGenerationInstructions: string;
  setTaskGenerationInstructions: (instructions: string) => void;
  taskGenerationFailure: TaskGenerationFailure | null;
  taskGenerationModel: string;
  isGeneratingTasks: boolean;
  handleGenerateTaskDraft: () => void;
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
  isTaskGenerationPromptOpen,
  setIsTaskGenerationPromptOpen,
  taskGenerationInstructions,
  setTaskGenerationInstructions,
  taskGenerationFailure,
  taskGenerationModel,
  isGeneratingTasks,
  handleGenerateTaskDraft,
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
  const taskTitlesByKey = new Map(generatedTaskDraft.map((task) => [task.key, task.title]));

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
          <span className="text-[9px] font-mono uppercase text-[var(--color-status-danger)] flex-shrink-0">Chat</span>
          <CustomSelect
            value={exploreModel}
            onChange={(val) => updateNode(selectedNode.id, { exploreModel: val })}
            options={allAvailableModels}
            placeholder={allAvailableModels.length === 0 ? (exploreModel || "None") : "Chat model"}
            className="flex-1 min-w-0 nodrag nopan"
            buttonClassName="w-full flex items-center justify-between bg-[var(--bg-app)] text-[var(--text-light)] border border-[var(--border-color)] focus:border-[var(--color-status-danger-border)] rounded px-1.5 py-1 outline-none cursor-pointer text-left transition-all hover:border-[var(--color-status-danger-border)] text-[10px] font-mono"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-[9px] font-mono uppercase text-[var(--color-status-warning)] flex-shrink-0">Summ</span>
          <CustomSelect
            value={summarizeModel}
            onChange={(val) => updateNode(selectedNode.id, { summarizeModel: val })}
            options={allAvailableModels}
            placeholder={allAvailableModels.length === 0 ? (summarizeModel || "None") : "Summ model"}
            className="flex-1 min-w-0 nodrag nopan"
            buttonClassName="w-full flex items-center justify-between bg-[var(--bg-app)] text-[var(--text-light)] border border-[var(--border-color)] focus:border-[var(--color-status-warning-border)] rounded px-1.5 py-1 outline-none cursor-pointer text-left transition-all hover:border-[var(--color-status-warning-border)] text-[10px] font-mono"
          />
        </div>
      </div>

      {/* Reusable Chat History List */}
      <Chat
        messages={chatMessages}
        isStreaming={nodeStatus === "running" || isGeneratingTasks}
        streamingMessageId={nodeStatus === "running" ? streamingMessageId : null}
        streamingLabel={isGeneratingTasks ? "Agent is generating tasks…" : "Model is thinking…"}
        compact
        scrollKey={selectedNode?.id}
        followLatest
        subagents={subagents}
      />

      {isTaskGenerationPromptOpen && (
        <div className="border-t border-[var(--color-status-info-border)] bg-[var(--color-status-info-bg)]/40 p-3 flex-shrink-0">
          <div className="flex items-start gap-2">
            {taskGenerationFailure?.code === "INVALID_TASK_JSON"
              ? <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-[var(--color-status-warning)]" />
              : <GitBranch size={15} className="mt-0.5 flex-shrink-0 text-[var(--color-status-info)]" />}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-mono uppercase font-bold text-[var(--text-light)]">
                  {taskGenerationFailure?.code === "INVALID_TASK_JSON" ? "Choose another model and retry" : "Generate task draft"}
                </span>
                <button
                  onClick={() => setIsTaskGenerationPromptOpen(false)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-light)]"
                  title="Cancel task generation"
                >
                  <X size={13} />
                </button>
              </div>
              {taskGenerationFailure?.code === "INVALID_TASK_JSON" && (
                <p className="mt-1 text-[10px] font-mono leading-relaxed text-[var(--color-status-warning)]">
                  The model returned invalid JSON twice. It may be too small to complete this task reliably. Switch to a more capable model before retrying.
                </p>
              )}
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[9px] font-mono uppercase text-[var(--text-muted)] flex-shrink-0">Model</span>
                <CustomSelect
                  value={taskGenerationModel}
                  onChange={(val) => updateNode(selectedNode.id, { taskGenerationModel: val })}
                  options={allAvailableModels}
                  placeholder="Task model"
                  className="flex-1 min-w-0 nodrag nopan"
                  buttonClassName="w-full flex items-center justify-between bg-[var(--bg-app)] text-[var(--text-light)] border border-[var(--border-color)] focus:border-[var(--color-status-info-border)] rounded px-2 py-1.5 outline-none cursor-pointer text-left transition-all hover:border-[var(--color-status-info-border)] text-[10px] font-mono"
                />
              </div>
              <label className="block mt-2 text-[9px] font-mono uppercase text-[var(--text-muted)]" htmlFor="task-generation-instructions">
                Additional details <span className="normal-case">(optional)</span>
              </label>
              <textarea
                id="task-generation-instructions"
                autoFocus
                value={taskGenerationInstructions}
                onChange={(event) => setTaskGenerationInstructions(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    handleGenerateTaskDraft();
                  }
                }}
                rows={3}
                maxLength={8000}
                placeholder="For example: map which tasks influence other tasks, keep API work before UI integration, and split tests into a separate task."
                className="mt-1 w-full resize-y rounded border border-[var(--border-color)] bg-[var(--bg-app)] px-2.5 py-2 text-xs text-[var(--text-normal)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--color-status-info-border)]"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[9px] font-mono text-[var(--text-muted)]">⌘/Ctrl + Enter to generate</span>
                <button
                  onClick={handleGenerateTaskDraft}
                  className="rounded bg-[var(--color-status-info-solid)] px-3 py-1.5 text-[10px] font-mono font-bold text-[var(--color-status-info-solid-foreground)] hover:opacity-90 flex items-center gap-1.5"
                >
                  <Sparkles size={12} />
                  {taskGenerationFailure?.code === "INVALID_TASK_JSON" ? "Retry" : "Generate"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {generatedTaskDraft.length > 0 && (
        <div className="border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/40 p-3 max-h-[45%] overflow-y-auto flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono uppercase font-bold text-[var(--color-status-warning)]">Review generated tasks</span>
            <button onClick={() => setGeneratedTaskDraft([])} className="text-[var(--text-muted)] hover:text-[var(--text-light)]"><X size={13} /></button>
          </div>
          <div className="space-y-2">
            {generatedTaskDraft.map((task, index) => (
              <div key={index} className="rounded border border-[var(--border-color)] bg-[var(--bg-app)] p-2 flex gap-2">
                <input type="checkbox" checked={task.selected} onChange={(event) => setGeneratedTaskDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, selected: event.target.checked } : item))} className="mt-1" />
                <div className="flex-1 space-y-1">
                  <input value={task.title} onChange={(event) => setGeneratedTaskDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} className="w-full bg-transparent text-xs font-semibold text-[var(--text-light)] border-b border-[var(--border-color)] focus:outline-none focus:border-[var(--color-status-warning-border)]" />
                  <textarea value={task.description} onChange={(event) => setGeneratedTaskDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} rows={3} className="w-full resize-y bg-transparent text-[10px] font-mono text-[var(--text-normal)] focus:outline-none" />
                  {task.dependsOn.length > 0 && (
                    <div className="flex items-start gap-1 text-[9px] font-mono text-[var(--color-status-info)]">
                      <GitBranch size={10} className="mt-0.5 flex-shrink-0" />
                      <span>Depends on {task.dependsOn.map((key) => taskTitlesByKey.get(key) || key).join(", ")}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={async () => {
              const selectedTasks = generatedTaskDraft.filter((task) => task.selected && task.title.trim() && task.description.trim());
              const selectedKeys = new Set(selectedTasks.map((task) => task.key));
              const tasks = selectedTasks.map(({ key, title, description, dependsOn }) => ({
                key,
                title: title.trim(),
                description: description.trim(),
                dependsOn: dependsOn.filter((dependency) => selectedKeys.has(dependency)),
              }));
              await onCreateTaskNodes(tasks);
              if (tasks.length) setGeneratedTaskDraft([]);
            }}
            disabled={!generatedTaskDraft.some((task) => task.selected && task.title.trim() && task.description.trim())}
            className="mt-2 w-full bg-[var(--color-status-success-bg)] hover:bg-[var(--color-status-success-solid)] disabled:opacity-40 text-[var(--color-status-success)] hover:text-[var(--color-status-success-solid-foreground)] rounded px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5"
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
