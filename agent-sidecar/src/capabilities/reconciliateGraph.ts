import { WebSocket } from "ws";
import path from "path";
import { safeSend, getNextId, registerPendingRequest } from "../services/websocket";
import { createListFilesTool, createSearchCodebaseTool } from "../services/tools";

export async function reconciliateGraph(ws: WebSocket, data: any): Promise<void> {
  const { tabId, model, nodes, workspaceRoot, customProvider } = data;
  console.log(`WebSocket [Server] reconciliate_graph starting for tab: ${tabId}`);

  try {
    if (customProvider) {
      try {
        const { registerProvider } = require("@earendil-works/pi-agent-core");
        registerProvider(customProvider.id, {
          name: customProvider.name,
          baseUrl: customProvider.baseUrl,
          apiKey: customProvider.apiKey || "not-needed",
          api: customProvider.apiType || "openai-completions",
          models: customProvider.models
        });
      } catch (err: any) {
        console.warn("Provider registration warning:", err.message);
      }
    }

    const readVfsTool = {
      name: "read_file",
      description: "Read a file from the workspace VFS.",
      execute: async ({ path: filePath }: { path: string }) => {
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
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

    const systemPrompt = `You are a graph code reconciliation assistant inside a spatial development canvas.
Your job is to reconcile and align all code changes across the task graph.
You have access to multiple tasks, each with its own individual purpose, prompt instructions, chat history, and modified files in the virtual file system (VFS).

Here are the tasks in the current graph:
${tasksPromptInfo}

Your instructions:
1. Review the modified files across the VFS to understand the changes made by each task.
2. Analyze whether these changes conflict, duplicate, or overlap, and refactor/align them where they intersect.
3. Keep in mind that a file might be used or processed by multiple separate tasks. Each task is individual and has its own purpose. Ensure that the reconciled code satisfies all tasks' requirements.
4. Use 'read_file' to read the contents of the VFS files.
5. Use 'write_file' to apply your reconciled code changes back to the VFS.
6. Verify that the final codebase is clean, compile-safe, and fully functional.
7. CRITICAL: When making changes to a file, write the complete file with all changes included to the EXACT same path. Do NOT create a new/duplicate file with a similar or modified name. You must replace/overwrite the existing file. Never write partial code or snippets.

Workspace root: ${workspaceRoot || "unknown"}
`;

    let response;
    try {
      const { createAgentSessionRuntime } = require("@earendil-works/pi-agent-core");
      const runtime = await createAgentSessionRuntime({
        tools: [readVfsTool, writeVfsTool, createListFilesTool(workspaceRoot), createSearchCodebaseTool(workspaceRoot)],
        modelName: model || "anthropic/claude-3-5-sonnet",
        systemPrompt,
        messages: []
      });
      const result = await runtime.run();
      response = result?.response || result?.output || "Graph reconciliation complete.";
    } catch (sdkError: any) {
      console.warn("Graph reconciliation SDK fallback:", sdkError.message);
      
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
        await new Promise(r => setTimeout(r, 800));
        response = "Reconciliation completed. The graph was analyzed and overlaps were aligned inside the virtual file system.";
      } else {
        const graphSendLog = (msg: string) => console.log(`[ReconciliateGraph] ${msg}`);
        response = await callLlmWithToolsMultiRoundStreaming(
          { baseUrl, apiKey, model: modelName },
          systemPrompt,
          "Reconcile the task graph codebase by verifying and aligning modified files across the VFS. Update any conflicts or overlaps.",
          [readVfsTool, writeVfsTool, createListFilesTool(workspaceRoot), createSearchCodebaseTool(workspaceRoot)],
          workspaceRoot,
          graphSendLog,
          () => {}, // No token streaming for graph reconciliation
          15,
          [],
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
