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
import { callLlmWithToolsMultiRound, LlmConfig } from "../services/llm";

export async function agentChat(ws: WebSocket, data: any): Promise<void> {
  const { tabId, message, model, workspaceRoot, chatHistory, customProvider, skill } = data;
  console.log(`WebSocket [Server] agent_chat starting`, { tabId, workspaceRoot, model, hasSkill: !!skill });

  const modifiedFiles = new Set<string>();

  const sendLog = (logMessage: string) => {
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
          registerPendingRequest(requestId, (res) => {
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
          registerPendingRequest(requestId, (res) => {
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

const allTools = [
      readVfsTool,
      writeVfsTool,
      createListFilesTool(workspaceRoot),
      createSearchCodebaseTool(workspaceRoot)
    ];

    const enabledToolNames = skill?.enabledTools || ["read_file", "write_file", "list_files", "search_codebase"];
    const tools = allTools.filter((t: any) => enabledToolNames.includes(t.name));

    const toolDescriptions: Record<string, string> = {
      read_file: "- 'read_file': Read any file in the workspace (input: {\"path\": \"file/path\"}).",
      write_file: "- 'write_file': Write or edit a file (input: {\"path\": \"file/path\", \"content\": \"full content\"}).",
      list_files: "- 'list_files': List all files in the workspace (no input needed).",
      search_codebase: "- 'search_codebase': Search for text patterns across the codebase (input: {\"pattern\": \"search text\"}).",
    };
    const toolListText = enabledToolNames.map((name: string) => toolDescriptions[name] || `- '${name}'`).join("\n");

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
`;

    const systemPrompt = skill?.systemPrompt || defaultSystemPrompt;

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

    console.log(`WebSocket [Server] agent_chat Calling LLM: ${llmConfig.model} at ${llmConfig.baseUrl}`);

    const responseText = await callLlmWithToolsMultiRound(
      llmConfig,
      systemPrompt,
      message,
      tools,
      workspaceRoot,
      sendLog,
      30,
      chatHistory || []
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
  }
}
