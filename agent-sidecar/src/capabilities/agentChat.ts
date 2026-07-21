/**
 * Agent Chat Capability
 *
 * Implements the "agent_chat" operation for the Agent Tab. It runs a multi-round
 * LLM tool-calling loop with read/write/list/search tools, streaming logs back to
 * the frontend, and returns the final response via "agent_chat_complete".
 */

import { WebSocket } from "ws";
import path from "path";
import { safeSend, getNextId, registerPendingRequest } from "../services/websocket";
import { createListFilesTool, createSearchCodebaseTool } from "../services/tools";
import { callLlmWithToolsPiStreaming } from "../services/llmRuntime";
import { createLspTools } from "../services/lspTools";
import { createMcpTools, McpServerConfig } from "../services/mcpClient";
import { createWebSearchTool } from "../services/webSearchTool";
import { DeferredUserQuestion, SubagentUpdate, hasActiveBackgroundSubagents, runPiAgentChat } from "../services/piAgentChat";
import { createRunCommandTool } from "./tools/runCommandTool";
import {
  AGENT_TAB_HARNESS_POLICY,
  GLOBAL_CHAT_TASK_DEPENDENCY_POLICY,
  agentDelegationPolicy,
  resolveAgentChatToolNames,
} from "./agentChatPolicy";

type AgentTool = {
  name: string;
  description: string;
  inputSchema?: any;
  execute: (args: any) => Promise<any>;
};

export async function agentChat(ws: WebSocket, data: any): Promise<void> {
  const { tabId, message, model, workspaceRoot, chatHistory, customProvider, skill, lspSettings, mcpServers, planOnly, vfsOnly } = data;
  (ws as any).__activeAgentTabId = tabId;
  console.log(`WebSocket [Server] agent_chat starting`, { tabId, workspaceRoot, model, hasSkill: !!skill, lspEnabled: lspSettings?.enabled, mcpCount: mcpServers?.length || 0 });

  const modifiedFiles = new Set<string>();
  const mcpDisposers: Array<() => void> = [];
  let deferredQuestion: DeferredUserQuestion | undefined;
  let activityHeartbeat: NodeJS.Timeout | undefined;
  let lastActivityAt = Date.now();

  const sendLog = (logMessage: string) => {
    lastActivityAt = Date.now();
    console.log(`[Agent:${tabId}] ${logMessage}`);
    safeSend(ws, { type: "log", tabId, message: logMessage });
  };

  const sendSubagentUpdate = (subagent: SubagentUpdate) => {
    safeSend(ws, { type: "subagent_update", tabId, subagent });
  };

  try {
    const readVfsTool = {
      name: "read_file",
      description: "Read a file's content from the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "The file path to read" }
        },
        required: ["path"]
      },
      execute: async ({ path: filePath }: { path: string }) => {
        console.log(`WebSocket [Server] agent_chat read_file tool: ${filePath}`);
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
        sendLog(`Reading file: ${filePath}`);
        return new Promise((resolve, reject) => {
          const requestId = getNextId();
          registerPendingRequest(requestId, ws, (res) => {
            if (res.error) {
              const errorMsg = String(res.error).toLowerCase();
              if (errorMsg.includes("not found") || errorMsg.includes("no such file") || errorMsg.includes("exist")) {
                resolve(planOnly
                  ? "[File does not exist.]"
                  : "[File does not exist yet. You can create it by calling write_file with content.]");
              } else {
                reject(new Error(res.error));
              }
            } else {
              resolve(res.content);
            }
          });
          safeSend(ws, { type: "read_file", requestId, path: resolvedPath });
        });
      }
    };

    const writeVfsTool = {
      name: "write_file",
      description: "Write or edit a file's content in the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "The file path to write/edit" },
          content: { type: "string", description: "The full content of the file" }
        },
        required: ["path", "content"]
      },
      execute: async ({ path: filePath, content }: { path: string; content: string }) => {
        console.log(`WebSocket [Server] agent_chat write_file tool: ${filePath} (${content.length} chars)`);
        sendLog(`Modifying file: ${filePath}`);
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
        modifiedFiles.add(resolvedPath);
        return new Promise((resolve, reject) => {
          const requestId = getNextId();
          registerPendingRequest(requestId, ws, (res) => {
            if (res.error) {
              reject(new Error(res.error));
            } else {
              resolve(`File successfully written to: ${resolvedPath}`);
            }
          });
          safeSend(ws, { type: "write_file", requestId, path: resolvedPath, content });
        });
      }
    };

    const writePlanTool = {
      name: "write_plan",
      description: "Save a Markdown plan in the plans folder at the project root. Use this only when the user explicitly asks to save, write, or store the plan as a file.",
      inputSchema: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "A Markdown filename such as authentication-refactor.md. Do not include a directory."
          },
          content: { type: "string", description: "The complete Markdown plan" }
        },
        required: ["filename", "content"]
      },
      execute: async ({ filename, content }: { filename: string; content: string }) => {
        const normalizedFilename = filename.endsWith(".md") ? filename : `${filename}.md`;
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}\.md$/.test(normalizedFilename)) {
          throw new Error("Plan filename must use only letters, numbers, hyphens, or underscores and end in .md.");
        }
        sendLog(`Saving plan: plans/${normalizedFilename}`);
        return new Promise((resolve, reject) => {
          const requestId = getNextId();
          registerPendingRequest(requestId, ws, (res) => {
            if (res.error) {
              reject(new Error(res.error));
            } else {
              resolve(`Plan saved to: ${res.path || path.join(workspaceRoot, "plans", normalizedFilename)}`);
            }
          });
          safeSend(ws, {
            type: "write_plan",
            requestId,
            filename: normalizedFilename,
            content
          });
        });
      }
    };

    const lspTools = createLspTools(workspaceRoot, lspSettings, sendLog);
    const progressTool = {
      name: "report_progress",
      description: "Publish a concise, user-visible reasoning summary and the next intended action to the Agent Activity panel.",
      inputSchema: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Brief evidence-based summary of what you know and why the next step is useful." },
          nextAction: { type: "string", description: "The next action you intend to take." }
        },
        required: ["summary", "nextAction"]
      },
      execute: async ({ summary, nextAction }: { summary: string; nextAction: string }) => {
        sendLog(`Reasoning summary: ${summary}\nNext: ${nextAction}`);
        return "Progress update shown to the user.";
      }
    };

    const requestUserQuestion = (request: DeferredUserQuestion) => {
      const requestId = `agent_question_${getNextId()}`;
      sendLog(`Awaiting user input: ${request.question}`);
      safeSend(ws, { type: "agent_question", tabId, requestId, ...request });
      return new Promise<string>((resolve, reject) => {
        registerPendingRequest(requestId, ws, (response) => {
          if (response?.error) {
            const error = String(response.error);
            sendLog(`User question was not answered: ${error}`);
            reject(new Error(error));
            return;
          }
          const answer = String(response?.answer || "").trim();
          sendLog(`User answered: ${answer || "(no answer)"}`);
          resolve(answer || "The user did not provide an answer.");
        }, 10 * 60_000);
      });
    };

    const askUserQuestionTool = {
      name: "ask_user_question",
      description: "Ask the user a focused question when a product or implementation choice blocks progress. Offer 2-4 concrete suggestions whenever possible.",
      inputSchema: {
        type: "object",
        properties: {
          question: { type: "string", description: "The concise question to show the user." },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "Short selectable answer." },
                description: { type: "string", description: "Optional trade-off or explanation." }
              },
              required: ["label"]
            },
            description: "Optional 2-4 suggested answers."
          }
        },
        required: ["question"]
      },
      execute: async ({ question, options = [] }: { question: string; options?: Array<{ label: string; description?: string }> }) => {
        const normalizedQuestion: DeferredUserQuestion = {
          question,
          options: Array.isArray(options) ? options.filter((option) => option?.label?.trim()).slice(0, 4) : [],
        };
        if (hasActiveBackgroundSubagents(tabId)) {
          deferredQuestion = normalizedQuestion;
          sendLog("Deferred user question until delegated results are aggregated.");
          return "Question deferred. Continue waiting for all subagent results; it will be shown after aggregation.";
        }
        return requestUserQuestion(normalizedQuestion);
      }
    };

    const listFilesTool = createListFilesTool(workspaceRoot);
    const searchCodebaseTool = createSearchCodebaseTool(workspaceRoot);
    const webSearchTool = createWebSearchTool(sendLog);
    const allTools: AgentTool[] = [
      readVfsTool,
      writeVfsTool,
      writePlanTool,
      listFilesTool,
      searchCodebaseTool,
      webSearchTool,
      createRunCommandTool({ ws, sessionId: tabId, workspaceRoot, sendLog }),
      ...lspTools
    ];

    const requestedToolNames = skill?.enabledTools || [
      "read_file",
      "write_file",
      "list_files",
      "search_codebase",
      "web_search",
      "run_command",
      ...(lspSettings?.enabled ? ["lsp_get_definition", "lsp_get_references", "lsp_get_diagnostics"] : [])
    ];
    const enabledToolNames = resolveAgentChatToolNames(requestedToolNames, { planOnly, vfsOnly });
    const tools: AgentTool[] = allTools.filter((t) => enabledToolNames.includes(t.name));
    // Observability is always available, including when a restrictive skill is selected.
    tools.push(progressTool);
    tools.push(askUserQuestionTool);

    const providerUsesManagedRuntime = customProvider?.transport === "github-copilot-sdk"
      || customProvider?.id === "github-copilot"
      || customProvider?.transport === "openai-codex-app-server"
      || customProvider?.id === "openai-codex"
      || customProvider?.transport === "anthropic-claude-agent-sdk"
      || customProvider?.id === "anthropic-claude-code";
    const modelReference = model || customProvider?.models?.find((item: any) => item.supported !== false)?.id || "";
    if (!modelReference) throw new Error("No model is selected. Configure a provider and model in LLM Setup.");

    if (!vfsOnly && providerUsesManagedRuntime) {
      const delegateTaskTool: AgentTool = {
        name: "delegate_task",
        description: "Delegate one bounded, read-only codebase investigation or review to an independent subagent. Call this tool two or three times in the same turn when subtasks are independent. The tool returns the subagent's findings; the parent agent remains responsible for all edits.",
        inputSchema: {
          type: "object",
          properties: {
            description: { type: "string", description: "A short 3-8 word label for the delegated task." },
            prompt: { type: "string", description: "A precise read-only investigation with a concrete findings deliverable." },
          },
          required: ["description", "prompt"],
        },
        execute: async ({ description, prompt }: { description: string; prompt: string }) => {
          const normalizedDescription = String(description || "Codebase investigation").trim().slice(0, 120);
          const normalizedPrompt = String(prompt || "").trim();
          if (!normalizedPrompt) throw new Error("A delegated task requires a concrete prompt.");

          const id = `delegated-${getNextId()}`;
          const startedAt = Date.now();
          let toolUses = 0;
          let sawText = false;
          const update = (partial: Partial<SubagentUpdate>) => sendSubagentUpdate({
            id,
            displayName: "Investigator",
            description: normalizedDescription,
            subagentType: "read-only",
            status: "running",
            updatedAt: new Date().toISOString(),
            startedAt: new Date(startedAt).toISOString(),
            toolUses,
            ...partial,
          });

          update({ activity: "Starting delegated investigation.", appendLog: "Subagent dispatched." });
          sendLog(`Delegated subagent: ${normalizedDescription}.`);

          const wrapTool = (tool: AgentTool): AgentTool => ({
            ...tool,
            execute: async (args: any) => {
              toolUses++;
              const target = typeof args?.path === "string"
                ? args.path
                : typeof args?.pattern === "string"
                  ? args.pattern
                  : "workspace";
              const activity = `${tool.name.replace(/_/g, " ")}: ${String(target).slice(0, 140)}`;
              update({ activity, appendLog: activity, toolUses });
              return tool.execute(args);
            },
          });

          try {
            const result = await callLlmWithToolsPiStreaming({
              modelReference,
              customProvider,
              systemPrompt: `You are a read-only Axiom subagent. Investigate only the assigned task using the provided harness tools.
- Do not create, edit, move, or delete files.
- Do not run commands and do not delegate further.
- Return a concise findings memo with relevant file paths, concrete evidence, risks, and a clear recommendation for the parent agent.
- Stop as soon as the requested evidence is sufficient.`,
              userMessage: normalizedPrompt,
              tools: [readVfsTool, listFilesTool, searchCodebaseTool].map(wrapTool),
              sendLog: (subagentLog) => {
                const compact = subagentLog.replace(/\s+/g, " ").trim().slice(0, 220);
                if (!compact) return;
                update({ activity: compact, appendLog: compact, toolUses });
              },
              sendToken: () => {
                if (sawText) return;
                sawText = true;
                update({ activity: "Writing the findings memo.", appendLog: "Subagent began reporting findings." });
              },
              maxRounds: 8,
              cwd: workspaceRoot,
              shouldAbort: () => ws.readyState !== WebSocket.OPEN,
            });
            update({
              status: "completed",
              activity: "Findings returned to the parent agent.",
              appendLog: "Subagent completed.",
              result,
              toolUses,
              durationMs: Date.now() - startedAt,
            });
            sendLog(`Subagent completed: ${normalizedDescription}.`);
            return result;
          } catch (error: any) {
            const errorMessage = error?.message || String(error);
            update({
              status: "error",
              activity: "Delegated investigation failed.",
              appendLog: `Subagent failed: ${errorMessage.slice(0, 180)}`,
              error: errorMessage,
              toolUses,
              durationMs: Date.now() - startedAt,
            });
            throw error;
          }
        },
      };
      tools.push(delegateTaskTool);
    }

    // Connect to MCP servers and register their tools
    const mcpToolLines: string[] = [];
    if (Array.isArray(mcpServers) && mcpServers.length > 0) {
      for (const server of mcpServers as McpServerConfig[]) {
        try {
          const { tools: mcpTools, dispose } = await createMcpTools(server, sendLog);
          mcpDisposers.push(dispose);
          for (const t of mcpTools) {
            tools.push(t);
            mcpToolLines.push(`- '${t.name}': ${t.description}`);
          }
        } catch (err: any) {
          sendLog(`MCP server "${server.name}" could not be loaded: ${err.message}`);
        }
      }
    }

    const toolDescriptions: Record<string, string> = {
      read_file: "- 'read_file': Read any file in the workspace (input: {\"path\": \"file/path\"}).",
      write_file: "- 'write_file': Write or edit a file (input: {\"path\": \"file/path\", \"content\": \"full content\"}).",
      write_plan: "- 'write_plan': Save a Markdown plan under the project-root plans folder (input: {\"filename\": \"descriptive-name.md\", \"content\": \"complete plan\"}).",
      list_files: "- 'list_files': List all files in the workspace (no input needed).",
      search_codebase: "- 'search_codebase': Search for text patterns across the codebase (input: {\"pattern\": \"search text\"}).",
      web_search: "- 'web_search': Search the public web for current information and cited sources (input: {\"query\": \"search query\"}).",
      run_command: "- 'run_command': Last-resort execution for an essential build, test, typecheck, lint, generator, or explicitly requested executable. Never use it for file inspection, search, or modification (input: {\"program\": \"npm\", \"args\": [\"test\"], \"cwd\": \".\"}).",
      ask_user_question: "- 'ask_user_question': Pause for a focused user decision, optionally with selectable suggestions.",
      lsp_get_definition: "- 'lsp_get_definition': Find definition of a symbol (input: {\"path\": \"file/path\", \"line\": lineNum, \"character\": colNum}).",
      lsp_get_references: "- 'lsp_get_references': Find all references of a symbol (input: {\"path\": \"file/path\", \"line\": lineNum, \"character\": colNum}).",
      lsp_get_diagnostics: "- 'lsp_get_diagnostics': Get compile errors/warnings for a file (input: {\"path\": \"file/path\"})."
    };
    const toolListText = [
      ...enabledToolNames.map((name: string) => toolDescriptions[name] || `- '${name}'`),
      "- 'report_progress': Publish a concise reasoning summary and the next intended action.",
      toolDescriptions.ask_user_question,
      ...(!vfsOnly && providerUsesManagedRuntime
        ? ["- 'delegate_task': Delegate a bounded read-only investigation or review to an independent subagent; multiple calls in one turn run concurrently."]
        : []),
    ].join("\n");

    const defaultSystemPrompt = `You are an AI coding agent operating inside the Axiom spatial development canvas.
You help the user analyze, modify, and implement code in their workspace.

Workspace root: ${workspaceRoot || "unknown"}


You have access to tools:
${toolListText}

Guidelines:
- Use 'read_file' to read a file before editing it.
- Use 'write_file' to write the updated content back.
- Be concise and focused. Only modify what is requested.
- Output clean code without placeholder comments.
- Once done, summarize the changes you made.
- When a material product, UX, or architecture decision cannot be inferred safely, call 'ask_user_question' instead of guessing. Keep questions focused and offer concrete options with their trade-offs.
${mcpToolLines.length > 0 ? `\nMCP integration tools (external data sources):\n${mcpToolLines.join("\n")}\n` : ""}
`;

    const planningPolicy = planOnly ? `

Global Chat planning policy (this overrides any conflicting skill instruction):
- Work only on planning, analysis, requirements, architecture, risks, and recommendations. Never implement code or modify project source files.
- The VFS is read-only for this session. Never attempt to call 'write_file', and never use commands to create or modify files.
- Always present requested plans in the chat. A request to create, draft, generate, or prepare a plan means to answer with the plan in chat; it does NOT authorize creating a file.
- Never generate, create, or persist any file unless the user explicitly asks you to save, write, or store that file on disk.
- The only permitted filesystem change is saving a Markdown planning document with 'write_plan'. It stores the document in the 'plans' folder at the project root (${path.join(workspaceRoot, "plans")}).
- Call 'write_plan' only after an explicit user request to save, write, or store the plan as a file. Even then, also show the plan in chat.
- Any persisted plan MUST use 'write_plan' with a descriptive Markdown filename. Never store a plan in the VFS or anywhere outside the project-root 'plans' folder.
${GLOBAL_CHAT_TASK_DEPENDENCY_POLICY}
` : "";

    const taskNodePolicy = vfsOnly ? `

TaskNode VFS policy (this overrides any conflicting skill instruction):
- Follow the user-selected skill while staying inside the TaskNode's virtual workspace.
- You may read workspace files, but every file creation or modification MUST use 'write_file'. That tool writes only to this TaskNode's VFS for later review and reconciliation; it does not modify the physical workspace.
- Continue iterating on the current VFS versions of files when the user requests refinements.
- Physical command execution is unavailable. Do not attempt shell commands or ask another agent to bypass this boundary.
` : "";

    const agentTabHarnessPolicy = !planOnly && !vfsOnly
      ? AGENT_TAB_HARNESS_POLICY
      : "";

    const systemPrompt = `${skill?.systemPrompt || defaultSystemPrompt}${planningPolicy}${taskNodePolicy}${agentTabHarnessPolicy}

User-visible reasoning updates:
- Before the first substantive action, call 'report_progress' with a concise summary of your approach and the next action.
- Call it again whenever the evidence changes your plan or before a distinct new phase.
- Base updates on concrete context and tool results. Do not reveal private chain-of-thought or hidden reasoning; keep each update to 1-3 clear sentences.

Delegation:
${vfsOnly
  ? "- TaskNodes work directly and cannot delegate to other agents."
  : agentDelegationPolicy(providerUsesManagedRuntime ? "delegate_task" : "Agent")}

Questions:
- When a material product, UX, or architecture decision cannot be inferred safely, call 'ask_user_question' instead of guessing. Keep questions focused and offer concrete options with their trade-offs.`;

    sendLog("Initializing agent...");
    activityHeartbeat = setInterval(() => {
      if (Date.now() - lastActivityAt < 12_000) return;
      sendLog("Model is still working; awaiting its next visible action.");
    }, 4_000);
    activityHeartbeat.unref?.();

    const sendToken = (token: string) => {
      lastActivityAt = Date.now();
      safeSend(ws, { type: "token", tabId, content: token });
    };

    const piResponse = await runPiAgentChat({
      tabId,
      model: modelReference,
      workspaceRoot,
      systemPrompt,
      conversationHistory: chatHistory || [],
      message,
      tools,
      customProvider,
      sendLog,
      sendToken,
      sendSubagentUpdate,
      enableSubagents: !vfsOnly,
      consumeDeferredQuestion: () => {
        const question = deferredQuestion;
        deferredQuestion = undefined;
        return question;
      },
      requestUserQuestion,
    });

    const responseText = piResponse ?? await callLlmWithToolsPiStreaming({
      modelReference,
      customProvider,
      systemPrompt,
      userMessage: message,
      tools,
      sendLog,
      sendToken,
      maxRounds: 30,
      cwd: workspaceRoot,
      history: chatHistory || [],
      shouldAbort: () => ws.readyState !== WebSocket.OPEN,
    });

    sendLog("Agent complete.");

    // Small delay to ensure message is sent before closing
    await new Promise(resolve => setTimeout(resolve, 50));

    safeSend(ws, {
      type: "agent_chat_complete",
      tabId,
      response: responseText,
      modifiedFiles: Array.from(modifiedFiles)
    });

    // Ensure the message is sent before returning
    await new Promise(resolve => setTimeout(resolve, 100));
  } catch (err: any) {
    console.error("WebSocket [Server] agent_chat error:", err);
    sendLog(`Agent error: ${err.message}`);
    safeSend(ws, {
      type: "agent_chat_error",
      tabId,
      error: err.message
    });
  } finally {
    if (activityHeartbeat) clearInterval(activityHeartbeat);
    // Clean up MCP server connections
    for (const dispose of mcpDisposers) {
      try {
        dispose();
      } catch (err) {
        console.error("Error disposing MCP connection:", err);
      }
    }
  }
}
