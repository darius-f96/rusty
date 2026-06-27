import React, { useRef, useEffect } from "react";
import { Settings, X, Globe, Send, Sparkles } from "lucide-react";
import { CustomSelect } from "../../CustomSelect";
import { useWorkspaceStore } from "../../../store";
import { processResponse } from "../../../services/responseProcessingService";

interface ExplorerChatContentProps {
  selectedNode: any;
  nodeStatus: string;
  explorerInput: string;
  setExplorerInput: (val: string) => void;
  isSummarizing: boolean;
  showSettings: boolean;
  setShowSettings: (val: boolean) => void;
  handleExplorerSendMessage: () => void;
  handleExplorerSummarize: () => void;
  exploreModel: string;
  summarizeModel: string;
  providers: any[];
  activeCustomProviderId: string | null;
  availableModels: any[];
}

const EMPTY_ARRAY: any[] = [];

export const ExplorerChatContent: React.FC<ExplorerChatContentProps> = ({
  selectedNode,
  nodeStatus,
  explorerInput,
  setExplorerInput,
  isSummarizing,
  showSettings,
  setShowSettings,
  handleExplorerSendMessage,
  handleExplorerSummarize,
  exploreModel,
  summarizeModel,
  providers,
  activeCustomProviderId,
  availableModels
}) => {
  const globalChatHistory = useWorkspaceStore(
    (state) => state.globalChatHistory[selectedNode?.id || ""] || EMPTY_ARRAY
  );
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode);

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
    const { scrollTop } = chatScrollRef.current;
    localStorage.setItem(`scroll_pos_${selectedNode.id}`, String(scrollTop));
    const { scrollHeight, clientHeight } = chatScrollRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    isAtBottomRef.current = distanceFromBottom < 100;
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-app)]">
      {/* Chat sub-header with model status and settings toggle */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 select-none flex-shrink-0">
        <div className="flex items-center space-x-2 text-[10px] font-mono text-[var(--text-muted)]">
          <span>Chat: <strong className="text-violet-400">{(exploreModel || "").split("/").pop() || "None"}</strong></span>
          <span>•</span>
          <span>Summ: <strong className="text-amber-400">{(summarizeModel || "").split("/").pop() || "None"}</strong></span>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="flex items-center space-x-1 text-[11px] font-medium text-violet-400 hover:text-violet-300 transition-colors cursor-pointer"
        >
          <Settings size={12} />
          <span>Configure Models</span>
        </button>
      </div>

      {/* Explorer settings configuration drawer inside chat */}
      {showSettings && (
        <div className="bg-[var(--bg-sidebar)]/80 border-b border-[var(--border-color)] p-3.5 space-y-3 text-xs font-sans select-none animate-fadeIn flex-shrink-0">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[var(--text-light)] flex items-center space-x-1.5">
              <Settings size={12} className="text-violet-400" />
              <span>Explorer Settings</span>
            </span>
            <button onClick={() => setShowSettings(false)} className="text-[var(--text-muted)] hover:text-[var(--text-light)] cursor-pointer">
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3.5 font-mono text-[11px]">
            <div className="flex flex-col space-y-1 col-span-2 border-b border-[var(--border-color)] pb-2 mb-1">
              <span className="text-[var(--text-muted)] font-sans">Active LLM Provider:</span>
              <CustomSelect
                value={activeCustomProviderId || ""}
                onChange={(newProviderId) => {
                  useWorkspaceStore.getState().setActiveCustomProviderId(newProviderId);
                  const prov = providers.find((p) => p.id === newProviderId);
                  if (prov && prov.models && prov.models.length > 0) {
                    useWorkspaceStore.getState().setActiveModel(prov.models[0].id);
                    updateNode(selectedNode.id, { 
                      exploreModel: prov.models[0].id,
                      summarizeModel: prov.models[0].id
                    });
                  }
                }}
                options={providers.map((p: any) => ({ id: p.id, name: p.name }))}
              />
            </div>
            <div className="flex flex-col space-y-1">
              <span className="text-[var(--text-muted)] font-sans">Exploration Model:</span>
              <CustomSelect
                value={exploreModel}
                onChange={(val) => updateNode(selectedNode.id, { exploreModel: val })}
                options={availableModels.length > 0 ? availableModels : [{ id: exploreModel, name: (exploreModel || "").split("/").pop() || exploreModel || "None" }]}
              />
            </div>
            <div className="flex flex-col space-y-1">
              <span className="text-[var(--text-muted)] font-sans">Summarization Model:</span>
              <CustomSelect
                value={summarizeModel}
                onChange={(val) => updateNode(selectedNode.id, { summarizeModel: val })}
                options={availableModels.length > 0 ? availableModels : [{ id: summarizeModel, name: (summarizeModel || "").split("/").pop() || summarizeModel || "None" }]}
              />
            </div>
          </div>
        </div>
      )}

      {/* Explorer Chat History */}
      <div
        ref={chatScrollRef}
        onScroll={handleScroll}
        className="flex-1 p-4 space-y-4 overflow-y-auto text-xs"
      >
        {globalChatHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-[var(--text-muted)] space-y-2 select-none">
            <Globe size={32} className="text-violet-400 mb-2 animate-pulse" />
            <span className="font-semibold text-sm">Global Workspace Explorer</span>
            <span className="max-w-[280px]">
              Ask the explorer agent to analyze patterns, codebase architecture, and conventions.
            </span>
          </div>
        ) : (
          globalChatHistory.map((msg: any, idx: number) => (
            <div
              key={idx}
              className={`flex flex-col rounded-xl p-3 border space-y-1 w-full ${
                msg.role === "user"
                  ? "bg-[var(--accent-bg)]/20 border-[var(--accent-color)]/30 text-left"
                  : "bg-[var(--bg-sidebar)]/60 border border-[var(--border-color)]/80 text-left"
              }`}
            >
              <span className={`font-mono text-[9px] uppercase font-bold ${
                msg.role === "user" ? "text-[var(--accent-color)]" : "text-violet-400"
              }`}>
                {msg.role === "user" ? "You" : "Explorer"} · {msg.timestamp}
              </span>
              <span className="leading-relaxed whitespace-pre-wrap text-[var(--text-normal)]">
                {msg.role === "user" ? msg.content : processResponse(msg.content)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Explorer Input prompt area */}
      <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20">
        <div className="flex items-center space-x-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleExplorerSendMessage();
            }}
            className="flex-1 flex items-center space-x-2 bg-[var(--bg-app)] border border-[var(--border-color)] p-1.5 rounded-lg focus-within:border-[var(--border-active)]"
          >
            <input
              type="text"
              placeholder="Explore codebase..."
              value={explorerInput}
              onChange={(e) => setExplorerInput(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none text-xs px-2 py-1 focus:ring-0 text-[var(--text-normal)]"
              disabled={nodeStatus === "running"}
            />
            <button
              type="submit"
              disabled={nodeStatus === "running" || !explorerInput.trim()}
              className="bg-violet-600 hover:bg-violet-500 disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] text-white text-xs font-mono font-bold px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-all cursor-pointer"
            >
              <Send size={12} />
              <span>Send</span>
            </button>
          </form>
          <button
            onClick={handleExplorerSummarize}
            disabled={nodeStatus === "running" || isSummarizing || globalChatHistory.length === 0}
            className="bg-amber-600/90 hover:bg-amber-500/95 disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] text-white text-xs font-mono font-bold px-3 py-2 rounded-md flex items-center space-x-1 transition-all cursor-pointer"
            title="Generate global architectural summary"
          >
            <Sparkles size={12} className={isSummarizing ? "animate-spin" : ""} />
            <span>{isSummarizing ? "Summarize" : "Summarize"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
