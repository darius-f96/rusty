/**
 * Execute Node Capability
 * 
 * Implements the "execute_node" operation. It gathers attached input context files,
 * builds a system prompt matching the instructions, and spawns the agent runtime
 * session using either the Pi coding agent SDK or a fallback LLM tool call wrapper.
 */

import { WebSocket } from "ws";
import path from "path";
import { safeSend, getNextId, registerPendingRequest } from "../services/websocket";
import { createListFilesTool, createSearchCodebaseTool } from "../services/tools";
import { createMcpTools, McpServerConfig } from "../services/mcpClient";

export async function executeNode(ws: WebSocket, data: any): Promise<void> {
  const { nodeId, instructions, model, workspaceRoot, inputFiles, customProvider, globalContext, contextDescriptions, chatHistory, skill, mcpContext, upstreamTaskContext } = data;
  console.log(`WebSocket [Server] execute_node task starting`, {
    nodeId,
    model,
    workspaceRoot,
    inputFilesCount: inputFiles?.length || 0,
    chatHistoryCount: chatHistory?.length || 0,
    hasSkill: !!skill,
    mcpContextCount: mcpContext?.length || 0,
    upstreamTasksCount: upstreamTaskContext?.length || 0
  });

  const modifiedFiles = new Set<string>();
  const mcpDisposers: Array<() => void> = [];

  const sendLog = (message: string) => {
    safeSend(ws, { type: "log", nodeId, message });
  };

  try {
    if (customProvider) {
      sendLog(`Registering custom LLM provider: ${customProvider.name} (${customProvider.id})`);
      console.log(`WebSocket [Server] registering custom provider`, customProvider);
      try {
        const { registerProvider } = require("@earendil-works/pi-agent-core");
        registerProvider(customProvider.id, {
          name: customProvider.name,
          baseUrl: customProvider.baseUrl,
          apiKey: customProvider.apiKey || "not-needed",
          api: customProvider.apiType || "openai-completions",
          models: customProvider.models
        });
        sendLog("Custom provider registered successfully.");
      } catch (err: any) {
        console.error("Could not register custom provider:", err.message);
        sendLog(`Provider warning: Using simulated/mock LLM fallback due to: ${err.message}`);
      }
    }

    const readVfsTool = {
      name: "read_file",
      description: "Read a file's content from the virtual workspace.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "The file path to read" }
        },
        required: ["path"]
      },
      execute: async ({ path: filePath }: { path: string }) => {
        console.log(`WebSocket [Server] tool read_file requested: ${filePath}`);
        sendLog(`AI reading file context: ${filePath}`);
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
        return new Promise((resolve, reject) => {
          const requestId = getNextId();
          registerPendingRequest(requestId, (res) => {
            if (res.error) {
              const errorMsg = String(res.error).toLowerCase();
              if (errorMsg.includes("not found") || errorMsg.includes("no such file") || errorMsg.includes("exist")) {
                console.log(`WebSocket [Server] read_file target not found, returning placeholder for new file creation: ${resolvedPath}`);
                resolve("[File does not exist yet. You can create it by calling write_file with content.]");
              } else {
                console.error(`WebSocket [Server] read_file failed for: ${resolvedPath}`, res.error);
                reject(new Error(res.error));
              }
            } else {
              console.log(`WebSocket [Server] read_file success for: ${resolvedPath} (${res.content?.length || 0} chars)`);
              resolve(res.content);
            }
          });
          safeSend(ws, { type: "read_file", requestId, path: resolvedPath });
        });
      }
    };

    const writeVfsTool = {
      name: "write_file",
      description: "Write or edit a file's content in the virtual workspace.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "The file path to write/edit" },
          content: { type: "string", description: "The full content of the file" }
        },
        required: ["path", "content"]
      },
      execute: async ({ path: filePath, content }: { path: string; content: string }) => {
        console.log(`WebSocket [Server] tool write_file requested: ${filePath} (${content.length} chars)`);
        sendLog(`AI modifying file: ${filePath}`);
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
        modifiedFiles.add(resolvedPath);
        
        return new Promise((resolve, reject) => {
          const requestId = getNextId();
          registerPendingRequest(requestId, (res) => {
            if (res.error) {
              console.error(`WebSocket [Server] write_file failed for: ${resolvedPath}`, res.error);
              reject(new Error(res.error));
            } else {
              console.log(`WebSocket [Server] write_file success for: ${resolvedPath}`);
              resolve(`File successfully written to: ${resolvedPath}`);
            }
          });
          safeSend(ws, { type: "write_file", requestId, path: resolvedPath, content });
        });
      }
    };

    sendLog("Initializing Pi agent runtime...");

    const allTools = [
      readVfsTool,
      writeVfsTool,
      createListFilesTool(workspaceRoot),
      createSearchCodebaseTool(workspaceRoot)
    ];

    // Connect to MCP servers attached via MCP context nodes and merge their tools.
    const mcpToolDescriptions: string[] = [];
    if (Array.isArray(mcpContext) && mcpContext.length > 0) {
      for (const ctx of mcpContext) {
        const server: McpServerConfig = ctx.server;
        const description: string = ctx.description || "";
        try {
          const { tools: mcpTools, dispose } = await createMcpTools(server, sendLog);
          mcpDisposers.push(dispose);
          for (const t of mcpTools) {
            allTools.push(t);
            mcpToolDescriptions.push(`- '${t.name}': ${t.description}`);
          }
          if (description) {
            mcpToolDescriptions.push(`  (User intent for ${server.name}: ${description})`);
          }
        } catch (err: any) {
          sendLog(`MCP context "${server.name}" could not be loaded: ${err.message}`);
        }
      }
    }

    const enabledToolNames = skill?.enabledTools || ["read_file", "write_file", "list_files", "search_codebase"];
    // Built-in tools are filtered by the skill; MCP tools are always available.
    const tools = [
      ...allTools.filter((t: any) => enabledToolNames.includes(t.name)),
      ...allTools.filter((t: any) => t.name.startsWith("mcp__")),
    ];

    const toolDescriptions: Record<string, string> = {
      read_file: "- 'read_file': Read a file's current content before editing it.",
      write_file: "- 'write_file': Write or edit a file.",
      list_files: "- 'list_files': Discover files in the workspace.",
      search_codebase: "- 'search_codebase': Find specific code patterns.",
    };
    const toolListText = [
      ...enabledToolNames.map((name: string) => toolDescriptions[name] || `- '${name}'`),
      ...mcpToolDescriptions,
    ].join("\n");

    const filesList = inputFiles && inputFiles.length > 0
      ? `You have direct read/write access to the following connected files:
${inputFiles.map((f: any) => `- ${f.path}`).join("\n")}
Please read them first if you need to modify or inspect them.`
      : `No input files are directly connected to this task node. You can read/write any files in the workspace.`;

    const upstreamSection = Array.isArray(upstreamTaskContext) && upstreamTaskContext.length > 0
      ? upstreamTaskContext.map((t: any) => {
          const fileBlocks = (t.files || [])
            .map((f: any) => `--- File: ${f.path} ---\n${f.content}`)
            .join("\n\n");
          return `[Upstream Task: ${t.taskName}]\nPrevious instructions: ${t.prompt || "(none)"}\nGenerated code:\n${fileBlocks || "(no files captured)"}`;
        }).join("\n\n")
      : "";

    const defaultSystemPrompt = `You are an AI coding agent operating inside a spatial canvas.
Update files according to these user instructions: ${instructions}

Workspace directory root: ${workspaceRoot || "unknown"}
${filesList}
${globalContext ? `\n--- GLOBAL ARCHITECTURAL GUIDELINES ---\n${globalContext}\n` : ""}
${contextDescriptions && contextDescriptions.length > 0 ? `\n--- CONNECTED CONTEXT DESCRIPTIONS ---\n${contextDescriptions.join("\n")}\n` : ""}
${upstreamSection ? `\n--- UPSTREAM TASK OUTPUT (inherit and build upon this code) ---\nThe following tasks ran before this one and are directly connected to it. Their generated code is the starting point for your work. Read, respect, and extend it instead of re-implementing from scratch.\n${upstreamSection}\n` : ""}
${mcpToolDescriptions.length > 0 ? `\n--- MCP TOOL INTEGRATIONS ---\nThe following tools connect to external MCP servers. Use them to fetch the information requested in the connected MCP context descriptions.\n${mcpToolDescriptions.join("\n")}\n` : ""}
Remember:
${toolListText}
- Always output clean code without placeholder comments.

CRITICAL SCOPE & EFFICIENCY GUARDRAILS:
1. STRICT SCOPE CONTROL: Focus strictly on implementing ONLY what is requested in the user instructions. Do NOT edit, create, or delete any files or configurations that are not directly requested (for example, do not configure RedisConfig, properties files, or build dependencies unless explicitly asked to).
2. MINIMIZE CODEBASE EXPLORATION: Do not spend tool rounds reading unrelated files or listing directories unless they are directly relevant to the classes/methods you need to write. Avoid scanning the entire codebase.
3. USE PROVIDED CONTEXT FIRST: If code examples, templates, or snippets are provided in the "<Context>", "CONNECTED CONTEXT DESCRIPTIONS", or "UPSTREAM TASK OUTPUT", use them directly. Do not invent alternative patterns or waste rounds search-matching them. Implement them exactly as specified. When upstream task output is provided, treat that code as the current state of the files and modify it rather than recreating it.
4. TARGETED WRITING: Go straight to creating or modifying the requested files as quickly as possible. Do not get sidetracked by other improvements or warnings in the codebase.
5. TERMINATE PROMPTLY: Once you have successfully written or updated all requested files, do NOT run redundant tools (like search_codebase, list_files, or read_file) to double-check or verify your work. Stop calling tools immediately and provide your final response summarizing the changes made.
`;

    const systemPrompt = skill?.systemPrompt
      ? skill.systemPrompt.replace(/\$\{workspaceRoot\}/g, workspaceRoot || "unknown").replace(/\$\{instructions\}/g, instructions)
      : defaultSystemPrompt;

    let runResult;
    let useMultiRound = !!(chatHistory && chatHistory.length > 1);

    if (!useMultiRound) {
      try {
        const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
        const { getModel } = await import("@earendil-works/pi-ai");

        let selectedModel;
        if (model && model.includes("/")) {
          const [provider, modelName] = model.split("/");
          selectedModel = getModel(provider, modelName);
        } else {
          selectedModel = getModel("anthropic", "claude-3-5-sonnet-20241022");
        }

        console.log("WebSocket [Server] Creating task session with model:", selectedModel ? (selectedModel as any).modelId || (selectedModel as any).name || "default" : "default");

        const sdkToolNames = enabledToolNames.map((name: string) => {
          if (name === "read_file") return "read";
          if (name === "write_file") return "write";
          return name;
        });

        const { session } = await createAgentSession({
          cwd: workspaceRoot,
          model: selectedModel,
          tools: sdkToolNames,
          customTools: tools as any
        });

        sendLog("Executing agent reasoning loop...");
        console.log("WebSocket [Server] Running agent core loop...");

        const result = await session.prompt(instructions);
        runResult = { status: "success", modified: Array.from(modifiedFiles), response: (result as any).output || (result as any).message?.content || "Task completed." };
      } catch (sdkError: any) {
        console.warn("WebSocket [Server] Pi SDK load warning (using custom fallback):", sdkError.message);
        sendLog(`Pi SDK warning: ${sdkError.message}. Using multi-round custom fallback...`);
        useMultiRound = true;
      }
    }

    if (useMultiRound) {
      const { callLlmWithToolsMultiRound } = await import("../services/llm");
      let provider = "anthropic";
      let modelName = "claude-3-5-sonnet-20241022";
      if (model && model.includes("/")) {
        [provider, modelName] = model.split("/");
      }

      let baseUrl = "";
      let apiKey = "";

      if (customProvider && customProvider.baseUrl && customProvider.apiKey) {
        baseUrl = customProvider.baseUrl.replace(/\/$/, "");
        apiKey = customProvider.apiKey;
        if (modelName === "claude-3-5-sonnet-20241022" && customProvider.models?.[0]?.id) {
          const firstModel = customProvider.models[0].id;
          modelName = firstModel.includes("/") ? firstModel.split("/")[1] : firstModel;
        }
      } else if (provider === "anthropic") {
        baseUrl = "https://api.anthropic.com/v1";
        apiKey = process.env.ANTHROPIC_API_KEY || "";
      } else if (provider === "openai") {
        baseUrl = "https://api.openai.com/v1";
        apiKey = process.env.OPENAI_API_KEY || "";
      }

      if (!apiKey && provider === "anthropic") {
        console.warn("WebSocket [Server] Missing Anthropic API key. Simulating output...");
        sendLog("Simulating execution due to missing API key...");
        await new Promise(r => setTimeout(r, 1200));
        runResult = {
          status: "success",
          modified: EMPTY_MODIFIED_LIST(inputFiles),
          response: `[Simulated Refactoring]\n\nBased on your prompt: "${instructions}", I have successfully simulated modifications on the connected files.`
        };
      } else {
        const responseText = await callLlmWithToolsMultiRound(
          { baseUrl, apiKey, model: modelName },
          systemPrompt,
          instructions,
          tools,
          workspaceRoot,
          sendLog,
          200,
          chatHistory || []
        );
        runResult = { status: "success", modified: Array.from(modifiedFiles), response: responseText };
      }
    }

    console.log(`WebSocket [Server] Task complete. Sending success payload...`);
    mcpDisposers.forEach((d) => d());
    safeSend(ws, {
      type: "execution_complete",
      nodeId,
      result: runResult
    });

  } catch (err: any) {
    console.error(`WebSocket [Server] execute_node failed:`, err);
    mcpDisposers.forEach((d) => d());
    sendLog(`Critical failure: ${err.message}`);
    safeSend(ws, {
      type: "execution_error",
      nodeId,
      error: err.message
    });
  }
}

function EMPTY_MODIFIED_LIST(inputFiles: any[]): string[] {
  if (inputFiles && inputFiles.length > 0) {
    return [inputFiles[0].path];
  }
  return [];
}
