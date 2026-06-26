/**
 * useEdgeWebSocket Hook
 * 
 * Manages WebSocket communication with the agent sidecar during reconciliation chats.
 * It handles message sending/receiving, file reads/writes requested by the agent,
 * state changes, and logs chat history.
 */

import { useState, useRef, useEffect } from "react";
import { useWorkspaceStore } from "../../store";
import { invoke } from "@tauri-apps/api/core";

export const useEdgeWebSocket = (
  edgeId: string | null,
  sourceNode: any,
  targetNode: any,
  sourceModifiedFiles: string[],
  diffFile: string,
  loadDiffContent: (path: string) => Promise<void>
) => {
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Set initial chat messages when edgeId changes
  useEffect(() => {
    if (!edgeId || !sourceNode || !targetNode) return;

    const sourceName = (sourceNode.data as any).name || sourceNode.id;
    const targetName = (targetNode.data as any).name || targetNode.id;
    const files = sourceModifiedFiles.join(", ") || "none";

    setChatMessages([
      {
        role: "system",
        content: `I'm analyzing the connection between "${sourceName}" → "${targetName}". The source task modified: ${files}. I'll help resolve any conflicts between these changes and the target task's requirements.`,
      },
    ]);
  }, [edgeId, sourceNode?.id, targetNode?.id, sourceModifiedFiles]);

  const handleSendChat = () => {
    if (!chatInput.trim() || isResolving || !edgeId) return;

    const userMsg = { role: "user", content: chatInput.trim() };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setIsResolving(true);

    const socket = new WebSocket("ws://localhost:4000");

    socket.onopen = () => {
      const rootPath = useWorkspaceStore.getState().rootPath;
      const providers = useWorkspaceStore.getState().customProviders;
      const activeProviderId = useWorkspaceStore.getState().activeCustomProviderId;
      const provider = providers.find((p) => p.id === activeProviderId);

      socket.send(
        JSON.stringify({
          type: "reconciliate_edge",
          edgeId: edgeId,
          sourceTaskId: sourceNode?.id,
          targetTaskId: targetNode?.id,
          modifiedFiles: sourceModifiedFiles,
          userMessage: userMsg.content,
          chatHistory: chatMessages.map((m) => ({ role: m.role, content: m.content })),
          workspaceRoot: rootPath,
          model: useWorkspaceStore.getState().activeModel,
          sourcePrompt: (sourceNode?.data as any)?.prompt || "",
          targetPrompt: (targetNode?.data as any)?.prompt || "",
          customProvider:
            provider &&
            (provider.id !== "anthropic" && provider.id !== "openai" || !!provider.apiKey)
              ? provider
              : null,
        })
      );
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "read_file") {
          invoke("read_file_vfs", { path: msg.path })
            .then((content: any) => {
              socket.send(
                JSON.stringify({
                  type: "read_file_response",
                  requestId: msg.requestId,
                  content,
                })
              );
            })
            .catch((err: any) => {
              socket.send(
                JSON.stringify({
                  type: "read_file_response",
                  requestId: msg.requestId,
                  error: err.message || String(err),
                })
              );
            });
          return;
        }

        if (msg.type === "write_file") {
          invoke("write_file_vfs", { path: msg.path, content: msg.content })
            .then(() => {
              socket.send(
                JSON.stringify({ type: "write_file_response", requestId: msg.requestId })
              );
            })
            .catch((err: any) => {
              socket.send(
                JSON.stringify({
                  type: "write_file_response",
                  requestId: msg.requestId,
                  error: err.message || String(err),
                })
              );
            });
          return;
        }

        if (msg.type === "reconciliation_complete") {
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: msg.response || "Analysis complete." },
          ]);
          setIsResolving(false);
          if (diffFile) loadDiffContent(diffFile);
          socket.close();
        }

        if (msg.type === "reconciliation_error") {
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Error: ${msg.error}` },
          ]);
          setIsResolving(false);
          socket.close();
        }
      } catch (err: any) {
        console.error("EdgeInspector parse error:", err);
      }
    };

    socket.onerror = (error) => {
      console.error(`[EdgeInspectorPane] WebSocket error:`, error);
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Failed to connect to sidecar. Ensure the sidecar server is running." },
      ]);
      setIsResolving(false);
    };

    socket.onclose = (event) => {
      console.log(`[EdgeInspectorPane] WebSocket closed (code: ${event.code}, reason: "${event.reason}", clean: ${event.wasClean})`);
      if (isResolving) {
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Connection closed unexpectedly (WebSocket code: ${event.code}).` }
        ]);
        setIsResolving(false);
      }
    };
  };

  return {
    chatMessages,
    chatInput,
    setChatInput,
    isResolving,
    chatEndRef,
    handleSendChat
  };
};
