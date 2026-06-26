import React from "react";
import { useWorkspaceStore } from "../../../store";

interface ConsoleTabContentProps {
  selectedNodeId: string;
}

const EMPTY_ARRAY: any[] = [];

export const ConsoleTabContent: React.FC<ConsoleTabContentProps> = ({ selectedNodeId }) => {
  const nodeLogs = useWorkspaceStore((state) => state.nodeLogs[selectedNodeId] || EMPTY_ARRAY);

  return (
    <div className="flex flex-col h-full p-4 font-mono text-xs bg-black text-zinc-400 overflow-y-auto space-y-1">
      {nodeLogs.length === 0 ? (
        <span className="text-zinc-600">// No execution logs yet.</span>
      ) : (
        nodeLogs.map((log: string, idx: number) => (
          <div key={idx} className="whitespace-pre-wrap leading-relaxed">
            {log}
          </div>
        ))
      )}
    </div>
  );
};
