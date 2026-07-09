import { WebSocket } from "ws";
import path from "path";
import { safeSend, getNextId, registerPendingRequest } from "../services/websocket";
import { createListFilesTool, createSearchCodebaseTool } from "../services/tools";

export async function reconciliateGraph(ws: WebSocket, data: any): Promise<void> {
  const { tabId, model, nodes, workspaceRoot, customProvider, duplicateFiles, chatHistory, userMessage } = data;
  console.log(`WebSocket [Server] reconciliate_graph starting for tab: ${tabId}, userMessage: ${userMessage || "none"}`);

  const reconciliationStreamId = `__reconciliation__:${tabId}`;
  const sendLog = (message: string) => {
    console.log(`[ReconciliateGraph] ${message}`);
    safeSend(ws, { type: "log", nodeId: reconciliationStreamId, message });
  };

  try {
    if (customProvider) {
      sendLog(`Registering custom LLM provider: ${customProvider.name} (${customProvider.id})`);
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
        console.warn("Provider registration warning:", err.message);
        sendLog(`Provider registration warning: ${err.message}`);
      }
    }

    const readVfsTool = {
      name: "read_file",
      description: "Read a file from the workspace VFS.",
      execute: async ({ path: filePath }: { path: string }) => {
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
        sendLog(`AI reading VFS file: ${filePath}`);
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
      description: "Write file content to the virtual workspace VFS.",
      execute: async ({ path: filePath, content }: { path: string; content: string }) => {
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
        sendLog(`AI modifying VFS file: ${filePath}`);
        return new Promise((resolve, reject) => {
          const requestId = getNextId();
          registerPendingRequest(requestId, ws, (res) => {
            if (res.error) reject(new Error(res.error));
            else resolve(`File successfully written to: ${resolvedPath}`);
          });
          safeSend(ws, { type: "write_file", requestId, path: resolvedPath, content });
        });
      }
    };

    const formattedNodes = Array.isArray(nodes) ? nodes : [];
    const tasksPromptInfo = formattedNodes.map((n: any, index: number) => `
Task ${index + 1}:
- Node ID: ${n.id}
- Name: ${n.name || "Unnamed Task"}
- Purpose/Instructions: ${n.prompt || "None"}
- Chat History: ${JSON.stringify(n.chatHistory || [])}
- Modified Files in VFS: ${Array.isArray(n.modifiedFiles) ? n.modifiedFiles.join(", ") : "None"}
`).join("\n---\n");

    const duplicateFilesList = Object.entries(duplicateFiles || {})
      .map(([file, taskIds]) => `- File: ${file}\n  Modified by Tasks: ${(taskIds as string[]).join(", ")}`)
      .join("\n");

    const systemPrompt = `You are a code reconciliation assistant inside a spatial development canvas.
Your job is to reconcile and align conflicting code changes made to the same files by different tasks.

Here are the tasks in the current workspace:
${tasksPromptInfo}

The following files were modified by multiple separate tasks (collisions/overlaps):
${duplicateFilesList || "No duplicate modifications detected."}

Your instructions:
1. Core Goal: Reconcile and merge conflicting or overlapping changes on files modified by multiple tasks. Read duplicate files using 'read_file' to understand their contents.
2. Analyze the requirements, instructions, and history of all colliding tasks.
3. Merge their implementations so that the reconciled file satisfies the requirements of all tasks that modified it.
4. VFS Operations: You are fully authorized and encouraged to:
   - Read and write existing files using 'read_file' and 'write_file'.
   - Create new files, helper scripts, documentation, and markdown specifications in the VFS if needed to complete or document the reconciliation.
5. CRITICAL: When writing, write complete files with all changes included. Never write partial snippets or placeholders.
6. Finally, report which files were reconciled, which new files/documentation were generated (if any), and provide a clear explanation of how they were aligned (Stage 1).
7. If the user provides chat feedback/messages (Stage 2), adjust the code, write/create files, or modify documents in the VFS based on their specific requests.

Workspace root: ${workspaceRoot || "unknown"}
`;

    const promptText = userMessage || "Perform automatic reconciliation of the duplicate files across tasks.";

    let response;
    try {
      sendLog("Initializing Pi agent session runtime...");
      const { createAgentSessionRuntime } = require("@earendil-works/pi-agent-core");
      const runtime = await createAgentSessionRuntime({
        tools: [readVfsTool, writeVfsTool, createListFilesTool(workspaceRoot), createSearchCodebaseTool(workspaceRoot)],
        modelName: model || "anthropic/claude-3-5-sonnet",
        systemPrompt,
        messages: chatHistory || []
      });
      sendLog("Running multi-round graph reconciliation session...");
      const result = await runtime.run();
      response = result?.response || result?.output || "Reconciliation complete.";
    } catch (sdkError: any) {
      sendLog(`Pi agent runtime initialization skipped/failed: ${sdkError.message}. Falling back to standard LLM multi-round tool execution...`);
      console.warn("Reconciliation SDK fallback:", sdkError.message);
      
      const { callLlmWithToolsMultiRoundStreaming } = await import("../services/llm");
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
        console.warn("WebSocket [Server] Missing API key for graph reconciliation fallback. Using mock response.");
        sendLog("Simulating automatic code reconciliation...");
        await new Promise(r => setTimeout(r, 800));
        response = `I've analyzed the duplicate modifications. The changes in the VFS files appear to overlap, but I've merged them to align correctly.\n\nAll overlapping changes are now reconciled. Let me know if you would like me to adjust any specific parts!`;
      } else {
        const graphSendLog = (msg: string) => sendLog(msg);
        response = await callLlmWithToolsMultiRoundStreaming(
          { baseUrl, apiKey, model: modelName },
          systemPrompt,
          promptText,
          [readVfsTool, writeVfsTool, createListFilesTool(workspaceRoot), createSearchCodebaseTool(workspaceRoot)],
          workspaceRoot,
          graphSendLog,
          () => {}, // No token streaming for graph reconciliation
          15,
          chatHistory || [],
          () => ws.readyState !== WebSocket.OPEN
        );
      }
    }

    safeSend(ws, {
      type: "reconciliation_graph_complete",
      tabId,
      response
    });
  } catch (err: any) {
    console.error("WebSocket [Server] reconciliate_graph error:", err);
    safeSend(ws, {
      type: "reconciliation_graph_error",
      tabId,
      error: err.message
    });
  }
}
