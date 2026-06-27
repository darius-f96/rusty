import React, { useRef, useEffect } from "react";
import { useWorkspaceStore } from "../../../store";

interface ConsoleTabContentProps {
  selectedNodeId: string;
}

const EMPTY_ARRAY: any[] = [];

export const ConsoleTabContent: React.FC<ConsoleTabContentProps> = ({ selectedNodeId }) => {
  const nodeLogs = useWorkspaceStore((state) => state.nodeLogs[selectedNodeId] || EMPTY_ARRAY);
  const nodeStatus = useWorkspaceStore((state) => state.nodeStatus[selectedNodeId] || "idle");

  const consoleScrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const previousLogCountRef = useRef(0);

  useEffect(() => {
    if (!selectedNodeId) return;
    const savedPos = localStorage.getItem(`console_scroll_${selectedNodeId}`);
    if (savedPos && consoleScrollRef.current) {
      consoleScrollRef.current.scrollTop = parseInt(savedPos, 10);
    }
    previousLogCountRef.current = nodeLogs.length;
  }, [selectedNodeId]);

  useEffect(() => {
    if (!consoleScrollRef.current) return;

    const isStreaming = nodeStatus === "running";
    const newLogsArrived = nodeLogs.length > previousLogCountRef.current;
    previousLogCountRef.current = nodeLogs.length;

    if (isStreaming && newLogsArrived && isAtBottomRef.current) {
      consoleScrollRef.current.scrollTop = consoleScrollRef.current.scrollHeight;
    }
  }, [nodeLogs.length, nodeStatus]);

  const handleScroll = () => {
    if (!consoleScrollRef.current || !selectedNodeId) return;
    const { scrollTop, scrollHeight, clientHeight } = consoleScrollRef.current;
    localStorage.setItem(`console_scroll_${selectedNodeId}`, String(scrollTop));
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    isAtBottomRef.current = distanceFromBottom < 50;
  };

  return (
    <div
      ref={consoleScrollRef}
      onScroll={handleScroll}
      className="flex flex-col h-full p-4 font-mono text-xs bg-black text-zinc-400 overflow-y-auto space-y-1"
    >
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
