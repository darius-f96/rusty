import React, { useState, memo, useContext } from "react";
import { Handle, Position } from "@xyflow/react";
import { Plug, Pencil, Check, Trash2, ChevronDown } from "lucide-react";
import { useWorkspaceStore } from "../../store";
import { CanvasTabContext } from "../tabs/canvas/CanvasTabContext";

export const McpNode: React.FC<{ id: string; data: any }> = memo(({ id, data }) => {
  const { tabId } = useContext(CanvasTabContext);
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode);
  const deleteNode = useWorkspaceStore((state) => state.deleteNode);
  const mcpServers = useWorkspaceStore((state) => state.mcpServers);
  const edges = useWorkspaceStore((state) => (state.canvasContexts[tabId] || { edges: [] }).edges);

  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(data.name || "MCP Context");
  const [menuOpen, setMenuOpen] = useState(false);

  const activeEdges = edges.filter((e) => e.source === id);
  const isTopConnected = activeEdges.some((e) => e.sourceHandle === "context-out-top");
  const isBottomConnected = activeEdges.some((e) => e.sourceHandle === "context-out-bottom");

  const serverNames = Object.keys(mcpServers);
  const selectedServer = data.mcpServerName ? mcpServers[data.mcpServerName] : null;

  const handleNameSave = () => {
    updateNode(id, { name: tempName });
    setIsEditing(false);
  };

  const handleSelectServer = (name: string) => {
    updateNode(id, { mcpServerName: name });
    setMenuOpen(false);
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateNode(id, { description: e.target.value });
  };

  return (
    <div className="w-72 rounded-xl border border-[var(--border-color)] bg-[var(--bg-sidebar)] text-[var(--text-normal)] overflow-hidden transition-all duration-300 hover:border-[var(--border-active)] shadow-lg">
      {/* Node Header (Draggable surface) */}
      <div className="flex items-center justify-between border-b border-[var(--border-color)] bg-gradient-to-r from-sky-600/15 to-transparent px-3 py-2 select-none cursor-move">
        <div className="flex items-center space-x-2 flex-1 mr-2 min-w-0">
          <Plug size={14} className="text-sky-400 flex-shrink-0" />
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
              className="nodrag bg-[var(--bg-app)] border border-[var(--border-color)] rounded px-1.5 py-0.5 font-sans text-xs text-[var(--text-light)] focus:outline-none focus:border-sky-400 w-full"
              autoFocus
            />
          ) : (
            <span className="font-sans text-xs font-semibold text-[var(--text-light)] truncate">
              {data.name || "MCP Context"}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-1.5 flex-shrink-0">
          {isEditing ? (
            <button
              onClick={handleNameSave}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag text-emerald-400 hover:text-emerald-300 p-0.5 rounded transition-colors"
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
        </div>
      </div>

      {/* Node Content */}
      <div className="p-3 space-y-3">
        {/* MCP Server Selector */}
        <div>
          <label className="block text-[9px] uppercase font-semibold text-[var(--text-muted)] font-sans mb-1">
            MCP Server
          </label>
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg px-2.5 py-2 text-xs font-sans text-left flex items-center justify-between hover:border-[var(--border-active)] transition-colors"
            >
              <span className={selectedServer ? "text-[var(--text-light)] truncate" : "text-[var(--text-muted)]"}>
                {selectedServer ? (selectedServer.displayName || selectedServer.name) : "Select MCP server..."}
              </span>
              <ChevronDown size={13} className="text-[var(--text-muted)] flex-shrink-0 ml-2" />
            </button>
            {menuOpen && (
              <div
                className="absolute z-30 left-0 right-0 mt-1 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-xl py-1 max-h-48 overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                {serverNames.length === 0 ? (
                  <div className="px-3 py-2 text-[10px] font-mono text-[var(--text-muted)]">
                    No servers configured. Add one in MCP Integration.
                  </div>
                ) : (
                  serverNames.map((name) => {
                    const srv = mcpServers[name];
                    return (
                      <button
                        key={name}
                        onClick={(e) => { e.stopPropagation(); handleSelectServer(name); }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="w-full text-left px-3 py-1.5 hover:bg-[var(--accent-bg)] text-xs font-sans text-[var(--text-normal)] hover:text-[var(--text-light)] transition-colors flex items-center justify-between"
                      >
                        <span className="truncate">{srv.displayName || srv.name}</span>
                        <span className={`text-[9px] font-mono ml-2 ${srv.enabled ? "text-emerald-400" : "text-[var(--text-muted)]"}`}>
                          {srv.transport.type}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
          {selectedServer && (
            <div className="mt-1 text-[9px] font-mono text-[var(--text-muted)] truncate">
              {selectedServer.transport.url || selectedServer.transport.command}
              {!selectedServer.enabled && " · disabled"}
            </div>
          )}
        </div>

        {/* Description / fetch intent */}
        <div>
          <label className="block text-[9px] uppercase font-semibold text-[var(--text-muted)] font-sans mb-1">
            Fetch Description
          </label>
          <textarea
            value={data.description || ""}
            onChange={handleDescriptionChange}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            placeholder="What should the LLM fetch from this MCP server?"
            className="nodrag w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs font-sans leading-relaxed text-[var(--text-light)] placeholder-[var(--text-muted)] focus:outline-none focus:border-sky-400 resize-none"
            style={{ minHeight: "45px", height: "auto" }}
            rows={2}
          />
        </div>
      </div>

      {/* Handles — same as ContextNode so it wires into task nodes */}
      {!isBottomConnected && (
        <Handle
          type="source"
          position={Position.Top}
          id="context-out-top"
          style={{ background: "#0ea5e9", width: 14, height: 14, border: "2.5px solid var(--bg-sidebar)" }}
        />
      )}
      {!isTopConnected && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="context-out-bottom"
          style={{ background: "#0ea5e9", width: 14, height: 14, border: "2.5px solid var(--bg-sidebar)" }}
        />
      )}
    </div>
  );
});
