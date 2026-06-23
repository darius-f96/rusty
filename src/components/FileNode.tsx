import React from "react";
import { Handle, Position } from "@xyflow/react";
import { Link } from "lucide-react";
import { FileIcon } from "../services/fileTypeService";

export const FileNode: React.FC<{ data: { path: string; name: string } }> = ({ data }) => {
  return (
    <div className="w-64 rounded-xl border border-zinc-700/60 bg-zinc-900/90 text-gray-200 shadow-2xl backdrop-blur-md overflow-hidden transition-all duration-300 hover:border-zinc-500/80 hover:shadow-emerald-950/20">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-3 py-2">
        <div className="flex items-center space-x-2">
          <FileIcon fileName={data.name} size={16} className="flex-shrink-0" />
          <span className="font-mono text-sm font-semibold truncate max-w-[180px]">{data.name}</span>
        </div>
        <Link size={12} className="text-zinc-500" />
      </div>
      <div className="p-3">
        <p className="font-mono text-[10px] text-zinc-500 truncate mb-2">{data.path}</p>
        <div className="bg-zinc-950 rounded-lg p-2 border border-zinc-850 text-[11px] font-mono text-emerald-300/90 h-16 overflow-hidden select-none">
          <code>
            {`// Attached file context
import React from 'react';
// Loading file structure...`}
          </code>
        </div>
      </div>
      
      {/* Handles for connections */}
      <Handle
        type="source"
        position={Position.Right}
        id="vfs-out"
        style={{ background: "#10b981", width: 8, height: 8 }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="vfs-in"
        style={{ background: "#3b82f6", width: 8, height: 8 }}
      />
    </div>
  );
};
