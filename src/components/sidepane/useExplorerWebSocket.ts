import { useState, useEffect, useRef, useMemo } from "react";
import { useWorkspaceStore } from "../../store";
import { VfsRegistry } from "../../services/vfs";
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

const activeExplorerSockets = new Map<string, WebSocket>();

export const useExplorerWebSocket = (selectedNode: any) => {
  const selectedNodeId = selectedNode?.id || null;
  const nodeStatus = useWorkspaceStore((state) => state.nodeStatus[selectedNodeId || ""] || "idle");

  const tabId = useMemo(() => {
    if (!selectedNodeId) return undefined;
    const contexts = useWorkspaceStore.getState().canvasContexts;
    for (const tId in contexts) {
      if (contexts[tId].nodes.some((n) => n.id === selectedNodeId)) {
        return tId;
      }
    }
    return undefined;
  }, [selectedNodeId]);

  const [explorerInput, setExplorerInput] = useState("");
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const explorerSocketRef = useRef<WebSocket | null>(null);
  const consoleMessageIdRef = useRef<string | null>(null);
  const consoleBufferRef = useRef<string>("");
  const consoleFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addGlobalChatMessage = useWorkspaceStore((state) => state.addGlobalChatMessage);
  const updateGlobalChatMessage = useWorkspaceStore((state) => state.updateGlobalChatMessage);
  const setGlobalContextSummary = useWorkspaceStore((state) => state.setGlobalContextSummary);
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode);
  const addLog = useWorkspaceStore((state) => state.addLog);
  const setNodeStatus = useWorkspaceStore((state) => state.setNodeStatus);

  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const providers = useWorkspaceStore((state) => state.customProviders);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);
  const isProviderActive = (prov: any) => {
    if (prov.id === "anthropic" || prov.id === "openai") {
      return !!prov.apiKey;
    }
    return true;
  };
  const filteredProviders = providers.filter(isProviderActive);
  const activeProvider = filteredProviders.find((p) => p.id === activeCustomProviderId);
  const availableModels = activeProvider ? activeProvider.models : [];
  const allAvailableModels = filteredProviders.flatMap((prov) =>
    prov.models.map((m: any) => ({
      id: m.id,
      name: `${prov.name} / ${m.name}`,
    }))
  );

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
    if (selectedNodeId) {
      const existing = activeExplorerSockets.get(selectedNodeId);
      if (existing && existing.readyState === WebSocket.OPEN) {
        explorerSocketRef.current = existing;
      }
    }
  }, [selectedNodeId]);

  useEffect(() => {
    return () => {
      // Do NOT close the WebSocket connection on unmount so the sidecar exploration keeps running!
    };
  }, []);

  const flushConsoleBuffer = () => {
    if (consoleMessageIdRef.current && consoleBufferRef.current) {
      updateGlobalChatMessage(selectedNodeId || "", consoleMessageIdRef.current, consoleBufferRef.current);
    }
  };

  const scheduleConsoleFlush = () => {
    if (consoleFlushTimeoutRef.current) return;
    consoleFlushTimeoutRef.current = setTimeout(() => {
      consoleFlushTimeoutRef.current = null;
      flushConsoleBuffer();
    }, 150);
  };

  const handleExplorerSendMessage = () => {
    if (!selectedNodeId) return;
    if (!explorerInput.trim() || nodeStatus === "running") return;

    const userMessage = {
      role: "user" as const,
      content: explorerInput.trim(),
      timestamp: new Date().toLocaleTimeString()
    };

    addGlobalChatMessage(selectedNodeId, userMessage);

    const consoleMessageId = `console_${Date.now()}`;
    consoleMessageIdRef.current = consoleMessageId;
    consoleBufferRef.current = "";
    addGlobalChatMessage(selectedNodeId, {
      id: consoleMessageId,
      role: "console",
      content: "",
      timestamp: new Date().toLocaleTimeString(),
    });
    setStreamingMessageId(consoleMessageId);

    setExplorerInput("");
    setNodeStatus(selectedNodeId, "running");
    addLog(selectedNodeId, `User prompt: ${userMessage.content}`);

    console.log(`[SidePane] Connecting to ws://localhost:4000...`);
    let socket: WebSocket;
    try {
      socket = new WebSocket("ws://localhost:4000");
      explorerSocketRef.current = socket;
      if (selectedNodeId) {
        activeExplorerSockets.set(selectedNodeId, socket);
      }
    } catch (err: any) {
      console.error("Failed to construct Explorer WebSocket:", err);
      addLog(selectedNodeId, `Fatal: Failed to construct Explorer WebSocket: ${err.message}`);
      setNodeStatus(selectedNodeId, "error");
      const errorMsg = {
        role: "assistant" as const,
        content: `Connection failed: ${err.message || String(err)}`,
        timestamp: new Date().toLocaleTimeString()
      };
      addGlobalChatMessage(selectedNodeId, errorMsg);
      notify(
        "Sidecar Connection Error",
        `Failed to create WebSocket connection to sidecar: ${err.message || String(err)}. Ensure the agent sidecar is running on port 4000.`,
        "error"
      );
      return;
    }

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

      // Resolve skill: prefer the skill selected on the node, fall back to task-auditor.
      const skills = useWorkspaceStore.getState().skills;
      const nodeSkillId = selectedNode?.data?.skillId as string | undefined;
      const selectedCustomSkill = nodeSkillId ? skills.find((s: any) => s.id === nodeSkillId) : null;
      const auditorSkill = skills.find((s: any) => s.id === "skill_task_auditor");
      const activeSkill = selectedCustomSkill || auditorSkill;
      const skillData = activeSkill ? {
        systemPrompt: activeSkill.systemPrompt,
        enabledTools: activeSkill.enabledTools,
        preferredModel: activeSkill.preferredModel,
      } : null;

      // Build MCP server list from:
      //  1. The active skill's mcpServers (by name → resolved from the store)
      //  2. Any explicit MCP server override selected directly on the node
      const mcpServerName = selectedNode?.data?.mcpServerName as string | undefined;
      const mcpServersMap = useWorkspaceStore.getState().mcpServers;
      const mcpServerNames = Array.from(new Set([
        ...(activeSkill?.mcpServers || []),
        ...(mcpServerName ? [mcpServerName] : [])
      ]));
      const mcpServers = mcpServerNames
        .map((name) => mcpServersMap[name])
        .filter((srv): srv is Exclude<typeof srv, undefined> => !!srv);

      socket.send(JSON.stringify({
        type: "global_explore",
        nodeId: selectedNodeId,
        prompt: userMessage.content,
        workspaceRoot: rootPath,
        model: currentExploreModel,
        chatHistory: chatHistory
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role, content: m.content })),
        mcpServers,
        customProvider:
          prov &&
          (prov.id !== "anthropic" && prov.id !== "openai" || !!prov.apiKey)
            ? prov
            : null,
        skill: skillData,
        planOnly: true,
      }));
    };

    socket.onmessage = (event) => {
      console.log(`[SidePane] Received message:`, event.data);
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "log" && msg.nodeId === selectedNodeId) {
          addLog(selectedNodeId, msg.message);
          consoleBufferRef.current += msg.message + "\n";
          scheduleConsoleFlush();
          return;
        }

        if (msg.type === "read_file") {
          console.log(`[SidePane] Tool request: read_file ${msg.path}`);
          VfsRegistry.getOrCreate(tabId).readFile(msg.path).then((content: unknown) => {
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
            id: `msg_${Date.now()}`,
            role: "assistant" as const,
            content: responseText,
            timestamp: new Date().toLocaleTimeString()
          };
          addGlobalChatMessage(selectedNodeId, assistantMsg);

          if (consoleFlushTimeoutRef.current) {
            clearTimeout(consoleFlushTimeoutRef.current);
            consoleFlushTimeoutRef.current = null;
          }
          if (consoleMessageIdRef.current) {
            updateGlobalChatMessage(selectedNodeId, consoleMessageIdRef.current, "");
          }
          setStreamingMessageId(null);

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
            id: `msg_${Date.now()}`,
            role: "assistant" as const,
            content: `Error: ${msg.error}`,
            timestamp: new Date().toLocaleTimeString()
          };
          addGlobalChatMessage(selectedNodeId, errorMsg);
          if (consoleFlushTimeoutRef.current) {
            clearTimeout(consoleFlushTimeoutRef.current);
            consoleFlushTimeoutRef.current = null;
          }
          if (consoleMessageIdRef.current) {
            updateGlobalChatMessage(selectedNodeId, consoleMessageIdRef.current, "");
          }
          setStreamingMessageId(null);
          setNodeStatus(selectedNodeId, "error");
          addLog(selectedNodeId, `Global exploration error: ${msg.error}`);
          socket.close();
          notify("Exploration Error", `Exploration failed with error: ${msg.error}`, "error");
        }
      } catch (err: any) {
        console.error(`[SidePane] Parse error:`, err);
        addLog(selectedNodeId, `Parse error: ${err.message}`);
        notify("Sidecar Communication Error", `Error processing message from sidecar: ${err.message || String(err)}`, "error");
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
      notify(
        "Sidecar Connection Failed",
        "Connection to agent sidecar closed unexpectedly. Ensure agent sidecar is running on port 4000.",
        "error"
      );
    };

    socket.onclose = (event) => {
      console.log(`[SidePane] Explorer WebSocket closed (code: ${event.code}, reason: "${event.reason}", clean: ${event.wasClean})`);
      addLog(selectedNodeId, `Explorer WebSocket closed (code: ${event.code}, reason: "${event.reason || "none"}", clean: ${event.wasClean})`);
      
      const currentStatus = useWorkspaceStore.getState().nodeStatus[selectedNodeId];
      if (currentStatus === "running") {
        setNodeStatus(selectedNodeId, "error");
        const errorMsg = {
          id: `msg_${Date.now()}`,
          role: "assistant" as const,
          content: `Connection lost unexpectedly (WebSocket close code: ${event.code}).`,
          timestamp: new Date().toLocaleTimeString()
        };
        addGlobalChatMessage(selectedNodeId, errorMsg);
        notify(
          "Connection Lost",
          `The sidecar connection was closed abnormally (code: ${event.code}).`,
          "error"
        );
      }
      if (selectedNodeId) {
        activeExplorerSockets.delete(selectedNodeId);
      }
      setStreamingMessageId(null);
      explorerSocketRef.current = null;
    };
  };

  const handleStopExplorer = () => {
    const socket = selectedNodeId ? activeExplorerSockets.get(selectedNodeId) : explorerSocketRef.current;
    if (socket) {
      socket.close();
    }
    if (selectedNodeId) {
      activeExplorerSockets.delete(selectedNodeId);
    }
    explorerSocketRef.current = null;
    setStreamingMessageId(null);
    setNodeStatus(selectedNodeId || "", "idle");
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
    addLog(selectedNodeId, "Summarizing conversation (focused on recent discussion)...");

    let socket: WebSocket;
    try {
      socket = new WebSocket("ws://localhost:4000");
      explorerSocketRef.current = socket;
      if (selectedNodeId) {
        activeExplorerSockets.set(selectedNodeId, socket);
      }
    } catch (err: any) {
      console.error("Failed to construct Summarize WebSocket:", err);
      addLog(selectedNodeId, `Fatal: Failed to construct Summarize WebSocket: ${err.message}`);
      setNodeStatus(selectedNodeId, "error");
      setIsSummarizing(false);
      notify(
        "Sidecar Connection Error",
        `Failed to create WebSocket connection to sidecar: ${err.message || String(err)}. Ensure the agent sidecar is running on port 4000.`,
        "error"
      );
      return;
    }

    // Focus on the most recent portion of the discussion. The user typically
    // iterates over many topics and acts on the latest one, so the summary
    // should capture the current intent rather than earlier tangents.
    const RECENT_WINDOW = 8;
    const recentMessages = chatHistory.slice(-RECENT_WINDOW);
    const totalCount = chatHistory.length;
    const truncatedCount = Math.max(0, totalCount - recentMessages.length);
    const conversationText = recentMessages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");

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

      const truncationNote = truncatedCount > 0
        ? `\n\nNote: This conversation had ${totalCount} total messages; only the last ${recentMessages.length} are included because the user iterates over many topics and the current focus is the most recent discussion.`
        : "";

      socket.send(JSON.stringify({
        type: "global_explore",
        nodeId: selectedNodeId,
        prompt: `Please summarize the recent portion of the following conversation concisely. The user typically discusses many topics in sequence but only acts on the latest one, so focus the summary on the most recent exchange: what the user wants, what was decided or agreed, and the immediate next steps.${truncationNote}\n\n${conversationText}`,
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
          VfsRegistry.getOrCreate(tabId).readFile(msg.path).then((content: unknown) => {
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
          notify("Summarize Error", `Summarization failed with error: ${msg.error}`, "error");
        }
      } catch (err: any) {
        addLog(selectedNodeId, `Parse error: ${err.message}`);
        setIsSummarizing(false);
        notify("Sidecar Communication Error", `Error processing message from sidecar: ${err.message || String(err)}`, "error");
      }
    };

    socket.onerror = (error) => {
      console.error(`[SidePane] Summarize WebSocket error:`, error);
      addLog(selectedNodeId, "Connection to sidecar failed during summarization.");
      setNodeStatus(selectedNodeId, "error");
      setIsSummarizing(false);
      notify(
        "Sidecar Connection Failed",
        "Connection to agent sidecar closed unexpectedly during summarization. Ensure agent sidecar is running on port 4000.",
        "error"
      );
    };

    socket.onclose = (event) => {
      console.log(`[SidePane] Summarize WebSocket closed (code: ${event.code}, reason: "${event.reason}", clean: ${event.wasClean})`);
      addLog(selectedNodeId, `Summarize WebSocket closed (code: ${event.code}, reason: "${event.reason || "none"}", clean: ${event.wasClean})`);
      
      const currentStatus = useWorkspaceStore.getState().nodeStatus[selectedNodeId];
      if (currentStatus === "running") {
        setNodeStatus(selectedNodeId, "error");
        notify(
          "Connection Lost",
          `The sidecar connection was closed abnormally during summarization (code: ${event.code}).`,
          "error"
        );
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
    handleStopExplorer,
    streamingMessageId,
    exploreModel,
    summarizeModel,
    providers: filteredProviders,
    activeCustomProviderId,
    availableModels,
    allAvailableModels
  };
};
