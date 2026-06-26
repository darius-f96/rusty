import React, { useRef } from "react";
import { useWorkspaceStore } from "../store";
import { invoke } from "@tauri-apps/api/core";
import { TabBar } from "./TabBar";
import { CanvasTab } from "./tabs/canvas/CanvasTab";
import { FileTab } from "./tabs/FileTab";
import { TaskTab } from "./tabs/TaskTab";
import { GitDiffTab } from "./tabs/GitDiffTab";
import { LlmSetupTab } from "./tabs/LlmSetupTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { GitHistoryTab } from "./tabs/GitHistoryTab";
import { WorkspaceTab } from "./tabs/WorkspaceTab";

export const Workspace: React.FC = () => {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const editorGroups = useWorkspaceStore((state) => state.editorGroups);
  const groupSizes = useWorkspaceStore((state) => state.groupSizes);
  const setGroupSizes = useWorkspaceStore((state) => state.setGroupSizes);
  const activeGroupId = useWorkspaceStore((state) => state.activeGroupId);
  const setActiveGroupId = useWorkspaceStore((state) => state.setActiveGroupId);
  const moveTab = useWorkspaceStore((state) => state.moveTab);

  const addLog = useWorkspaceStore((state) => state.addLog);
  const clearLogs = useWorkspaceStore((state) => state.clearLogs);
  const setNodeStatus = useWorkspaceStore((state) => state.setNodeStatus);

  const globalContextSummary = useWorkspaceStore((state) => state.globalContextSummary);

  const socketRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent, index: number) => {
    e.preventDefault();
    if (!containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const startX = e.clientX;
    const startSizes = [...groupSizes];

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaPercent = deltaX / containerRect.width;

      const newSizes = [...startSizes];
      const newPercent_i = startSizes[index] + deltaPercent;

      const minPercent = 0.10;
      const totalOfTwo = startSizes[index] + startSizes[index + 1];

      let percent_i = Math.max(minPercent, Math.min(totalOfTwo - minPercent, newPercent_i));
      let percent_ip1 = totalOfTwo - percent_i;

      newSizes[index] = percent_i;
      newSizes[index + 1] = percent_ip1;

      setGroupSizes(newSizes);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // WebSocket execution runner
  const executeNode = (nodeId: string, customPrompt?: string) => {
    const storeState = useWorkspaceStore.getState();
    
    // Find the canvas context containing this node
    let targetTabId = "";
    let node: any = null;
    if (storeState.canvasContexts) {
      for (const tId in storeState.canvasContexts) {
        const ctx = storeState.canvasContexts[tId];
        const found = ctx.nodes.find((n) => n.id === nodeId);
        if (found) {
          targetTabId = tId;
          node = found;
          break;
        }
      }
    }
    
    // Fallback to top-level if not found
    if (!node) {
      node = storeState.nodes.find((n) => n.id === nodeId);
    }
    
    if (!node || node.type !== "taskNode") return;

    // Resolve context using targetTabId
    const tabCtx = targetTabId ? storeState.canvasContexts[targetTabId] : null;
    const currentNodes = tabCtx ? tabCtx.nodes : storeState.nodes;
    const currentEdges = tabCtx ? tabCtx.edges : storeState.edges;

    const activeModel = storeState.activeModel;
    const customProviders = storeState.customProviders;
    const activeCustomProviderId = storeState.activeCustomProviderId;

    const nodeModel = (node.data as any).model || activeModel;

    // Resolve provider for the node's model
    let provider = null;
    if (nodeModel && (nodeModel as string).includes("/")) {
      const providerId = (nodeModel as string).split("/")[0];
      provider = customProviders.find((p) => p.id === providerId);
    } else {
      provider = customProviders.find((p) => p.id === activeCustomProviderId);
    }

    const connectedEdges = currentEdges.filter((edge) => edge.target === nodeId);
    const inputFiles = connectedEdges
      .map((edge) => currentNodes.find((n) => n.id === edge.source))
      .filter((n): n is Exclude<typeof n, undefined> => n !== undefined && n.type === "contextNode" && !!n.data.path)
      .map((n) => ({
        path: n.data.path as string,
        name: n.data.fileName as string,
        isDir: !!n.data.isDir,
      }));

    // Gather text descriptions from connected context nodes
    const contextDescriptions = connectedEdges
      .map((edge) => currentNodes.find((n) => n.id === edge.source))
      .filter((n): n is Exclude<typeof n, undefined> => n !== undefined && n.type === "contextNode")
      .map((n) => {
        const parts: string[] = [];
        if (n.data.name) parts.push(`[${n.data.name}]`);
        if (n.data.description) parts.push(n.data.description as string);
        if (n.data.path) parts.push(`File: ${n.data.path}`);
        return parts.join(" — ");
      })
      .filter((s) => s.length > 0);

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

    // Setup chat messages for prompt chat
    const store = useWorkspaceStore.getState();
    let currentInstructions = node.data.prompt || "";
    let chatHistoryToSend: any[] = [];

    if (customPrompt) {
      // Refinement message from Prompt Chat
      const userMsg = {
        role: "user" as const,
        content: customPrompt,
        timestamp: new Date().toLocaleTimeString()
      };
      store.addGlobalChatMessage(nodeId, userMsg);
      chatHistoryToSend = store.getGlobalChatHistory(nodeId).map(m => ({ role: m.role, content: m.content }));
      currentInstructions = customPrompt;
    } else {
      // Initial "Run Executor" procedure call
      store.clearGlobalChatHistory(nodeId);
      
      let formattedPrompt = "";
      if (globalContextSummary) {
        formattedPrompt += `<general context>\n${globalContextSummary}\n</general context>\n`;
      }
      formattedPrompt += `<TaskNodeContent>\n${node.data.prompt || ""}\n</TaskNodeContent>\n`;
      if (contextDescriptions.length > 0) {
        formattedPrompt += `<Context>\n${contextDescriptions.join("\n")}\n</Context>`;
      }

      const userMsg = {
        role: "user" as const,
        content: formattedPrompt,
        timestamp: new Date().toLocaleTimeString()
      };
      store.addGlobalChatMessage(nodeId, userMsg);
      chatHistoryToSend = [{ role: "user", content: formattedPrompt }];
      currentInstructions = formattedPrompt;
    }

    const socket = new WebSocket("ws://localhost:4000");
    socketRef.current = socket;

    socket.onopen = () => {
      console.log("WebSocket connection opened to sidecar");
      addLog(nodeId, "Connection established. Dispatching task execution details...");

      socket.send(
        JSON.stringify({
          type: "execute_node",
          nodeId,
          instructions: currentInstructions,
          model: nodeModel,
          workspaceRoot: rootPath,
          inputFiles,
          globalContext: globalContextSummary || "",
          contextDescriptions,
          chatHistory: chatHistoryToSend,
          customProvider:
            provider &&
            (provider.id !== "anthropic" && provider.id !== "openai" || !!provider.apiKey)
              ? provider
              : null,
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
          const responseText = data.result?.response || "Task completed successfully.";
          console.log("WebSocket [execution_complete] modified files:", modified);
          addLog(
            nodeId,
            `AI task execution successfully completed. Modified: ${modified.join(", ") || "none"}`
          );

          // Add assistant message to history
          const assistantMsg = {
            role: "assistant" as const,
            content: responseText,
            timestamp: new Date().toLocaleTimeString()
          };
          store.addGlobalChatMessage(nodeId, assistantMsg);

          useWorkspaceStore.getState().updateTaskNode(nodeId, { modifiedFiles: modified });
          setNodeStatus(nodeId, "success");
          socket.close();
        }

        if (data.type === "execution_error" && data.nodeId === nodeId) {
          console.error("WebSocket [execution_error]:", data.error);
          addLog(nodeId, `AI Execution Error: ${data.error}`);

          // Add assistant error message to history
          const assistantMsg = {
            role: "assistant" as const,
            content: `Execution failed: ${data.error}`,
            timestamp: new Date().toLocaleTimeString()
          };
          store.addGlobalChatMessage(nodeId, assistantMsg);

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

    socket.onclose = (event) => {
      console.log(`[Workspace] WebSocket closed (code: ${event.code}, reason: "${event.reason}", clean: ${event.wasClean})`);
      addLog(nodeId, `WebSocket connection closed (code: ${event.code}, reason: "${event.reason || "none"}", clean: ${event.wasClean})`);
      const currentStatus = useWorkspaceStore.getState().nodeStatus[nodeId];
      if (currentStatus === "running") {
        setNodeStatus(nodeId, "error");
      }
    };
  };

  const renderTabPanel = (tabsList: any[], activeId: string | null, groupId: string) => {
    return tabsList.map((tab) => {
      const isActive = tab.id === activeId;
      const isCanvas = tab.type === "canvas";

      // Optimize rendering: unmount non-active file/task/diff tabs
      if (!isActive && !isCanvas) return null;

      const bgClass = isCanvas ? "bg-[var(--bg-canvas)]" : "bg-[var(--bg-editor)]";
      return (
        <div
          key={`${groupId}-${tab.id}`}
          className={`${isActive ? "w-full h-full" : "absolute -left-[99999px] top-0 w-full h-full"} ${bgClass} overflow-hidden`}
        >
          {tab.type === "canvas" && (
            <CanvasTab tab={tab} onExecuteNode={executeNode} />
          )}
          {tab.type === "file" && (
            <FileTab tab={tab} groupId={groupId} />
          )}
          {tab.type === "task" && (
            <TaskTab tab={tab} onExecuteNode={executeNode} groupId={groupId} />
          )}
          {tab.type === "git-diff" && (
            <GitDiffTab tab={tab} groupId={groupId} />
          )}
          {tab.type === "llm-setup" && (
            <LlmSetupTab />
          )}
          {tab.type === "settings" && (
            <SettingsTab />
          )}
          {tab.type === "git-history" && (
            <GitHistoryTab tab={tab} />
          )}
          {tab.type === "workspace" && (
            <WorkspaceTab />
          )}
        </div>
      );
    });
  };

  return (
    <div ref={containerRef} className="flex-1 flex h-full min-w-0 overflow-hidden relative bg-[var(--bg-editor)]">
      {editorGroups.map((group, idx) => {
        const widthPercent = (groupSizes[idx] || (1 / editorGroups.length)) * 100;
        const isLast = idx === editorGroups.length - 1;

        return (
          <React.Fragment key={group.id}>
            {/* Editor Pane Column */}
            <div
              style={{ width: `${widthPercent}%` }}
              className={`flex flex-col h-full min-w-0 overflow-hidden ${
                !isLast ? "border-r border-[var(--border-color)]" : ""
              }`}
              onClick={() => {
                if (activeGroupId !== group.id) {
                  setActiveGroupId(group.id);
                }
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const tabId = e.dataTransfer.getData("text/plain");
                const fromGroupId = e.dataTransfer.getData("from-group-id");
                if (tabId && fromGroupId && fromGroupId !== group.id) {
                  moveTab(tabId, fromGroupId, group.id);
                }
              }}
            >
              <TabBar groupId={group.id} />
              <div className="flex-1 min-h-0 relative bg-[var(--bg-editor)] overflow-hidden">
                {renderTabPanel(group.openTabs, group.activeTabId, group.id)}
              </div>
            </div>

            {/* Resize Handle (only show between adjacent panes) */}
            {!isLast && (
              <div
                className="w-1 bg-[var(--border-color)] hover:bg-[var(--accent-color)] active:bg-[var(--accent-color)] cursor-col-resize transition-all flex-shrink-0 z-30 relative"
                onMouseDown={(e) => handleMouseDown(e, idx)}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
