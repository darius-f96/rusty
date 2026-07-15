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
import { callLlmWithToolsMultiRoundStreaming, LlmConfig } from "../services/llm";
import { createLspTools } from "../services/lspTools";
import { createMcpTools, McpServerConfig } from "../services/mcpClient";
import { createWebSearchTool } from "../services/webSearchTool";
import { DeferredUserQuestion, hasActiveBackgroundSubagents, runPiAgentChat } from "../services/piAgentChat";
import { createRunCommandTool } from "./tools/runCommandTool";

type AgentTool = {
  name: string;
  description: string;
  inputSchema?: any;
  execute: (args: any) => Promise<any>;
};

export async function agentChat(ws: WebSocket, data: any): Promise<void> {
  const { tabId, message, model, workspaceRoot, chatHistory, customProvider, skill, lspSettings, mcpServers } = data;
  (ws as any).__activeAgentTabId = tabId;
  console.log(`WebSocket [Server] agent_chat starting`, { tabId, workspaceRoot, model, hasSkill: !!skill, lspEnabled: lspSettings?.enabled, mcpCount: mcpServers?.length || 0 });

  const modifiedFiles = new Set<string>();
  const mcpDisposers: Array<() => void> = [];
  let deferredQuestion: DeferredUserQuestion | undefined;

  const sendLog = (logMessage: string) => {
    console.log(`[Agent:${tabId}] ${logMessage}`);
    safeSend(ws, { type: "log", tabId, message: logMessage });
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
                resolve("[File does not exist yet. You can create it by calling write_file with content.]");
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

    const allTools: AgentTool[] = [
      readVfsTool,
      writeVfsTool,
      createListFilesTool(workspaceRoot),
      createSearchCodebaseTool(workspaceRoot),
      createWebSearchTool(sendLog),
      createRunCommandTool({ ws, sessionId: tabId, workspaceRoot, sendLog }),
      ...lspTools
    ];

    const enabledToolNames = skill?.enabledTools || [
      "read_file",
      "write_file",
      "list_files",
      "search_codebase",
      "web_search",
      "run_command",
      ...(lspSettings?.enabled ? ["lsp_get_definition", "lsp_get_references", "lsp_get_diagnostics"] : [])
    ];
    const tools: AgentTool[] = allTools.filter((t) => enabledToolNames.includes(t.name));
    // Observability is always available, including when a restrictive skill is selected.
    tools.push(progressTool);
    tools.push(askUserQuestionTool);

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
      list_files: "- 'list_files': List all files in the workspace (no input needed).",
      search_codebase: "- 'search_codebase': Search for text patterns across the codebase (input: {\"pattern\": \"search text\"}).",
      web_search: "- 'web_search': Search the public web for current information and cited sources (input: {\"query\": \"search query\"}).",
      run_command: "- 'run_command': Run an approved non-interactive command in the physical workspace (input: {\"program\": \"npm\", \"args\": [\"test\"], \"cwd\": \".\"}).",
      ask_user_question: "- 'ask_user_question': Pause for a focused user decision, optionally with selectable suggestions.",
      lsp_get_definition: "- 'lsp_get_definition': Find definition of a symbol (input: {\"path\": \"file/path\", \"line\": lineNum, \"character\": colNum}).",
      lsp_get_references: "- 'lsp_get_references': Find all references of a symbol (input: {\"path\": \"file/path\", \"line\": lineNum, \"character\": colNum}).",
      lsp_get_diagnostics: "- 'lsp_get_diagnostics': Get compile errors/warnings for a file (input: {\"path\": \"file/path\"})."
    };
    const toolListText = [
      ...enabledToolNames.map((name: string) => toolDescriptions[name] || `- '${name}'`),
      "- 'report_progress': Publish a concise reasoning summary and the next intended action.",
      toolDescriptions.ask_user_question
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

    const systemPrompt = `${skill?.systemPrompt || defaultSystemPrompt}

User-visible reasoning updates:
- Before the first substantive action, call 'report_progress' with a concise summary of your approach and the next action.
- Call it again whenever the evidence changes your plan or before a distinct new phase.
- Base updates on concrete context and tool results. Do not reveal private chain-of-thought or hidden reasoning; keep each update to 1-3 clear sentences.

Delegation:
- When two or more investigations, reviews, or implementation steps are independent, delegate them concurrently by issuing multiple 'Agent' tool calls in the same turn.
- Use background subagents for independent long-running work, and continue with work that does not depend on their results.
- Keep dependent work sequential and wait for subagent results only when later work depends on them.
- Never ask the user a refining question or present a final recommendation while delegated subagents are active. First retrieve every delegated result with get_subagent_result (use wait: true when necessary), then aggregate the findings.
- Every delegated task must be narrowly scoped with a concrete deliverable. Ask for a concise findings memo, not an open-ended investigation.
- Always set max_turns when delegating: use 3 for codebase mapping and 4 for web research or implementation analysis. Stop once the requested evidence is sufficient.
- For codebase discovery, use the Explore agent with only the smallest relevant set of files. For product research, use at most three web searches and summarize the sources; do not keep browsing for marginal detail.
- Do not delegate verification, retries, or follow-up exploration unless the user explicitly requests deeper research.

Questions:
- When a material product, UX, or architecture decision cannot be inferred safely, call 'ask_user_question' instead of guessing. Keep questions focused and offer concrete options with their trade-offs.`;

    sendLog("Initializing agent...");

    let llmConfig: LlmConfig;
    let modelId = model || "claude-3-5-sonnet";

    if (customProvider && customProvider.baseUrl && customProvider.apiKey) {
      let selectedModel = modelId;
      if (selectedModel.includes("/")) {
        selectedModel = selectedModel.split("/")[1];
      }
      if (!selectedModel || selectedModel === "claude-3-5-sonnet") {
        const firstModel = customProvider.models?.[0]?.id || "";
        selectedModel = firstModel.includes("/") ? firstModel.split("/")[1] : firstModel;
      }
      llmConfig = {
        baseUrl: customProvider.baseUrl.replace(/\/$/, ""),
        apiKey: customProvider.apiKey,
        model: selectedModel
      };
      sendLog(`Using custom provider: ${customProvider.name}`);
    } else if (model && model.includes("/")) {
      const [provider] = model.split("/");
      if (provider === "anthropic") {
        llmConfig = {
          baseUrl: "https://api.anthropic.com/v1",
          apiKey: process.env.ANTHROPIC_API_KEY || "",
          model: model.split("/")[1]
        };
      } else if (provider === "openai") {
        llmConfig = {
          baseUrl: "https://api.openai.com/v1",
          apiKey: process.env.OPENAI_API_KEY || "",
          model: model.split("/")[1]
        };
      } else {
        throw new Error(`Unknown provider: ${provider}.`);
      }
    } else {
      throw new Error("No LLM configuration available.");
    }

    if (!llmConfig.apiKey) {
      throw new Error("No API key available.");
    }

    const sendToken = (token: string) => {
      safeSend(ws, { type: "token", tabId, content: token });
    };

    const piModel = model?.includes("/")
      ? model
      : customProvider ? `${customProvider.id}/${llmConfig.model}` : model || "";
    const piResponse = await runPiAgentChat({
      tabId,
      model: piModel,
      workspaceRoot,
      systemPrompt,
      conversationHistory: chatHistory || [],
      message,
      tools,
      customProvider,
      sendLog,
      sendToken,
      sendSubagentUpdate: (subagent) => safeSend(ws, { type: "subagent_update", tabId, subagent }),
      consumeDeferredQuestion: () => {
        const question = deferredQuestion;
        deferredQuestion = undefined;
        return question;
      },
      requestUserQuestion,
    });

    const responseText = piResponse ?? await callLlmWithToolsMultiRoundStreaming(
      llmConfig,
      systemPrompt,
      message,
      tools,
      workspaceRoot,
      sendLog,
      sendToken,
      30,
      chatHistory || [],
      () => ws.readyState !== WebSocket.OPEN
    );

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
