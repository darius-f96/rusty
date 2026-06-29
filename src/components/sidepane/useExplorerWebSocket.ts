import { useState, useEffect, useRef } from "react";
import { useWorkspaceStore } from "../../store";
import { invoke } from "@tauri-apps/api/core";
import { notify } from "../../notificationStore";

const CONTEXT_NODE_CREATION_MARKER = "[CREATE_CONTEXT_NODES]";

const parseAndCreateContextNodes = (response: string, nodePosition: { x: number; y: number }, tabId: string) => {
  const markerIndex = response.indexOf(CONTEXT_NODE_CREATION_MARKER);
  if (markerIndex === -1) return [];

  const afterMarker = response.substring(markerIndex + CONTEXT_NODE_CREATION_MARKER.length);
  const lines = afterMarker.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  const filePaths: string[] = [];
  for (const line of lines) {
    if (line.startsWith("[")) break;
    if (line.startsWith("-")) {
      const path = line.substring(1).trim();
      if (path.startsWith("/") || path.includes(":")) {
        filePaths.push(path);
      }
    } else if (line.startsWith("/") || line.includes(":\\")) {
      filePaths.push(line);
    }
  }

  if (filePaths.length === 0) return [];

  const store = useWorkspaceStore.getState();
  const created: string[] = [];
  let offsetX = 0;
  let offsetY = 0;

  for (const filePath of filePaths) {
    const fileName = filePath.split("/").pop() || filePath.split("\\").pop() || filePath;
    store.addContextNode(
      nodePosition.x + 220 + offsetX,
      nodePosition.y + offsetY,
      { path: filePath, name: fileName, isDir: false },
      tabId
    );
    created.push(filePath);
    offsetY += 80;
    if (offsetY > 300) {
      offsetY = 0;
      offsetX += 200;
    }
  }

  return created;
};

export const useExplorerWebSocket = (selectedNode: any) => {
  const selectedNodeId = selectedNode?.id || null;
  const nodeStatus = useWorkspaceStore((state) => state.nodeStatus[selectedNodeId || ""] || "idle");

  const [explorerInput, setExplorerInput] = useState("");
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const explorerSocketRef = useRef<WebSocket | null>(null);

  const addGlobalChatMessage = useWorkspaceStore((state) => state.addGlobalChatMessage);
  const setGlobalContextSummary = useWorkspaceStore((state) => state.setGlobalContextSummary);
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode);
  const addLog = useWorkspaceStore((state) => state.addLog);
  const setNodeStatus = useWorkspaceStore((state) => state.setNodeStatus);

  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const providers = useWorkspaceStore((state) => state.customProviders);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);
  const activeProvider = providers.find((p) => p.id === activeCustomProviderId);
  const availableModels = activeProvider ? activeProvider.models : [];

  const exploreModel = (selectedNode?.data?.exploreModel as string) || activeModel;
  const summarizeModel = (selectedNode?.data?.summarizeModel as string) || activeModel;

  const getActiveCanvasTabId = () => {
    const state = useWorkspaceStore.getState();
    const activeGroup = state.editorGroups.find((g) => g.id === state.activeGroupId);
    if (activeGroup && activeGroup.activeTabId) {
      const activeTab = activeGroup.openTabs.find((t) => t.id === activeGroup.activeTabId);
      if (activeTab && activeTab.type === "canvas") {
        return activeTab.id;
      }
    }
    for (const group of state.editorGroups) {
      const canvasTab = group.openTabs.find((t) => t.type === "canvas");
      if (canvasTab) return canvasTab.id;
    }
    return "canvas";
  };

  useEffect(() => {
    return () => {
      if (explorerSocketRef.current) {
        explorerSocketRef.current.close();
      }
    };
  }, []);

  const handleExplorerSendMessage = () => {
    if (!selectedNodeId) return;
    if (!explorerInput.trim() || nodeStatus === "running") return;

    const userMessage = {
      role: "user" as const,
      content: explorerInput.trim(),
      timestamp: new Date().toLocaleTimeString()
    };

    addGlobalChatMessage(selectedNodeId, userMessage);
    setExplorerInput("");
    setNodeStatus(selectedNodeId, "running");
    addLog(selectedNodeId, `User prompt: ${userMessage.content}`);

    console.log(`[SidePane] Connecting to ws://localhost:4000...`);
    const socket = new WebSocket("ws://localhost:4000");
    explorerSocketRef.current = socket;

    socket.onopen = () => {
      console.log(`[SidePane] WebSocket connected!`);
      addLog(selectedNodeId, "Connected to agent sidecar for global exploration...");

      const rootPath = useWorkspaceStore.getState().rootPath;
      const currentProviders = useWorkspaceStore.getState().customProviders;
      const currentActiveProviderId = useWorkspaceStore.getState().activeCustomProviderId;
      const prov = currentProviders.find((p) => p.id === currentActiveProviderId);
      const currentActiveModel = useWorkspaceStore.getState().activeModel;
      const currentExploreModel = selectedNode?.data?.exploreModel || currentActiveModel;
      const chatHistory = useWorkspaceStore.getState().globalChatHistory[selectedNodeId] || [];

      // Always use task-auditor skill for this node type.
      const skills = useWorkspaceStore.getState().skills;
      const auditorSkill = skills.find((s: any) => s.id === "skill_task_auditor");
      const skillData = auditorSkill ? {
        systemPrompt: auditorSkill.systemPrompt,
        enabledTools: auditorSkill.enabledTools,
        preferredModel: auditorSkill.preferredModel,
      } : null;

      // Resolve an MCP server selected on the node, if any.
      const mcpServerName = selectedNode?.data?.mcpServerName as string | undefined;
      const mcpServersMap = useWorkspaceStore.getState().mcpServers;
      const mcpServers = mcpServerName && mcpServersMap[mcpServerName]
        ? [mcpServersMap[mcpServerName]]
        : [];

      socket.send(JSON.stringify({
        type: "global_explore",
        nodeId: selectedNodeId,
        prompt: userMessage.content,
        workspaceRoot: rootPath,
        model: currentExploreModel,
        chatHistory: chatHistory.map((m) => ({ role: m.role, content: m.content })),
        mcpServers,
        customProvider:
          prov &&
          (prov.id !== "anthropic" && prov.id !== "openai" || !!prov.apiKey)
            ? prov
            : null,
        skill: skillData,
      }));
    };

    socket.onmessage = (event) => {
      console.log(`[SidePane] Received message:`, event.data);
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "log" && msg.nodeId === selectedNodeId) {
          addLog(selectedNodeId, msg.message);
          return;
        }

        if (msg.type === "read_file") {
          console.log(`[SidePane] Tool request: read_file ${msg.path}`);
          invoke("read_file_vfs", { path: msg.path }).then((content: unknown) => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: "read_file_response",
                requestId: msg.requestId,
                content: content as string
              }));
            } else {
              console.warn(`[SidePane] Socket closed before read_file_response could be sent for ${msg.path}`);
            }
          }).catch((err: any) => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: "read_file_response",
                requestId: msg.requestId,
                error: err.message || String(err)
              }));
            } else {
              console.warn(`[SidePane] Socket closed before read_file error could be sent for ${msg.path}`);
            }
          });
          return;
        }

        if (msg.type === "global_explore_complete" && msg.nodeId === selectedNodeId) {
          console.log(`[SidePane] Exploration complete! Response length: ${msg.response?.length || 0}`);
          const responseText = msg.response || "Exploration complete.";
          const assistantMsg = {
            role: "assistant" as const,
            content: responseText,
            timestamp: new Date().toLocaleTimeString()
          };
          addGlobalChatMessage(selectedNodeId, assistantMsg);

          if (msg.summary) {
            setGlobalContextSummary(msg.summary);
            updateNode(selectedNodeId, { summary: msg.summary });
            addLog(selectedNodeId, `Global context summary updated (${msg.summary.length} chars).`);
          }

          const nodePosition = selectedNode?.position || { x: 100, y: 100 };
          const tabId = getActiveCanvasTabId();
          const createdFiles = parseAndCreateContextNodes(responseText, nodePosition, tabId);
          if (createdFiles.length > 0) {
            addLog(selectedNodeId, `Created ${createdFiles.length} context node(s): ${createdFiles.join(", ")}`);
            notify("Context Nodes Created", `Added ${createdFiles.length} file(s) as context nodes.`, "success");
          }

          setNodeStatus(selectedNodeId, "success");
          addLog(selectedNodeId, "Global exploration completed successfully.");
          socket.close();
        }

        if (msg.type === "global_explore_error" && msg.nodeId === selectedNodeId) {
          console.log(`[SidePane] Exploration error: ${msg.error}`);
          const errorMsg = {
            role: "assistant" as const,
            content: `Error: ${msg.error}`,
            timestamp: new Date().toLocaleTimeString()
          };
          addGlobalChatMessage(selectedNodeId, errorMsg);
          setNodeStatus(selectedNodeId, "error");
          addLog(selectedNodeId, `Global exploration error: ${msg.error}`);
          socket.close();
        }
      } catch (err: any) {
        console.error(`[SidePane] Parse error:`, err);
        addLog(selectedNodeId, `Parse error: ${err.message}`);
      }
    };

    socket.onerror = (error) => {
      console.error(`[SidePane] Explorer WebSocket error:`, error);
      addLog(selectedNodeId, "Connection to sidecar failed. Ensure sidecar is running on port 4000.");
      setNodeStatus(selectedNodeId, "error");
      const errorMsg = {
        role: "assistant" as const,
        content: "Connection failed. Please ensure the agent sidecar is running.",
        timestamp: new Date().toLocaleTimeString()
      };
      addGlobalChatMessage(selectedNodeId, errorMsg);
    };

    socket.onclose = (event) => {
      console.log(`[SidePane] Explorer WebSocket closed (code: ${event.code}, reason: "${event.reason}", clean: ${event.wasClean})`);
      addLog(selectedNodeId, `Explorer WebSocket closed (code: ${event.code}, reason: "${event.reason || "none"}", clean: ${event.wasClean})`);
      
      const currentStatus = useWorkspaceStore.getState().nodeStatus[selectedNodeId];
      if (currentStatus === "running") {
        setNodeStatus(selectedNodeId, "error");
        const errorMsg = {
          role: "assistant" as const,
          content: `Connection lost unexpectedly (WebSocket close code: ${event.code}).`,
          timestamp: new Date().toLocaleTimeString()
        };
        addGlobalChatMessage(selectedNodeId, errorMsg);
      }
      explorerSocketRef.current = null;
    };
  };

  const handleExplorerSummarize = () => {
    if (!selectedNodeId) return;
    const chatHistory = useWorkspaceStore.getState().globalChatHistory[selectedNodeId] || [];
    if (chatHistory.length === 0) {
      notify("Summarize", "No conversation to summarize.", "info");
      return;
    }
    if (nodeStatus === "running" || isSummarizing) return;

    setIsSummarizing(true);
    setNodeStatus(selectedNodeId, "running");
    addLog(selectedNodeId, "Summarizing conversation...");

    const socket = new WebSocket("ws://localhost:4000");
    explorerSocketRef.current = socket;

    const conversationText = chatHistory.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");

    socket.onopen = () => {
      const rootPath = useWorkspaceStore.getState().rootPath;
      const currentProviders = useWorkspaceStore.getState().customProviders;
      const currentActiveProviderId = useWorkspaceStore.getState().activeCustomProviderId;
      const prov = currentProviders.find((p) => p.id === currentActiveProviderId);
      const currentActiveModel = useWorkspaceStore.getState().activeModel;
      const currentSummarizeModel = selectedNode?.data?.summarizeModel || currentActiveModel;

      // Always use task-auditor skill for this node type.
      const skills = useWorkspaceStore.getState().skills;
      const auditorSkill = skills.find((s: any) => s.id === "skill_task_auditor");
      const skillData = auditorSkill ? {
        systemPrompt: auditorSkill.systemPrompt,
        enabledTools: auditorSkill.enabledTools,
        preferredModel: auditorSkill.preferredModel,
      } : null;

      socket.send(JSON.stringify({
        type: "global_explore",
        nodeId: selectedNodeId,
        prompt: `Please summarize the following conversation concisely, highlighting the key insights, findings, and any important decisions or next steps mentioned:\n\n${conversationText}`,
        workspaceRoot: rootPath,
        model: currentSummarizeModel,
        chatHistory: [],
        customProvider:
          prov &&
          (prov.id !== "anthropic" && prov.id !== "openai" || !!prov.apiKey)
            ? prov
            : null,
        skill: skillData,
      }));
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "log" && msg.nodeId === selectedNodeId) {
          addLog(selectedNodeId, msg.message);
          return;
        }

        if (msg.type === "read_file") {
          invoke("read_file_vfs", { path: msg.path }).then((content: unknown) => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: "read_file_response",
                requestId: msg.requestId,
                content: content as string
              }));
            } else {
              console.warn(`[SidePane] Summarize socket closed before read_file_response could be sent`);
            }
          }).catch((err: any) => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: "read_file_response",
                requestId: msg.requestId,
                error: err.message || String(err)
              }));
            } else {
              console.warn(`[SidePane] Summarize socket closed before read_file error could be sent`);
            }
          });
          return;
        }

        if (msg.type === "global_explore_complete" && msg.nodeId === selectedNodeId) {
          const summary = msg.response || "Summary not available.";
          setGlobalContextSummary(summary);
          updateNode(selectedNodeId, { summary });
          setNodeStatus(selectedNodeId, "success");
          addLog(selectedNodeId, `Conversation summarized (${summary.length} chars).`);
          setIsSummarizing(false);
          socket.close();
        }

        if (msg.type === "global_explore_error" && msg.nodeId === selectedNodeId) {
          setNodeStatus(selectedNodeId, "error");
          addLog(selectedNodeId, `Summarize error: ${msg.error}`);
          setIsSummarizing(false);
          socket.close();
        }
      } catch (err: any) {
        addLog(selectedNodeId, `Parse error: ${err.message}`);
        setIsSummarizing(false);
      }
    };

    socket.onerror = (error) => {
      console.error(`[SidePane] Summarize WebSocket error:`, error);
      addLog(selectedNodeId, "Connection to sidecar failed during summarization.");
      setNodeStatus(selectedNodeId, "error");
      setIsSummarizing(false);
    };

    socket.onclose = (event) => {
      console.log(`[SidePane] Summarize WebSocket closed (code: ${event.code}, reason: "${event.reason}", clean: ${event.wasClean})`);
      addLog(selectedNodeId, `Summarize WebSocket closed (code: ${event.code}, reason: "${event.reason || "none"}", clean: ${event.wasClean})`);
      
      const currentStatus = useWorkspaceStore.getState().nodeStatus[selectedNodeId];
      if (currentStatus === "running") {
        setNodeStatus(selectedNodeId, "error");
      }
      setIsSummarizing(false);
      explorerSocketRef.current = null;
    };
  };

  return {
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
  };
};
