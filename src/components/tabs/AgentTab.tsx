import React, { useState, useEffect, useRef, useCallback } from "react";
import { History, Trash2, Plus, RefreshCw, PanelLeftClose, PanelLeft, Shield, CheckCircle2, FolderGit2, FileText } from "lucide-react";
import { useWorkspaceStore, AgentMessage } from "../../store";
import { CustomSelect } from "../CustomSelect";
import { invoke } from "@tauri-apps/api/core";
import { Chat } from "../ui/Chat";
import { ChatInput } from "../ui/ChatInput";
import { notify } from "../../notificationStore";

interface AgentTabProps {
  tab: any;
  groupId: string;
}

interface SavedChat {
  path: string;
  name: string;
  savedAt: string;
  preview: string;
  messageCount: number;
}

export const AgentTab: React.FC<AgentTabProps> = ({ tab, groupId: _groupId }) => {
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const setActiveModel = useWorkspaceStore((state) => state.setActiveModel);
  const agentChats = useWorkspaceStore((state) => state.agentChats[tab.id] || []);
  const addAgentMessage = useWorkspaceStore((state) => state.addAgentMessage);
  const updateAgentMessage = useWorkspaceStore((state) => state.updateAgentMessage);
  const setAgentMessages = useWorkspaceStore((state) => state.setAgentMessages);
  const clearAgentMessages = useWorkspaceStore((state) => state.clearAgentMessages);
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const openTab = useWorkspaceStore((state) => state.openTab);
  const setFileTree = useWorkspaceStore((state) => state.setFileTree);
  const loadGitStatus = useWorkspaceStore((state) => state.loadGitStatus);
  const skills = useWorkspaceStore((state) => state.skills);
  const activeSkillId = useWorkspaceStore((state) => state.activeSkillId);
  const setActiveSkill = useWorkspaceStore((state) => state.setActiveSkill);

  const [selectedModel, setSelectedModel] = useState(activeModel);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(activeSkillId);
  const [message, setMessage] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<any>(null);
  const [modifiedFiles, setModifiedFiles] = useState<string[]>([]);

  // Chat history panel state
  const [showHistory, setShowHistory] = useState(true);
  const [chatHistory, setChatHistory] = useState<SavedChat[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [activeChatPath, setActiveChatPath] = useState<string | null>(null);

  const agentSocketRef = useRef<WebSocket | null>(null);
  const consoleMessageIdRef = useRef<string | null>(null);
  const consoleBufferRef = useRef<string>("");
  const streamingResponseMessageIdRef = useRef<string | null>(null);
  const streamingResponseBufferRef = useRef<string>("");
  const savedChatPathRef = useRef<string | null>(null);
  const chatSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStreamingRef = useRef(false);

  const modelOptions = customProviders.flatMap((p) => p.models).map((m) => ({
    id: m.id,
    name: `${m.name} (${m.id})`,
  }));

  useEffect(() => {
    if (selectedModel !== activeModel) {
      setActiveModel(selectedModel);
    }
  }, [selectedModel]);

  useEffect(() => {
    setSelectedSkillId(activeSkillId);
  }, [activeSkillId]);

  useEffect(() => {
    return () => {
      if (agentSocketRef.current) {
        agentSocketRef.current.close();
      }
    };
  }, []);

  // ── Chat History ──────────────────────────────────────────────
  const loadChatHistory = useCallback(async () => {
    if (!rootPath) return;
    setLoadingHistory(true);
    try {
      const chatsDir = `${rootPath}/.axiom/chats`;
      const tree = await invoke<any[]>("get_directory_structure", { rootDir: chatsDir });
      const chatFiles = (tree || []).filter((f: any) => f.name.endsWith(".json"));

      const loaded: SavedChat[] = [];
      for (const file of chatFiles) {
        try {
          const content = await invoke<string>("read_file_disk", { path: file.path });
          const parsed = JSON.parse(content);
          const messages: AgentMessage[] = parsed.messages || [];
          const firstUser = messages.find((m) => m.role === "user");
          const preview = firstUser
            ? firstUser.content.replace(/@([^\s@]+)/g, "$1").slice(0, 80)
            : "(empty conversation)";
          loaded.push({
            path: file.path,
            name: file.name,
            savedAt: parsed.savedAt || "",
            preview,
            messageCount: messages.length,
          });
        } catch (e) {
          console.error(`Failed to read chat ${file.path}:`, e);
        }
      }
      // Sort newest first
      loaded.sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
      setChatHistory(loaded);
    } catch (e) {
      setChatHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, [rootPath]);

  useEffect(() => {
    loadChatHistory();
  }, [loadChatHistory]);

  const handleLoadChat = async (chat: SavedChat) => {
    if (isStreaming) return;
    try {
      const content = await invoke<string>("read_file_disk", { path: chat.path });
      const parsed = JSON.parse(content);
      const messages: AgentMessage[] = parsed.messages || [];
      setAgentMessages(tab.id, messages);
      setActiveChatPath(chat.path);
      savedChatPathRef.current = chat.path;
      setModifiedFiles([]);
    } catch (e) {
      console.error("Failed to load chat:", e);
    }
  };

  const handleNewChat = () => {
    if (isStreaming) return;
    clearAgentMessages(tab.id);
    setActiveChatPath(null);
    savedChatPathRef.current = null;
    setModifiedFiles([]);
  };

  const handleDeleteChat = async (e: React.MouseEvent, chat: SavedChat) => {
    e.stopPropagation();
    try {
      await invoke("delete_file_or_dir", { path: chat.path });
      setChatHistory((prev) => prev.filter((c) => c.path !== chat.path));
      if (activeChatPath === chat.path) {
        setActiveChatPath(null);
        savedChatPathRef.current = null;
      }
    } catch (err) {
      console.error("Failed to delete chat:", err);
    }
  };

  const refreshHistoryAfterSave = () => {
    if (rootPath) {
      setTimeout(() => loadChatHistory(), 200);
    }
  };

  const handleStopExecution = () => {
    if (agentSocketRef.current) {
      agentSocketRef.current.close();
    }
    isStreamingRef.current = false;
    setIsStreaming(false);
  };

  const handleSendMessage = (attachedFiles: { path: string; name: string; isDir?: boolean }[]) => {
    if (!message.trim() || isStreaming) return;

    const now = Date.now();
    const attachments = attachedFiles.map(a => ({ path: a.path, name: a.name }));

    const userMessage = {
      id: `msg_${now}`,
      role: "user" as const,
      content: message,
      timestamp: new Date().toISOString(),
      attachments,
    };

    const consoleMessageId = `msg_${now}_console`;
    const consoleMessage = {
      id: consoleMessageId,
      role: "console" as const,
      content: "",
      timestamp: new Date().toISOString(),
    };

    addAgentMessage(tab.id, userMessage);
    addAgentMessage(tab.id, consoleMessage);
    consoleMessageIdRef.current = consoleMessageId;
    consoleBufferRef.current = "";
    streamingResponseMessageIdRef.current = null;
    streamingResponseBufferRef.current = "";
    saveChatHistory();
    refreshHistoryAfterSave();

    const messageToSend = message;
    setMessage("");
    isStreamingRef.current = true;
    setIsStreaming(true);

    let socket: WebSocket;
    try {
      socket = new WebSocket("ws://localhost:4000");
      agentSocketRef.current = socket;
    } catch (err: any) {
      console.error("Failed to construct Agent WebSocket:", err);
      addAgentMessage(tab.id, {
        id: `msg_${Date.now()}`,
        role: "assistant" as const,
        content: `Connection failed: ${err.message || String(err)}`,
        timestamp: new Date().toISOString(),
      });
      isStreamingRef.current = false;
      setIsStreaming(false);
      notify(
        "Sidecar Connection Error",
        `Failed to create WebSocket connection to sidecar: ${err.message || String(err)}. Ensure the agent sidecar is running on port 4000.`,
        "error"
      );
      return;
    }

    socket.onopen = () => {
      const wsRootPath = useWorkspaceStore.getState().rootPath;
      const currentProviders = useWorkspaceStore.getState().customProviders;
      const currentActiveProviderId = useWorkspaceStore.getState().activeCustomProviderId;
      const prov = currentProviders.find((p) => p.id === currentActiveProviderId);
      const chatHistory = useWorkspaceStore.getState().agentChats[tab.id] || [];
      const currentSkills = useWorkspaceStore.getState().skills;
      const selectedSkill = selectedSkillId ? currentSkills.find((s: any) => s.id === selectedSkillId) : null;
      const skillData = selectedSkill ? {
        systemPrompt: selectedSkill.systemPrompt,
        enabledTools: selectedSkill.enabledTools,
        preferredModel: selectedSkill.preferredModel,
      } : null;

      // Resolve MCP servers declared in the active skill.
      const mcpServersMap = useWorkspaceStore.getState().mcpServers;
      const skillMcpNames: string[] = selectedSkill?.mcpServers || [];
      const mcpServers = skillMcpNames
        .map((name: string) => mcpServersMap[name])
        .filter((srv: any): srv is NonNullable<typeof srv> => !!srv);

      socket.send(JSON.stringify({
        type: "agent_chat",
        tabId: tab.id,
        message: messageToSend,
        model: selectedModel,
        workspaceRoot: wsRootPath,
        chatHistory: chatHistory
          .filter((m: any) => m.role === "user" || m.role === "assistant")
          .map((m: any) => ({ role: m.role, content: m.content })),
        customProvider:
          prov &&
          (prov.id !== "anthropic" && prov.id !== "openai" || !!prov.apiKey)
            ? prov
            : null,
        skill: skillData,
        mcpServers,
        lspSettings: { ...useWorkspaceStore.getState().lspSettings, enabled: false },
      }));
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "log" && msg.tabId === tab.id) {
          consoleBufferRef.current += msg.message + "\n";
          if (consoleMessageIdRef.current) {
            updateAgentMessage(tab.id, consoleMessageIdRef.current, consoleBufferRef.current);
          }
          saveChatHistory();
          return;
        }

        if (msg.type === "token" && msg.tabId === tab.id) {
          streamingResponseBufferRef.current += msg.content;
          if (!streamingResponseMessageIdRef.current) {
            const responseMessageId = `msg_${Date.now()}_stream`;
            streamingResponseMessageIdRef.current = responseMessageId;
            addAgentMessage(tab.id, {
              id: responseMessageId,
              role: "assistant" as const,
              content: streamingResponseBufferRef.current,
              timestamp: new Date().toISOString(),
            });
          } else {
            updateAgentMessage(tab.id, streamingResponseMessageIdRef.current, streamingResponseBufferRef.current);
          }
          return;
        }

        if (msg.type === "read_file") {
          invoke("read_file_disk", { path: msg.path }).then((content: unknown) => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: "read_file_response",
                requestId: msg.requestId,
                content: content as string
              }));
            }
          }).catch((err: any) => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: "read_file_response",
                requestId: msg.requestId,
                error: err.message || String(err)
              }));
            }
          });
          return;
        }

        if (msg.type === "write_file") {
          invoke("write_file_disk", { path: msg.path, content: msg.content }).then(() => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: "write_file_response",
                requestId: msg.requestId,
              }));
            }
          }).catch((err: any) => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: "write_file_response",
                requestId: msg.requestId,
                error: err.message || String(err)
              }));
            }
          });
          return;
        }

        if (msg.type === "agent_chat_complete" && msg.tabId === tab.id) {
          const files = msg.modifiedFiles || [];
          setModifiedFiles(files);

          files.forEach((filePath: string) => {
            const fileName = filePath.split("/").pop() || filePath;
            openTab({
              id: `file_${filePath.replace(/[^a-zA-Z0-9]/g, "_")}`,
              type: "file",
              title: fileName,
              key: filePath,
            });
          });

          if (files.length > 0 && rootPath) {
            invoke("get_directory_structure", { rootDir: rootPath }).then((tree: any) => {
              setFileTree(tree);
              loadGitStatus();
            });
          }

          const responseContent = msg.response || "Agent complete.";
          if (streamingResponseMessageIdRef.current) {
            updateAgentMessage(tab.id, streamingResponseMessageIdRef.current, responseContent);
          } else {
            addAgentMessage(tab.id, {
              id: `msg_${Date.now()}`,
              role: "assistant" as const,
              content: responseContent,
              timestamp: new Date().toISOString(),
            });
          }

          isStreamingRef.current = false;
          streamingResponseMessageIdRef.current = null;
          streamingResponseBufferRef.current = "";
          setIsStreaming(false);
          saveChatHistory();
          refreshHistoryAfterSave();
          return;
        }

        if (msg.type === "agent_chat_error" && msg.tabId === tab.id) {
          consoleBufferRef.current += `Error: ${msg.error}\n`;
          if (consoleMessageIdRef.current) {
            updateAgentMessage(tab.id, consoleMessageIdRef.current, consoleBufferRef.current);
          }
          addAgentMessage(tab.id, {
            id: `msg_${Date.now()}`,
            role: "assistant" as const,
            content: `Error: ${msg.error}`,
            timestamp: new Date().toISOString(),
          });
          isStreamingRef.current = false;
          setIsStreaming(false);
          socket.close();
          notify("Agent Error", `The agent encountered an error: ${msg.error}`, "error");
        }
      } catch (err: any) {
        console.error(`[AgentTab] Parse error:`, err);
        notify(
          "Communication Error",
          `Failed to process message from agent sidecar: ${err.message || String(err)}`,
          "error"
        );
      }
    };

    socket.onerror = () => {
      consoleBufferRef.current += "Connection to agent sidecar failed. Ensure sidecar is running on port 4000.\n";
      if (consoleMessageIdRef.current) {
        updateAgentMessage(tab.id, consoleMessageIdRef.current, consoleBufferRef.current);
      }
      addAgentMessage(tab.id, {
        id: `msg_${Date.now()}`,
        role: "assistant" as const,
        content: "Connection failed. Please ensure the agent sidecar is running on port 4000.",
        timestamp: new Date().toISOString(),
      });
      isStreamingRef.current = false;
      setIsStreaming(false);
      notify(
        "Sidecar Connection Failed",
        "Connection to agent sidecar closed unexpectedly. Ensure agent sidecar is running on port 4000.",
        "error"
      );
    };

    socket.onclose = (event) => {
      console.log(`[AgentTab] WebSocket closed (code: ${event.code})`);

      if (isStreamingRef.current) {
        addAgentMessage(tab.id, {
          id: `msg_${Date.now()}`,
          role: "assistant" as const,
          content: "Connection closed unexpectedly.",
          timestamp: new Date().toISOString(),
        });
        isStreamingRef.current = false;
        setIsStreaming(false);
        notify(
          "Connection Lost",
          `The sidecar connection was closed abnormally (code: ${event.code}).`,
          "error"
        );
      }
      agentSocketRef.current = null;
    };
  };

  const handleOpenModifiedFile = (filePath: string) => {
    const fileName = filePath.split("/").pop() || filePath;
    openTab({
      id: `file_${filePath.replace(/[^a-zA-Z0-9]/g, "_")}`,
      type: "file",
      title: fileName,
      key: filePath,
    });
  };

  const handlePermissionResolve = (approved: boolean) => {
    if (!pendingPermission || !agentSocketRef.current) return;

    agentSocketRef.current.send(JSON.stringify({
      type: "permission_response",
      requestId: pendingPermission.id,
      approved: approved,
    }));

    setPendingPermission(null);
  };

  const saveChatHistory = async () => {
    if (chatSaveTimeoutRef.current) {
      clearTimeout(chatSaveTimeoutRef.current);
    }
    chatSaveTimeoutRef.current = setTimeout(async () => {
      try {
        if (!rootPath) return;
        const chats = useWorkspaceStore.getState().agentChats[tab.id] || [];
        const payload = JSON.stringify({ tabId: tab.id, messages: chats, savedAt: new Date().toISOString() });

        if (!savedChatPathRef.current) {
          const result = await invoke("save_chat_history", {
            rootDir: rootPath,
            chatId: `agent_${tab.id}`,
            content: payload,
          });
          savedChatPathRef.current = result as string;
        } else {
          await invoke("write_file_disk", { path: savedChatPathRef.current, content: payload });
        }
      } catch (e) {
        console.error("Failed to save chat history:", e);
      }
    }, 300);
  };

  const renderPermissionModal = () => {
    if (!pendingPermission) return null;

    return (
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl w-full max-w-md shadow-2xl overflow-hidden">
          <div className="px-4 py-3 bg-[var(--bg-header)] border-b border-[var(--border-color)] flex items-center space-x-2">
            <Shield size={16} className="text-amber-400" />
            <span className="text-[var(--text-light)] text-sm font-semibold">Permission Required</span>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-[var(--text-normal)]">
              The agent wants to execute the following action:
            </p>
            <div className="bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-3 font-mono text-xs">
              <div className="text-[var(--accent-color)] font-semibold mb-1">
                Tool: {pendingPermission.toolCall?.name}
              </div>
              <div className="text-[var(--text-muted)]">
                {JSON.stringify(pendingPermission.toolCall?.arguments || {}, null, 2)}
              </div>
            </div>
            <p className="text-[10px] text-[var(--text-muted)]">
              {pendingPermission.description || "Do you want to allow this action?"}
            </p>
          </div>
          <div className="px-4 py-3 bg-[var(--bg-header)] border-t border-[var(--border-color)] flex items-center justify-end space-x-2">
            <button
              onClick={() => handlePermissionResolve(false)}
              className="px-3 py-1.5 border border-[var(--border-color)] hover:bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:text-[var(--text-light)] rounded-lg text-xs font-semibold cursor-pointer transition-colors"
            >
              Deny
            </button>
            <button
              onClick={() => handlePermissionResolve(true)}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors"
            >
              Allow
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full h-full flex bg-[var(--bg-app)] text-[var(--text-normal)] font-mono relative terminal-theme-tab">
      {/* Chat History Sidebar */}
      {showHistory && (
        <div className="w-64 flex-shrink-0 border-r border-[var(--border-color)] bg-[var(--bg-sidebar)]/40 flex flex-col h-full overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] flex-shrink-0">
            <div className="flex items-center space-x-1.5 text-[var(--text-muted)]">
              <History size={13} />
              <span className="text-[10px] font-mono uppercase tracking-wider font-bold">Chats</span>
              <span className="text-[9px] font-mono text-[var(--text-muted)]">({chatHistory.length})</span>
            </div>
            <div className="flex items-center space-x-1">
              <button
                onClick={loadChatHistory}
                disabled={loadingHistory}
                className="p-1 rounded hover:bg-[var(--accent-bg)] text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer border-none bg-transparent"
                title="Refresh"
              >
                <RefreshCw size={11} className={loadingHistory ? "animate-spin" : ""} />
              </button>
              <button
                onClick={handleNewChat}
                disabled={isStreaming}
                className="p-1 rounded hover:bg-[var(--accent-bg)] text-[var(--text-muted)] hover:text-[var(--text-color)] transition-colors cursor-pointer disabled:opacity-40 border-none bg-transparent"
                title="New chat"
              >
                <Plus size={12} />
              </button>
              <button
                onClick={() => setShowHistory(false)}
                className="p-1 rounded hover:bg-[var(--accent-bg)] text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer border-none bg-transparent"
                title="Hide history"
              >
                <PanelLeftClose size={12} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {chatHistory.length === 0 ? (
              <div className="px-3 py-6 text-center text-[10px] font-mono text-[var(--text-muted)] leading-relaxed">
                {loadingHistory ? "Loading..." : "No saved chats yet.\nStart a conversation to see it here."}
              </div>
            ) : (
              chatHistory.map((chat) => {
                const isActive = activeChatPath === chat.path;
                const date = chat.savedAt ? new Date(chat.savedAt) : null;
                const dateLabel = date
                  ? date.toLocaleDateString() === new Date().toLocaleDateString()
                    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : date.toLocaleDateString([], { month: "short", day: "numeric" })
                  : "";
                return (
                  <div
                    key={chat.path}
                    onClick={() => handleLoadChat(chat)}
                    className={`group mx-1.5 my-0.5 px-2.5 py-2 rounded-lg cursor-pointer transition-all border ${
                      isActive
                        ? "border-[var(--accent-color)] bg-[var(--accent-bg)]/30"
                        : "border-transparent hover:bg-[var(--bg-app)]/50 hover:border-[var(--border-color)]"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[9px] font-mono text-[var(--text-muted)]">{dateLabel}</span>
                      <div className="flex items-center space-x-1">
                        <span className="text-[8px] font-mono text-[var(--text-muted)]">{chat.messageCount} msgs</span>
                        <button
                          onClick={(e) => handleDeleteChat(e, chat)}
                          className="opacity-0 group-hover:opacity-100 text-rose-400/60 hover:text-rose-400 transition-all p-0.5 border-none bg-transparent cursor-pointer"
                          title="Delete chat"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    </div>
                    <p className={`text-[11px] font-mono leading-snug line-clamp-2 ${isActive ? "text-[var(--text-light)]" : "text-[var(--text-normal)]"}`}>
                      {chat.preview}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Main chat column */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/50 flex-shrink-0">
          <div className="flex items-center space-x-3">
            {!showHistory && (
              <button
                onClick={() => setShowHistory(true)}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--accent-bg)] transition-colors cursor-pointer border-none bg-transparent"
                title="Show chat history"
              >
                <PanelLeft size={16} />
              </button>
            )}
            <CustomSelect
              value={selectedModel}
              onChange={setSelectedModel}
              options={modelOptions}
              placeholder="Select model"
              className="w-64"
            />
            <CustomSelect
              value={selectedSkillId || ""}
              onChange={(val) => {
                setSelectedSkillId(val || null);
                setActiveSkill(val || null);
              }}
              options={[{ id: "", name: "No skill" }, ...skills.map(s => ({ id: s.id, name: s.name }))]}
              placeholder="Select skill"
              className="w-48"
            />
            {modifiedFiles.length > 0 && (
              <span className="flex items-center space-x-1.5 px-2.5 py-1 bg-emerald-500/15 border border-emerald-500/30 rounded-lg text-[10px] font-mono text-emerald-300">
                <CheckCircle2 size={11} />
                <span>{modifiedFiles.length} file{modifiedFiles.length !== 1 ? "s" : ""} modified</span>
              </span>
            )}
          </div>
          <div className="flex items-center space-x-1.5 text-[var(--text-muted)] font-mono text-[10px]">
            {isStreaming && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] animate-ping" />}
            <span>{isStreaming ? "Thinking" : "Ready"}</span>
          </div>
        </div>

        {/* Modified files bar */}
        {modifiedFiles.length > 0 && (
          <div className="flex items-center space-x-2 px-4 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/30 flex-shrink-0 overflow-x-auto">
            <FolderGit2 size={12} className="text-emerald-400 flex-shrink-0" />
            <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider flex-shrink-0">Changes:</span>
            {modifiedFiles.map((filePath) => {
              const fileName = filePath.split("/").pop() || filePath;
              return (
                <button
                  key={filePath}
                  onClick={() => handleOpenModifiedFile(filePath)}
                  className="flex items-center space-x-1 px-2 py-0.5 bg-[var(--bg-app)] border border-[var(--border-color)] hover:border-emerald-500/50 rounded text-[10px] font-mono text-[var(--text-light)] cursor-pointer transition-colors flex-shrink-0"
                >
                  <FileText size={10} className="text-emerald-400" />
                  <span>{fileName}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Chat List and input block */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden max-w-6xl mx-auto w-full">
          <Chat
            messages={agentChats}
            isStreaming={isStreaming}
            streamingMessageId={consoleMessageIdRef.current}
          />
          
          <div className="p-4 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/10 flex-shrink-0 w-full mb-2">
            <ChatInput
              value={message}
              onChange={setMessage}
              onSend={handleSendMessage}
              disabled={isStreaming}
              isStreaming={isStreaming}
              onStop={handleStopExecution}
              placeholder="Message agent... (type @ to reference files)"
            />
          </div>
        </div>

        {/* Permission modal */}
        {renderPermissionModal()}
      </div>
    </div>
  );
};
