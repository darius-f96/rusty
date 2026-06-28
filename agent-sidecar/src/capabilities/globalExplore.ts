/**
 * Global Explore Capability
 * 
 * Implements the "global_explore" operation. It scans the repository files using
 * recursive explorers, runs search queries, and makes multi-round tool-calling
 * calls to the LLM to yield architectural codebase summaries.
 */

import { WebSocket } from "ws";
import path from "path";
import fs from "fs";
import { safeSend, getNextId, registerPendingRequest } from "../services/websocket";
import { createListFilesTool, createSearchCodebaseTool, listFilesRecursive } from "../services/tools";
import { callLlmWithToolsMultiRound, LlmConfig } from "../services/llm";
import { createMcpTools, McpServerConfig } from "../services/mcpClient";

export async function globalExplore(ws: WebSocket, data: any): Promise<void> {
  const { nodeId, prompt, workspaceRoot, model, chatHistory, customProvider, mcpServers } = data;
  console.log(`WebSocket [Server] global_explore starting`, { nodeId, workspaceRoot, model, mcpCount: mcpServers?.length || 0 });

  const sendLog = (message: string) => {
    safeSend(ws, { type: "log", nodeId, message });
  };

  const mcpDisposers: Array<() => void> = [];

  try {
    const readVfsTool = {
      name: "read",
      description: "Read a file from the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "The file path to read" }
        },
        required: ["path"]
      },
      execute: async ({ path: filePath }: { path: string }) => {
        console.log(`WebSocket [Server] global_explore read_file tool: ${filePath}`);
        
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
        try {
          if (fs.existsSync(resolvedPath)) {
            const stats = fs.statSync(resolvedPath);
            if (stats.isDirectory()) {
              const errorMsg = `Error: '${filePath}' is a directory, not a file. To list directory contents, use list_files.`;
              console.log(`WebSocket [Server] read_file directory guard: ${errorMsg}`);
              sendLog(`Directory read attempt: ${filePath}`);
              return errorMsg;
            }
          }
        } catch (statErr: any) {
          console.warn(`WebSocket [Server] read_file stat error for ${filePath}:`, statErr);
        }

        sendLog(`Reading file: ${filePath}`);
        return new Promise((resolve, reject) => {
          const requestId = getNextId();
          registerPendingRequest(requestId, (res) => {
            if (res.error) {
              const errorMsg = String(res.error).toLowerCase();
              if (errorMsg.includes("not found") || errorMsg.includes("no such file") || errorMsg.includes("exist")) {
                console.log(`WebSocket [Server] global_explore read_file target not found, returning placeholder: ${resolvedPath}`);
                resolve("[File does not exist yet. You can create it by calling write_file with content.]");
              } else {
                console.error(`WebSocket [Server] read_file error: ${res.error}`);
                reject(new Error(res.error));
              }
            } else {
              console.log(`WebSocket [Server] read_file success: ${filePath} (${res.content?.length || 0} chars)`);
              resolve(res.content);
            }
          });
          safeSend(ws, { type: "read_file", requestId, path: resolvedPath });
        });
      }
    };

    const tools = [
      readVfsTool,
      createListFilesTool(workspaceRoot),
      createSearchCodebaseTool(workspaceRoot)
    ];

    // Merge tools from any MCP servers selected on the Global Explorer node.
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

    const systemPrompt = `You are a codebase exploration assistant inside a spatial development canvas called Axiom.
Your job is to analyze the workspace and provide architectural summaries, patterns, and guidelines.

Workspace root: ${workspaceRoot || "unknown"}

You have access to tools:
- 'read': Read any file in the workspace (input: {{"path": "file/path"}}).
- 'list_files': List all files in the workspace recursively (no input needed).
- 'search_codebase': Search for text patterns across the codebase (input: {{"pattern": "search text"}}).
${mcpToolLines.length > 0 ? `\nMCP integration tools (external data sources):\n${mcpToolLines.join("\n")}\n` : ""}
IMPORTANT: Always use tools to explore the codebase before answering. Start by listing files, then read relevant ones.
${mcpToolLines.length > 0 ? "If the user asks for external information available via MCP tools, call those tools to fetch it.\n" : ""}

After exploring, provide:
1. A clear architectural summary of the codebase structure.
2. Key patterns and conventions used.
3. Guidelines for making changes that align with the existing codebase.

IMPORTANT: End your response with a section marked "--- SUMMARY ---" that contains a concise bullet-point list of architectural guidelines. This summary will be injected into all task execution prompts.
`;

    sendLog("Initializing exploration agent...");

    let runResult;
    try {
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
      } else if (customProvider && customProvider.id === "anthropic" && !customProvider.apiKey) {
        throw new Error("Anthropic API key not configured. Use simulation fallback.");
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
          throw new Error(`Unknown provider: ${provider}. Use simulation fallback.`);
        }
      } else {
        throw new Error("No LLM configuration available. Use simulation fallback.");
      }

      if (!llmConfig.apiKey) {
        throw new Error("No API key available. Use simulation fallback.");
      }

      console.log(`WebSocket [Server] Calling LLM: ${llmConfig.model} at ${llmConfig.baseUrl}`);

      const responseText = await callLlmWithToolsMultiRound(
        llmConfig,
        systemPrompt,
        prompt,
        tools,
        workspaceRoot,
        sendLog,
        50,
        chatHistory || []
      );

      runResult = { response: responseText };
      sendLog("Exploration complete.");
    } catch (sdkError: any) {
      console.error("WebSocket [Server] LLM error:", sdkError);
      sendLog(`LLM error: ${sdkError.message}. Using simulation fallback.`);

      const files = listFilesRecursive(workspaceRoot);
      const fileCount = files.length;
      const dirs = new Set(files.map(f => f.split("/")[0]));
      const topDirs = Array.from(dirs).slice(0, 10).join(", ");

      runResult = {
        response: `# Workspace Analysis (Simulated)\n\nI found **${fileCount}** files across the workspace.\n\nTop-level directories: ${topDirs}\n\n--- SUMMARY ---\n- Workspace contains ${fileCount} files\n- Main directories: ${topDirs}\n- Follow existing code patterns and naming conventions\n- Maintain consistent formatting and styling`,
        summary: `- Workspace contains ${fileCount} files\n- Main directories: ${topDirs}\n- Follow existing code patterns and naming conventions`
      };
    }

    const responseText = (runResult as any)?.response || "Exploration completed.";
    let summary = "";
    const summaryMatch = responseText.match(/---\s*SUMMARY\s*---([\s\S]*?)$/i);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
    } else if ((runResult as any)?.summary) {
      summary = (runResult as any).summary;
    }

    console.log(`WebSocket [Server] Global Explore completed. Response length: ${responseText.length} chars`);
    mcpDisposers.forEach((d) => d());

    safeSend(ws, {
      type: "global_explore_complete",
      nodeId,
      response: responseText,
      summary
    });
  } catch (err: any) {
    console.error(`WebSocket [Server] global_explore error:`, err);
    mcpDisposers.forEach((d) => d());
    safeSend(ws, {
      type: "global_explore_error",
      nodeId,
      error: err.message
    });
  }
}
