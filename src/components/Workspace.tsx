import React, { useRef } from "react";
import { useWorkspaceStore } from "../store";
import { invoke } from "@tauri-apps/api/core";
import { TabBar } from "./TabBar";
import { CanvasTab } from "./tabs/CanvasTab";
import { FileTab } from "./tabs/FileTab";
import { TaskTab } from "./tabs/TaskTab";
import { GitDiffTab } from "./tabs/GitDiffTab";
import { LlmSetupTab } from "./tabs/LlmSetupTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { GitHistoryTab } from "./tabs/GitHistoryTab";

export const Workspace: React.FC = () => {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const nodes = useWorkspaceStore((state) => state.nodes);
  const edges = useWorkspaceStore((state) => state.edges);
  const openTabs = useWorkspaceStore((state) => state.openTabs);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);

  const addLog = useWorkspaceStore((state) => state.addLog);
  const clearLogs = useWorkspaceStore((state) => state.clearLogs);
  const setNodeStatus = useWorkspaceStore((state) => state.setNodeStatus);

  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);

  const socketRef = useRef<WebSocket | null>(null);

  // WebSocket execution runner
  const executeNode = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== "taskNode") return;

    const connectedEdges = edges.filter((edge) => edge.target === nodeId);
    const inputFiles = connectedEdges
      .map((edge) => nodes.find((n) => n.id === edge.source))
      .filter((n): n is Exclude<typeof n, undefined> => n !== undefined && n.type === "contextNode" && !!n.data.path)
      .map((n) => ({
        path: n.data.path as string,
        name: n.data.fileName as string,
        isDir: !!n.data.isDir,
      }));

    console.log("WebSocket [executeNode] starting task execution", { nodeId, inputFiles });

    clearLogs(nodeId);
    setNodeStatus(nodeId, "running");
    addLog(nodeId, `Connecting to local agent sidecar...`);
    addLog(
      nodeId,
      `Detected ${inputFiles.length} connected context file(s): ${
        inputFiles.map((f) => f.name).join(", ") || "none"
      }`
    );

    const socket = new WebSocket("ws://localhost:4000");
    socketRef.current = socket;

    socket.onopen = () => {
      console.log("WebSocket connection opened to sidecar");
      addLog(nodeId, "Connection established. Dispatching task execution details...");

      const provider = customProviders.find((p) => p.id === activeCustomProviderId);

      socket.send(
        JSON.stringify({
          type: "execute_node",
          nodeId,
          instructions: node.data.prompt,
          model: node.data.model,
          workspaceRoot: rootPath,
          inputFiles,
          customProvider:
            provider && provider.id !== "anthropic" && provider.id !== "openai" ? provider : null,
        })
      );
    };

    socket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("WebSocket received message:", data);

        if (data.type === "log" && data.nodeId === nodeId) {
          addLog(nodeId, data.message);
          return;
        }

        if (data.type === "read_file") {
          try {
            console.log(`WebSocket [read_file] intercept for: ${data.path}`);
            const content: string = await invoke("read_file_vfs", { path: data.path });
            socket.send(
              JSON.stringify({ type: "read_file_response", requestId: data.requestId, content })
            );
          } catch (err: any) {
            console.error("WebSocket [read_file] intercept error:", err);
            socket.send(
              JSON.stringify({
                type: "read_file_response",
                requestId: data.requestId,
                error: err.message,
              })
            );
          }
          return;
        }

        if (data.type === "write_file") {
          try {
            console.log(`WebSocket [write_file] intercept for: ${data.path}`);
            await invoke("write_file_vfs", { path: data.path, content: data.content });
            socket.send(JSON.stringify({ type: "write_file_response", requestId: data.requestId }));
          } catch (err: any) {
            console.error("WebSocket [write_file] intercept error:", err);
            socket.send(
              JSON.stringify({
                type: "write_file_response",
                requestId: data.requestId,
                error: err.message,
              })
            );
          }
          return;
        }

        if (data.type === "execution_complete" && data.nodeId === nodeId) {
          const modified = data.result?.modified || [];
          console.log("WebSocket [execution_complete] modified files:", modified);
          addLog(
            nodeId,
            `AI task execution successfully completed. Modified: ${modified.join(", ") || "none"}`
          );

          useWorkspaceStore.getState().updateTaskNode(nodeId, { modifiedFiles: modified });
          setNodeStatus(nodeId, "success");
          socket.close();
        }

        if (data.type === "execution_error" && data.nodeId === nodeId) {
          console.error("WebSocket [execution_error]:", data.error);
          addLog(nodeId, `AI Execution Error: ${data.error}`);
          setNodeStatus(nodeId, "error");
          socket.close();
        }
      } catch (err: any) {
        console.error("WebSocket onmessage processing error:", err);
        addLog(
          nodeId,
          `Client Error: failed to parse/execute sidecar message: ${err.message}`
        );
      }
    };

    socket.onerror = (err) => {
      console.error("Sidecar connection failed:", err);
      addLog(
        nodeId,
        "Fatal: Agent sidecar connection closed unexpectedly. Ensure Express server is running on port 4000."
      );
      setNodeStatus(nodeId, "error");
    };

    socket.onclose = () => {
      console.log("WebSocket connection closed");
    };
  };

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
      {/* Workspace Unified Tab Bar */}
      <TabBar />

      {/* Tab Panel Render Targets */}
      <div className="flex-1 min-h-0 relative bg-[var(--bg-app)]">
        {openTabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={`w-full h-full ${isActive ? "block" : "hidden"}`}
            >
              {tab.type === "canvas" && (
                <CanvasTab onExecuteNode={executeNode} />
              )}
              {tab.type === "file" && (
                <FileTab tab={tab} />
              )}
              {tab.type === "task" && (
                <TaskTab tab={tab} onExecuteNode={executeNode} />
              )}
              {tab.type === "git-diff" && (
                <GitDiffTab tab={tab} />
              )}
              {tab.type === "llm-setup" && (
                <LlmSetupTab />
              )}
              {tab.type === "settings" && (
                <SettingsTab />
              )}
              {tab.type === "git-history" && (
                <GitHistoryTab />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
