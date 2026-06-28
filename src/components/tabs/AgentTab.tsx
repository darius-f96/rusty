import React, { useState, useEffect, useRef } from "react";
import { Send, MessageSquare, Shield, FileText, Loader2, ChevronRight, Terminal, Bot, CheckCircle2, FolderGit2 } from "lucide-react";
import { useWorkspaceStore } from "../../store";
import { CustomSelect } from "../CustomSelect";
import { searchService } from "../../services/searchService";
import { processResponse } from "../../services/responseProcessingService";
import { invoke } from "@tauri-apps/api/core";

interface AgentTabProps {
  tab: any;
  groupId: string;
}

interface FileReference {
  path: string;
  name: string;
}

export const AgentTab: React.FC<AgentTabProps> = ({ tab, groupId }) => {
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const setActiveModel = useWorkspaceStore((state) => state.setActiveModel);
  const agentChats = useWorkspaceStore((state) => state.agentChats[tab.id] || []);
  const addAgentMessage = useWorkspaceStore((state) => state.addAgentMessage);
  const updateAgentMessage = useWorkspaceStore((state) => state.updateAgentMessage);
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
  const [fileReferences, setFileReferences] = useState<FileReference[]>([]);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [pendingPermission, setPendingPermission] = useState<any>(null);
  const [collapsedConsoles, setCollapsedConsoles] = useState<Record<string, boolean>>({});
  const [modifiedFiles, setModifiedFiles] = useState<string[]>([]);
  const [consoleUpdateCount, setConsoleUpdateCount] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const consoleContentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const agentSocketRef = useRef<WebSocket | null>(null);
  const autocompleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consoleMessageIdRef = useRef<string | null>(null);
  const consoleBufferRef = useRef<string>("");
  const isAtBottomRef = useRef(true);
  const suppressScrollRef = useRef(false);
  const savedChatPathRef = useRef<string | null>(null);
  const chatSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editorGroups = useWorkspaceStore((state) => state.editorGroups);
  const targetGroup = editorGroups.find((g) => g.id === groupId);
  const isActive = targetGroup ? targetGroup.activeTabId === tab.id : false;

  const modelOptions = customProviders.flatMap((p) => p.models).map((m) => ({
    id: m.id,
    name: `${m.name} (${m.id})`,
  }));

  useEffect(() => {
    if (isActive && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [agentChats, isActive]);

  const scrollToBottom = () => {
    if (messagesEndRef.current && isAtBottomRef.current && !suppressScrollRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
    if (consoleContentRef.current && consoleMessageIdRef.current) {
      consoleContentRef.current.scrollTop = consoleContentRef.current.scrollHeight;
    }
  };

  const handleScroll = () => {
    if (!chatContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    isAtBottomRef.current = distanceFromBottom < 100;
  };

  useEffect(() => {
    if (isActive && isStreaming) {
      scrollToBottom();
    }
  }, [consoleUpdateCount, isActive, isStreaming]);

  useEffect(() => {
    if (isActive && !isStreaming) {
      scrollToBottom();
    }
  }, [agentChats.length, isActive, isStreaming]);

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
      if (autocompleteTimeoutRef.current) {
        clearTimeout(autocompleteTimeoutRef.current);
      }
    };
  }, []);

  const handleSendMessage = () => {
    if (!message.trim() || isStreaming) return;

    const now = Date.now();
    const attachments = extractAttachments(message);

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
    saveChatHistory(true);

    const messageToSend = message;
    setMessage("");
    setIsStreaming(true);
    setShowFilePicker(false);
    setFileReferences([]);
    setSelectedFileIndex(0);

    const socket = new WebSocket("ws://localhost:4000");
    agentSocketRef.current = socket;

    socket.onopen = () => {
      console.log(`[AgentTab] WebSocket connected!`);

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
      }));
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "log" && msg.tabId === tab.id) {
          consoleBufferRef.current += msg.message + "\n";
          if (consoleMessageIdRef.current) {
            updateAgentMessage(tab.id, consoleMessageIdRef.current, consoleBufferRef.current);
            setConsoleUpdateCount(c => c + 1);
          }
          saveChatHistory();
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

          addAgentMessage(tab.id, {
            id: `msg_${Date.now()}`,
            role: "assistant" as const,
            content: msg.response || "Agent complete.",
            timestamp: new Date().toISOString(),
          });
          setIsStreaming(false);
          socket.close();
          saveChatHistory(true);
        }

        if (msg.type === "permission_request" && msg.tabId === tab.id) {
          setPendingPermission({
            id: msg.requestId,
            toolCall: msg.toolCall,
            description: msg.description,
          });
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
          setIsStreaming(false);
          socket.close();
        }
      } catch (err: any) {
        console.error(`[AgentTab] Parse error:`, err);
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
      setIsStreaming(false);
    };

    socket.onclose = (event) => {
      console.log(`[AgentTab] WebSocket closed (code: ${event.code})`);
      if (isStreaming) {
        addAgentMessage(tab.id, {
          id: `msg_${Date.now()}`,
          role: "assistant" as const,
          content: "Connection closed unexpectedly.",
          timestamp: new Date().toISOString(),
        });
        setIsStreaming(false);
      }
      agentSocketRef.current = null;
    };
  };

  const extractAttachments = (text: string): { path: string; name: string }[] => {
    const matches = [...text.matchAll(/@([^\s@]+)/g)];
    return matches.map((m) => {
      const fullPath = m[1];
      const name = fullPath.split("/").pop() || fullPath;
      return { path: fullPath, name };
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showFilePicker && fileReferences.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedFileIndex((prev) => (prev + 1) % fileReferences.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedFileIndex((prev) => (prev - 1 + fileReferences.length) % fileReferences.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        insertFileReference(fileReferences[selectedFileIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowFilePicker(false);
        setFileReferences([]);
        setSelectedFileIndex(0);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        insertFileReference(fileReferences[selectedFileIndex]);
        return;
      }
    } else {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setMessage(value);

    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf("@");

    if (atIndex !== -1) {
      const searchTerm = textBeforeCursor.substring(atIndex + 1);
      const hasSpace = searchTerm.includes(" ") || searchTerm.includes("\n");

      if (!hasSpace && searchTerm.length >= 1) {
        setShowFilePicker(true);
        setSelectedFileIndex(0);
        if (autocompleteTimeoutRef.current) {
          clearTimeout(autocompleteTimeoutRef.current);
        }
        autocompleteTimeoutRef.current = setTimeout(() => {
          searchFiles(searchTerm);
        }, 150);
      } else {
        setShowFilePicker(false);
        setFileReferences([]);
        setSelectedFileIndex(0);
      }
    } else {
      setShowFilePicker(false);
      setFileReferences([]);
      setSelectedFileIndex(0);
    }
  };

  const searchFiles = async (query: string) => {
    if (!rootPath || query.length < 1) {
      setFileReferences([]);
      return;
    }

    try {
      const results = await searchService.searchProject({
        rootDir: rootPath,
        query: query,
        matchCase: false,
        wholeWord: false,
        isRegex: false,
      });

      const fileMatches = results
        .filter((r) => !r.is_content_match)
        .map((r) => {
          const relPath = rootPath && r.path.startsWith(rootPath) ? r.path.substring(rootPath.length + 1) : r.path;
          return {
            path: relPath,
            name: r.name,
          };
        })
        .slice(0, 10);

      setFileReferences(fileMatches);
      setSelectedFileIndex(0);
    } catch (err) {
      console.error("Failed to search files:", err);
      setFileReferences([]);
    }
  };

  const insertFileReference = (file: FileReference) => {
    const input = inputRef.current;
    if (!input) return;

    const cursorPos = input.selectionStart;
    const textBeforeCursor = message.substring(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf("@");

    const newMessage = message.substring(0, atIndex) + `@${file.path} ` + message.substring(cursorPos);
    setMessage(newMessage);
    setShowFilePicker(false);
    setFileReferences([]);
    setSelectedFileIndex(0);
    input.focus();
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

  const toggleConsoleCollapse = (id: string) => {
    setCollapsedConsoles((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const saveChatHistory = async (forceNew = false) => {
    if (chatSaveTimeoutRef.current) {
      clearTimeout(chatSaveTimeoutRef.current);
    }
    chatSaveTimeoutRef.current = setTimeout(async () => {
      try {
        if (!rootPath) return;
        const chats = useWorkspaceStore.getState().agentChats[tab.id] || [];
        const payload = JSON.stringify({ tabId: tab.id, messages: chats, savedAt: new Date().toISOString() });

        if (forceNew || !savedChatPathRef.current) {
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

  const renderMessageContent = (content: string) => {
    const parts = content.split(/(@[^\s@]+)/g);
    return parts.map((part, idx) => {
      if (part.startsWith("@") && part.length > 1) {
        const fileName = part.substring(1).split("/").pop() || part.substring(1);
        return (
          <span
            key={idx}
            className="inline-flex items-center space-x-1 px-1.5 py-0.5 mx-0.5 bg-violet-500/20 border border-violet-500/30 rounded text-violet-300 text-[11px] font-mono align-middle"
          >
            <FileText size={10} className="flex-shrink-0" />
            <span>{fileName}</span>
          </span>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  const renderMessage = (msg: any) => {
    if (msg.role === "console") {
      const isCollapsed = collapsedConsoles[msg.id];
      const isThisStreaming = isStreaming && consoleMessageIdRef.current === msg.id;
      return (
        <div key={msg.id} className="mb-3">
          <button
            onClick={() => toggleConsoleCollapse(msg.id)}
            className="flex items-center space-x-2 text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors w-full text-left py-1"
          >
            <ChevronRight
              size={12}
              className={`transition-transform ${isCollapsed ? "" : "rotate-90"}`}
            />
            <Terminal size={11} className="text-[var(--accent-color)]" />
            <span className="uppercase tracking-wider">
              {isThisStreaming ? "Agent thinking..." : "Console output"}
            </span>
            {isThisStreaming && <Loader2 size={10} className="animate-spin text-[var(--accent-color)]" />}
          </button>
          {!isCollapsed && (
            <div
              ref={(el) => {
                if (isThisStreaming && el) {
                  consoleContentRef.current = el;
                }
              }}
              className="ml-4 mt-1 bg-black/40 border border-[var(--border-color)] rounded-lg p-3 max-h-56 overflow-y-auto"
            >
              <pre className="whitespace-pre-wrap text-[11px] font-mono text-zinc-400 leading-relaxed">
                {msg.content || "// No output yet..."}
              </pre>
            </div>
          )}
        </div>
      );
    }

    if (msg.role === "user") {
      return (
        <div key={msg.id} className="mb-4">
          <div className="flex items-center space-x-2 mb-1.5">
            <div className="w-5 h-5 rounded-full bg-[var(--accent-color)] flex items-center justify-center flex-shrink-0">
              <span className="text-[9px] font-bold text-white">U</span>
            </div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider">You</span>
          </div>
          <div className="ml-7 text-xs text-[var(--text-light)] leading-relaxed whitespace-pre-wrap">
            {renderMessageContent(msg.content)}
          </div>
        </div>
      );
    }

    if (msg.role === "assistant") {
      return (
        <div key={msg.id} className="mb-4">
          <div className="flex items-center space-x-2 mb-1.5">
            <div className="w-5 h-5 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0">
              <Bot size={11} className="text-white" />
            </div>
            <span className="text-[10px] font-mono text-violet-400 uppercase tracking-wider">Agent</span>
          </div>
          <div className="ml-7 text-xs text-[var(--text-normal)] leading-relaxed">
            <div className="whitespace-pre-wrap">{processResponse(msg.content)}</div>
          </div>
        </div>
      );
    }

    return null;
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
    <div className="w-full h-full flex flex-col bg-[var(--bg-app)] text-[var(--text-normal)] font-sans relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/50 flex-shrink-0">
        <div className="flex items-center space-x-3">
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
        <div className="flex items-center space-x-1 text-[var(--text-muted)]">
          {isStreaming && <Loader2 size={14} className="animate-spin text-[var(--accent-color)]" />}
          <span className="text-[10px] font-mono">
            {isStreaming ? "Working..." : "Ready"}
          </span>
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

      {/* Chat area - centered, slim */}
      <div
        ref={chatContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden"
      >
        <div className="max-w-3xl mx-auto px-6 py-6">
          {agentChats.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-[var(--text-muted)] py-24">
              <div className="w-16 h-16 rounded-full bg-[var(--bg-sidebar)] flex items-center justify-center mb-4">
                <MessageSquare size={24} className="text-violet-400/50" />
              </div>
              <p className="text-sm font-semibold mb-1">Agent Mode</p>
              <p className="text-xs max-w-[300px]">
                Ask the agent to analyze, modify, or implement code. Type @ to reference files.
              </p>
            </div>
          ) : (
            agentChats.map((msg: any) => renderMessage(msg))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area - centered, slim */}
      <div className="border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 flex-shrink-0">
        <div className="max-w-3xl mx-auto px-6 py-4 relative">
          <div className="relative">
            <textarea
              ref={inputRef}
              value={message}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Message agent... (type @ to reference files)"
              className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-3 pr-12 text-xs font-sans text-[var(--text-light)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--border-active)] resize-none"
              rows={3}
              disabled={isStreaming}
            />
            <button
              onClick={handleSendMessage}
              disabled={!message.trim() || isStreaming}
              className="absolute right-2 bottom-2 w-8 h-8 bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 disabled:bg-[var(--bg-sidebar)] disabled:text-[var(--text-muted)] text-white rounded-lg flex items-center justify-center transition-colors cursor-pointer"
            >
              {isStreaming ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
            </button>
          </div>

          {/* File autocomplete dropdown */}
          {showFilePicker && fileReferences.length > 0 && (
            <div className="absolute bottom-full left-6 right-6 mb-1 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-xl max-h-48 overflow-y-auto z-20">
              {fileReferences.map((file, idx) => (
                <button
                  key={file.path}
                  onClick={() => insertFileReference(file)}
                  onMouseEnter={() => setSelectedFileIndex(idx)}
                  className={`w-full text-left px-3 py-2 text-[var(--text-normal)] text-xs font-mono flex items-center space-x-2 border-b border-[var(--border-color)] last:border-b-0 transition-colors ${
                    idx === selectedFileIndex ? "bg-[var(--accent-bg)]" : "hover:bg-[var(--accent-bg)]"
                  }`}
                >
                  <FileText size={12} className="text-emerald-400 flex-shrink-0" />
                  <span className="font-semibold text-[var(--text-light)]">{file.name}</span>
                  <span className="text-[var(--text-muted)] truncate">{file.path}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Permission modal */}
      {renderPermissionModal()}
    </div>
  );
};
