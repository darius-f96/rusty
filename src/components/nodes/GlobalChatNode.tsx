import React, { useState, useRef, useEffect, memo, useContext } from "react";
import { Pencil, Check, Trash2, Sparkles, X, Loader2, Plug, ChevronDown, Lightbulb, Settings, BookOpen } from "lucide-react";
import { useWorkspaceStore } from "../../store";
import { processResponse } from "../../services/responseProcessingService";
import { CanvasTabContext } from "../tabs/canvas/CanvasTabContext";

export const GlobalChatNode: React.FC<{ id: string; data: any }> = memo(({ id, data }) => {
  const { tabId } = useContext(CanvasTabContext);
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode);
  const deleteNode = useWorkspaceStore((state) => state.deleteNode);
  const mcpServers = useWorkspaceStore((state) => state.mcpServers);
  const skills = useWorkspaceStore((state) => state.skills);
  const nodeStatus = useWorkspaceStore((state) => (state.canvasContexts[tabId] || { nodeStatus: {} }).nodeStatus[id] || "idle");
  const setSelectedNodeId = useWorkspaceStore((state) => state.setSelectedNodeId);

  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(data.name || "Task Auditor");
  const [mcpMenuOpen, setMcpMenuOpen] = useState(false);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Resize state
  const [width, setWidth] = useState(data.width || 384);
  const [height, setHeight] = useState(data.height || 220);
  const isResizing = useRef(false);
  const startDimensions = useRef({ width: 0, height: 0, x: 0, y: 0 });

  const handleNameSave = () => {
    updateNode(id, { name: tempName });
    setIsEditing(false);
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing.current = true;
    startDimensions.current = {
      width,
      height,
      x: e.clientX,
      y: e.clientY
    };
    document.addEventListener("mousemove", handleResize);
    document.addEventListener("mouseup", stopResize);
  };

  const handleResize = (e: MouseEvent) => {
    if (!isResizing.current) return;
    const deltaX = e.clientX - startDimensions.current.x;
    const deltaY = e.clientY - startDimensions.current.y;
    const newWidth = Math.max(300, startDimensions.current.width + deltaX);
    const newHeight = Math.max(150, startDimensions.current.height + deltaY);
    setWidth(newWidth);
    setHeight(newHeight);
    updateNode(id, { width: newWidth, height: newHeight });
  };

  const stopResize = () => {
    isResizing.current = false;
    document.removeEventListener("mousemove", handleResize);
    document.removeEventListener("mouseup", stopResize);
  };

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", handleResize);
      document.removeEventListener("mouseup", stopResize);
    };
  }, []);

  const statusBorder = {
    idle: "border-[var(--border-color)] hover:border-violet-500/50",
    running: "border-violet-500/70 shadow-[0_0_15px_rgba(139,92,246,0.2)] animate-pulse",
    success: "border-emerald-500/60 shadow-[0_0_10px_rgba(16,185,129,0.15)]",
    error: "border-rose-500/60 shadow-[0_0_10px_rgba(244,63,94,0.15)]"
  };

  const summaryText = data.summary;

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.stopPropagation();
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  return (
    <div 
      style={{ width: `${width}px`, height: `${height}px` }}
      className={`rounded-xl border bg-[var(--bg-sidebar)] text-[var(--text-normal)] overflow-hidden flex flex-col transition-[border-color,box-shadow] duration-300 shadow-xl relative ${statusBorder[nodeStatus]}`}
    >
      {/* Node Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-color)] bg-gradient-to-r from-amber-600/15 to-transparent px-3 py-2 select-none cursor-move flex-shrink-0">
        <div className="flex items-center space-x-2 flex-1 mr-2 min-w-0">
          <Lightbulb size={14} className={`text-amber-400 flex-shrink-0 ${nodeStatus === "running" ? "animate-spin" : ""}`} />
          {isEditing ? (
            <input
              type="text"
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNameSave();
                if (e.key === "Escape") setIsEditing(false);
              }}
              className="nodrag bg-[var(--bg-app)] border border-[var(--border-color)] rounded px-1.5 py-0.5 font-sans text-xs text-[var(--text-light)] focus:outline-none focus:border-amber-400 w-full"
              autoFocus
            />
          ) : (
            <span className="font-sans text-xs font-semibold text-[var(--text-light)] truncate">{data.name || "Task Auditor"}</span>
          )}
        </div>

        <div className="flex items-center space-x-1.5 flex-shrink-0">
          {isEditing ? (
            <button
              onClick={handleNameSave}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag text-emerald-400 hover:text-emerald-300 p-0.5 rounded transition-colors cursor-pointer"
            >
              <Check size={13} />
            </button>
          ) : (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="nodrag text-[var(--text-muted)] hover:text-[var(--text-light)] p-0.5 rounded transition-colors cursor-pointer"
                title="Rename node"
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); deleteNode(id); }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="nodrag text-[var(--text-muted)] hover:text-rose-400 p-0.5 rounded transition-colors cursor-pointer"
                title="Delete node"
              >
                <Trash2 size={12} />
              </button>
            </>
          )}

          {/* Status indicator */}
          <div className="flex-shrink-0 pl-1">
            {nodeStatus === "running" && <Loader2 size={14} className="text-violet-400 animate-spin" />}
            {nodeStatus === "success" && <Sparkles size={14} className="text-emerald-400" />}
            {nodeStatus === "error" && <X size={14} className="text-rose-400" />}
          </div>
        </div>
      </div>

      {/* Node Content - scrollable */}
      <div 
        ref={contentRef}
        className="p-3 flex-1 flex flex-col min-h-0 overflow-y-auto scrollbar-wider"
      >
        {/* Skill selector — determines system prompt, enabled tools, and MCP servers */}
        <div className="flex-shrink-0 mb-1.5">
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setSkillMenuOpen(!skillMenuOpen); setMcpMenuOpen(false); }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag w-full bg-[var(--bg-app)]/60 border border-[var(--border-color)] rounded-lg px-2 py-1.5 text-[10px] font-sans text-left flex items-center justify-between hover:border-amber-500/50 transition-colors"
              title="Select a skill to use its system prompt, tools, and MCP servers"
            >
              <span className="flex items-center space-x-1.5 min-w-0">
                <BookOpen size={11} className="text-amber-400 flex-shrink-0" />
                <span className={data.skillId ? "text-[var(--text-light)] truncate" : "text-[var(--text-muted)] truncate"}>
                  {data.skillId
                    ? (skills.find((s: any) => s.id === data.skillId)?.name || data.skillId)
                    : "Skill: default auditor"}
                </span>
              </span>
              <ChevronDown size={11} className="text-[var(--text-muted)] flex-shrink-0 ml-2" />
            </button>
            {skillMenuOpen && (
              <div
                className="absolute z-30 left-0 right-0 mt-1 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-xl py-1 max-h-44 overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); updateNode(id, { skillId: "" }); setSkillMenuOpen(false); }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="w-full text-left px-2.5 py-1.5 hover:bg-[var(--accent-bg)] text-[10px] font-sans text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors"
                >
                  Default auditor
                </button>
                {skills.filter((s: any) => s.id !== "skill_task_auditor").map((s: any) => (
                  <button
                    key={s.id}
                    onClick={(e) => { e.stopPropagation(); updateNode(id, { skillId: s.id }); setSkillMenuOpen(false); }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-[var(--accent-bg)] text-[10px] font-sans text-[var(--text-normal)] hover:text-[var(--text-light)] transition-colors flex items-center justify-between"
                  >
                    <span className="truncate">{s.name}</span>
                    {Array.isArray(s.mcpServers) && s.mcpServers.length > 0 && (
                      <span className="text-[8px] font-mono ml-2 text-sky-400 flex-shrink-0">
                        <Plug size={8} className="inline mr-0.5" />{s.mcpServers.length} MCP
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* MCP server selector — override or add a single MCP server directly on the node */}
        <div className="flex-shrink-0 mb-2">
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setMcpMenuOpen(!mcpMenuOpen); setSkillMenuOpen(false); }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag w-full bg-[var(--bg-app)]/60 border border-[var(--border-color)] rounded-lg px-2 py-1.5 text-[10px] font-sans text-left flex items-center justify-between hover:border-amber-500/50 transition-colors"
              title="Route requests through an MCP server (Jira, Confluence, etc)"
            >
              <span className="flex items-center space-x-1.5 min-w-0">
                <Plug size={11} className="text-sky-400 flex-shrink-0" />
                <span className={data.mcpServerName ? "text-[var(--text-light)] truncate" : "text-[var(--text-muted)] truncate"}>
                  {data.mcpServerName ? (mcpServers[data.mcpServerName]?.displayName || data.mcpServerName) : "MCP override: none"}
                </span>
              </span>
              <ChevronDown size={11} className="text-[var(--text-muted)] flex-shrink-0 ml-2" />
            </button>
            {mcpMenuOpen && (
              <div
                className="absolute z-30 left-0 right-0 mt-1 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-xl py-1 max-h-44 overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); updateNode(id, { mcpServerName: "" }); setMcpMenuOpen(false); }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="w-full text-left px-2.5 py-1.5 hover:bg-[var(--accent-bg)] text-[10px] font-sans text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors"
                >
                  MCP override: none
                </button>
                {Object.keys(mcpServers).map((name) => {
                  const srv = mcpServers[name];
                  return (
                    <button
                      key={name}
                      onClick={(e) => { e.stopPropagation(); updateNode(id, { mcpServerName: name }); setMcpMenuOpen(false); }}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="w-full text-left px-2.5 py-1.5 hover:bg-[var(--accent-bg)] text-[10px] font-sans text-[var(--text-normal)] hover:text-[var(--text-light)] transition-colors flex items-center justify-between"
                    >
                      <span className="truncate">{srv.displayName || srv.name}</span>
                      <span className="text-[8px] font-mono ml-2 text-[var(--text-muted)]">{srv.transport.type}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {summaryText ? (
          <div className="flex flex-col flex-1 min-h-0 space-y-1.5">
            <div className="text-[9px] uppercase font-bold text-amber-400 font-sans tracking-wide flex-shrink-0">
              Background Context
            </div>
            <div
              className="nodrag text-xs font-sans font-medium text-[var(--text-light)] leading-relaxed flex-1 min-h-0 whitespace-pre-wrap bg-[var(--bg-app)]/50 rounded-lg p-2.5 border border-[var(--border-color)] w-full antialiased subpixel-antialiased select-text overflow-y-auto scrollbar-wider"
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {processResponse(summaryText)}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-xs font-sans text-[var(--text-muted)] p-4 select-none">
            <Lightbulb size={24} className="mx-auto text-amber-500/40 mb-2" />
            <span>Select this node to discuss tasks and build context for TaskNodes.</span>
          </div>
        )}
      </div>

      {/* Node Footer */}
      <div className="bg-black/10 px-3 py-1.5 border-t border-[var(--border-color)] flex items-center justify-between text-[10px] select-none flex-shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setSelectedNodeId(id);
            // Programmatically select this node in the Zustand store context
            const store = useWorkspaceStore.getState();
            const canvasContext = store.canvasContexts[tabId];
            if (canvasContext) {
              const updatedNodes = canvasContext.nodes.map((n) => ({
                ...n,
                selected: n.id === id,
              }));
              store.updateCanvasContext(tabId, { nodes: updatedNodes });
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="nodrag text-[var(--text-muted)] hover:text-amber-400 hover:scale-110 active:scale-95 transition-all p-0.5 rounded cursor-pointer flex items-center space-x-1 group"
          title="Open Explorer Pane"
        >
          <Settings size={13} className="group-hover:rotate-45 transition-transform duration-300 pointer-events-none" />
          <span className="font-sans text-[9px] font-semibold pointer-events-none">Open Pane</span>
        </button>
        <span className="text-[9px] font-sans text-[var(--text-muted)] pr-2">
          Global Auditor
        </span>
      </div>

      {/* Resize Handle */}
      <div
        onMouseDown={startResize}
        onPointerDown={(e) => e.stopPropagation()}
        className="nodrag absolute right-0 bottom-0 w-4 h-4 cursor-se-resize flex items-end justify-end p-0.5 z-50 select-none group"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className="text-[var(--text-muted)] opacity-40 group-hover:opacity-100 transition-opacity"
        >
          <line x1="2" y1="10" x2="10" y2="2" stroke="currentColor" strokeWidth="1.5" />
          <line x1="5" y1="10" x2="10" y2="5" stroke="currentColor" strokeWidth="1.5" />
          <line x1="8" y1="10" x2="10" y2="8" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>
    </div>
  );
});
