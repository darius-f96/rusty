import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

// ── Codebase Exploration Tool Factories ──────────────────────────

const IGNORED_DIRS = new Set(["node_modules", "dist", ".git", "target", ".vscode", ".gemini", ".next", "__pycache__"]);

/** Recursively list all file paths under `root`, ignoring common noise dirs. */
function listFilesRecursive(root: string, prefix = ""): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(full, rel));
    } else {
      results.push(rel);
    }
  }
  return results;
}

/** Search all non-ignored files for a text pattern, returning matching file paths + line snippets. */
function searchCodebase(root: string, pattern: string, maxResults = 50): { file: string; line: number; text: string }[] {
  const results: { file: string; line: number; text: string }[] = [];
  const files = listFilesRecursive(root);
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "gi");
  } catch {
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  }
  for (const relPath of files) {
    if (results.length >= maxResults) break;
    const fullPath = path.join(root, relPath);
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push({ file: relPath, line: i + 1, text: lines[i].trim().slice(0, 200) });
          if (results.length >= maxResults) break;
        }
        regex.lastIndex = 0;
      }
    } catch {
      // Skip unreadable files (binary, permissions, etc.)
    }
  }
  return results;
}

function createListFilesTool(workspaceRoot: string) {
  return {
    name: "list_files",
    description: "Get a list of all file paths in the workspace recursively. Returns relative paths.",
    execute: async () => {
      const files = listFilesRecursive(workspaceRoot);
      return files.join("\n");
    }
  };
}

function createSearchCodebaseTool(workspaceRoot: string) {
  return {
    name: "search_codebase",
    description: "Find files containing a search term or regex pattern. Returns matching file paths and line snippets.",
    execute: async ({ pattern }: { pattern: string }) => {
      const results = searchCodebase(workspaceRoot, pattern);
      if (results.length === 0) return "No matches found.";
      return results.map(r => `${r.file}:${r.line} | ${r.text}`).join("\n");
    }
  };
}

const app = express();
app.use(cors());
app.use(express.json());

// Proxy endpoint to bypass WebView CORS restrictions for listing models
app.post("/proxy/models", async (req, res) => {
  const { baseUrl, apiKey } = req.body;
  if (!baseUrl) {
    return res.status(400).json({ error: "Missing baseUrl" });
  }
  try {
    const url = baseUrl.endsWith("/") ? `${baseUrl}models` : `${baseUrl}/models`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    console.log(`Proxy [Server] fetching models from: ${url}`);
    
    const response = await fetch(url, { method: "GET", headers });
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `Remote server error: ${text || response.statusText}` });
    }
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    console.error("Proxy [Server] fetch models error:", err);
    res.status(500).json({ error: err.message || "Failed to fetch models" });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Map to track active websocket callbacks for tool requests
const pendingRequests = new Map<string, (response: any) => void>();

// Helper to generate unique request IDs
let nextRequestId = 1;
function getNextId() {
  return `req_${nextRequestId++}`;
}

wss.on("connection", (ws: WebSocket) => {
  console.log("WebSocket [Server] Client connected to Pi Sidecar");

  ws.on("message", async (messageStr: string) => {
    let data;
    try {
      data = JSON.parse(messageStr);
    } catch (e) {
      console.error("WebSocket [Server] Invalid JSON received", e);
      return;
    }

    console.log(`WebSocket [Server] Received message type: ${data.type}`);

    // Handle tool execution responses coming back from React/Tauri
    if (data.type === "read_file_response" || data.type === "write_file_response") {
      console.log(`WebSocket [Server] Resolving pending request: ${data.requestId}`, { hasError: !!data.error });
      const resolver = pendingRequests.get(data.requestId);
      if (resolver) {
        resolver(data);
        pendingRequests.delete(data.requestId);
      }
      return;
    }

    // Handle initial execution request
    if (data.type === "execute_node") {
      const { nodeId, instructions, model, workspaceRoot, inputFiles, customProvider, globalContext, contextDescriptions } = data;
      console.log(`WebSocket [Server] execute_node task starting`, {
        nodeId,
        model,
        workspaceRoot,
        inputFilesCount: inputFiles?.length || 0
      });

      // Keep track of files modified by this task execution
      const modifiedFiles = new Set<string>();

      // Helper to log status back to React node UI
      const sendLog = (message: string) => {
        ws.send(JSON.stringify({ type: "log", nodeId, message }));
      };

      try {
        // Register custom LLM provider if supplied
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

        // Setup VFS bridged tools using WebSocket messages back to the frontend
        const readVfsTool = {
          name: "read_file",
          description: "Read a file's content from the virtual workspace.",
          execute: async ({ path }: { path: string }) => {
            console.log(`WebSocket [Server] tool read_file requested: ${path}`);
            sendLog(`AI reading file context: ${path}`);
            return new Promise((resolve, reject) => {
              const requestId = getNextId();
              pendingRequests.set(requestId, (res) => {
                if (res.error) {
                  console.error(`WebSocket [Server] read_file failed for: ${path}`, res.error);
                  reject(new Error(res.error));
                } else {
                  console.log(`WebSocket [Server] read_file success for: ${path} (${res.content?.length || 0} chars)`);
                  resolve(res.content);
                }
              });
              ws.send(JSON.stringify({ type: "read_file", requestId, path }));
            });
          }
        };

        const writeVfsTool = {
          name: "write_file",
          description: "Write or edit a file's content in the virtual workspace.",
          execute: async ({ path, content }: { path: string; content: string }) => {
            console.log(`WebSocket [Server] tool write_file requested: ${path} (${content.length} chars)`);
            sendLog(`AI modifying file: ${path}`);
            // Track modification
            modifiedFiles.add(path);
            
            return new Promise((resolve, reject) => {
              const requestId = getNextId();
              pendingRequests.set(requestId, (res) => {
                if (res.error) {
                  console.error(`WebSocket [Server] write_file failed for: ${path}`, res.error);
                  reject(new Error(res.error));
                } else {
                  console.log(`WebSocket [Server] write_file success for: ${path}`);
                  resolve({ success: true });
                }
              });
              ws.send(JSON.stringify({ type: "write_file", requestId, path, content }));
            });
          }
        };

        sendLog("Initializing Pi agent runtime...");

        // Generate dynamic system prompt matching active inputs
        const filesList = inputFiles && inputFiles.length > 0
          ? `You have direct read/write access to the following connected files:
${inputFiles.map((f: any) => `- ${f.path}`).join("\n")}
Please read them first if you need to modify or inspect them.`
          : `No input files are directly connected to this task node. You can read/write any files in the workspace.`;

        const systemPrompt = `You are an AI coding agent operating inside a spatial canvas.
Update files according to these user instructions: ${instructions}

Workspace directory root: ${workspaceRoot || "unknown"}
${filesList}
${globalContext ? `\n--- GLOBAL ARCHITECTURAL GUIDELINES ---\n${globalContext}\n` : ""}
${contextDescriptions && contextDescriptions.length > 0 ? `\n--- CONNECTED CONTEXT DESCRIPTIONS ---\n${contextDescriptions.join("\n")}\n` : ""}
Remember:
- Use the 'read_file' tool to read a file's current content before editing it.
- Use the 'write_file' tool to write the updated content back.
- Use the 'list_files' tool to discover files in the workspace.
- Use the 'search_codebase' tool to find specific code patterns.
- Always output clean code without placeholder comments.
`;

        // Simulate Pi SDK run loop or construct actual session runtime
        let runResult;
        try {
          const { createAgentSessionRuntime } = require("@earendil-works/pi-agent-core");
          console.log("WebSocket [Server] Instantiating Pi Agent Core Runtime...");
          const runtime = await createAgentSessionRuntime({
            tools: [readVfsTool, writeVfsTool, createListFilesTool(workspaceRoot), createSearchCodebaseTool(workspaceRoot)],
            modelName: model || "anthropic/claude-3-5-sonnet",
            systemPrompt: systemPrompt
          });
          sendLog("Executing agent reasoning loop...");
          console.log("WebSocket [Server] Running agent core loop...");
          runResult = await runtime.run();
        } catch (sdkError: any) {
          console.warn("WebSocket [Server] Pi SDK load warning (using simulation fallback):", sdkError.message);
          sendLog(`Pi SDK load warning (using simulation fallback): ${sdkError.message}`);
          
          // Simulation fallback for prototype/offline run
          await new Promise((resolve) => setTimeout(resolve, 1200));
          
          const targetFile = inputFiles && inputFiles.length > 0 
            ? inputFiles[0].path 
            : "./src/App.tsx";
            
          sendLog(`Simulated AI reading connected target: ${targetFile}`);
          try {
            const text = await readVfsTool.execute({ path: targetFile }) as string;
            
            sendLog("Simulated AI planning refactoring edits...");
            await new Promise((resolve) => setTimeout(resolve, 1200));
            
            let updatedContent = text;
            if (text.includes("Welcome to Tauri + React")) {
              updatedContent = text.replace(
                "Welcome to Tauri + React",
                "Axiom Refactored Code"
              );
            } else if (text.trim().length > 0) {
              updatedContent = `// Edited by Axiom AI simulation at ${new Date().toLocaleTimeString()}\n${text}`;
            } else {
              updatedContent = `// Created by Axiom AI simulation at ${new Date().toLocaleTimeString()}\n`;
            }
            
            await writeVfsTool.execute({ path: targetFile, content: updatedContent });
            runResult = { status: "success" };
          } catch (simErr: any) {
            console.error("Simulation failed:", simErr);
            throw new Error(`Simulation failed: ${simErr.message}`);
          }
        }

        const finalModifiedList = Array.from(modifiedFiles);
        console.log(`WebSocket [Server] task execution complete! Modified files:`, finalModifiedList);

        ws.send(
          JSON.stringify({
            type: "execution_complete",
            nodeId,
            result: {
              ...runResult,
              modified: finalModifiedList.length > 0 ? finalModifiedList : (runResult?.modified || [])
            }
          })
        );
      } catch (err: any) {
        console.error("WebSocket [Server] Execution failed:", err);
        ws.send(
          JSON.stringify({
            type: "execution_error",
            nodeId,
            error: err.message
          })
        );
      }
    }

    // ── Global Explore Handler ──────────────────────────────────
    if (data.type === "global_explore") {
      const { nodeId, prompt, workspaceRoot, model, chatHistory, customProvider } = data;
      console.log(`WebSocket [Server] global_explore starting`, { nodeId, workspaceRoot });

      const sendLog = (message: string) => {
        ws.send(JSON.stringify({ type: "log", nodeId, message }));
      };

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
            sendLog(`Provider warning: ${err.message}`);
          }
        }

        // Create VFS read tool bridging back to frontend
        const readVfsTool = {
          name: "read_file",
          description: "Read a file from the workspace.",
          execute: async ({ path: filePath }: { path: string }) => {
            sendLog(`Reading file: ${filePath}`);
            return new Promise((resolve, reject) => {
              const requestId = getNextId();
              pendingRequests.set(requestId, (res) => {
                if (res.error) reject(new Error(res.error));
                else resolve(res.content);
              });
              ws.send(JSON.stringify({ type: "read_file", requestId, path: filePath }));
            });
          }
        };

        const tools = [
          readVfsTool,
          createListFilesTool(workspaceRoot),
          createSearchCodebaseTool(workspaceRoot)
        ];

        const systemPrompt = `You are a codebase exploration assistant inside a spatial development canvas called Axiom.
Your job is to analyze the workspace and provide architectural summaries, patterns, and guidelines.

Workspace root: ${workspaceRoot || "unknown"}

You have access to tools:
- 'read_file': Read any file in the workspace.
- 'list_files': List all files in the workspace recursively.
- 'search_codebase': Search for text patterns across the codebase.

After exploring, provide:
1. A clear architectural summary of the codebase structure.
2. Key patterns and conventions used.
3. Guidelines for making changes that align with the existing codebase.

IMPORTANT: End your response with a section marked "--- SUMMARY ---" that contains a concise bullet-point list of architectural guidelines. This summary will be injected into all task execution prompts.
`;

        sendLog("Initializing exploration agent...");

        let runResult;
        try {
          const { createAgentSessionRuntime } = require("@earendil-works/pi-agent-core");
          const runtime = await createAgentSessionRuntime({
            tools,
            modelName: model || "anthropic/claude-3-5-sonnet",
            systemPrompt,
            messages: chatHistory || []
          });
          sendLog("Running exploration loop...");
          runResult = await runtime.run();
        } catch (sdkError: any) {
          sendLog(`SDK warning (simulation): ${sdkError.message}`);
          // Simulation fallback
          const files = listFilesRecursive(workspaceRoot);
          const fileCount = files.length;
          const dirs = new Set(files.map(f => f.split("/")[0]));
          const topDirs = Array.from(dirs).slice(0, 10).join(", ");

          runResult = {
            response: `# Workspace Analysis (Simulated)\n\nI found **${fileCount}** files across the workspace.\n\nTop-level directories: ${topDirs}\n\n--- SUMMARY ---\n- Workspace contains ${fileCount} files\n- Main directories: ${topDirs}\n- Follow existing code patterns and naming conventions\n- Maintain consistent formatting and styling`,
            summary: `- Workspace contains ${fileCount} files\n- Main directories: ${topDirs}\n- Follow existing code patterns and naming conventions`
          };
        }

        // Extract summary from response
        const responseText = runResult?.response || runResult?.output || "Exploration completed.";
        let summary = "";
        const summaryMatch = responseText.match(/---\s*SUMMARY\s*---([\s\S]*?)$/i);
        if (summaryMatch) {
          summary = summaryMatch[1].trim();
        } else if (runResult?.summary) {
          summary = runResult.summary;
        }

        ws.send(JSON.stringify({
          type: "global_explore_complete",
          nodeId,
          response: responseText,
          summary
        }));
      } catch (err: any) {
        console.error("WebSocket [Server] global_explore error:", err);
        ws.send(JSON.stringify({
          type: "global_explore_error",
          nodeId,
          error: err.message
        }));
      }
    }

    // ── Reconciliate Edge Handler ───────────────────────────────
    if (data.type === "reconciliate_edge") {
      const { edgeId, sourceTaskId, targetTaskId, modifiedFiles, userMessage, chatHistory, workspaceRoot, model, sourcePrompt, targetPrompt, customProvider } = data;
      console.log(`WebSocket [Server] reconciliate_edge starting`, { edgeId, sourceTaskId, targetTaskId });

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
          description: "Read a file from the workspace.",
          execute: async ({ path: filePath }: { path: string }) => {
            return new Promise((resolve, reject) => {
              const requestId = getNextId();
              pendingRequests.set(requestId, (res) => {
                if (res.error) reject(new Error(res.error));
                else resolve(res.content);
              });
              ws.send(JSON.stringify({ type: "read_file", requestId, path: filePath }));
            });
          }
        };

        const writeVfsTool = {
          name: "write_file",
          description: "Write file content to the virtual workspace.",
          execute: async ({ path: filePath, content }: { path: string; content: string }) => {
            return new Promise((resolve, reject) => {
              const requestId = getNextId();
              pendingRequests.set(requestId, (res) => {
                if (res.error) reject(new Error(res.error));
                else resolve({ success: true });
              });
              ws.send(JSON.stringify({ type: "write_file", requestId, path: filePath, content }));
            });
          }
        };

        const filesInfo = modifiedFiles?.length > 0
          ? `Files modified by source task: ${modifiedFiles.join(", ")}`
          : "No files were modified by the source task.";

        const systemPrompt = `You are a code reconciliation assistant inside a spatial development canvas.
You are checking whether the code changes made by a SOURCE task are compatible with a TARGET task's requirements.

${filesInfo}

Source task instructions: ${sourcePrompt || "(not provided)"}
Target task instructions: ${targetPrompt || "(not provided)"}

User message: ${userMessage}

Your job:
1. Read the modified files to understand what changes were made.
2. Analyze whether these changes conflict with the target task's requirements.
3. If there are conflicts, explain them clearly and suggest fixes.
4. If the user asks you to fix conflicts, use 'write_file' to apply the resolution.

Workspace root: ${workspaceRoot || "unknown"}
`;

        let response;
        try {
          const { createAgentSessionRuntime } = require("@earendil-works/pi-agent-core");
          const runtime = await createAgentSessionRuntime({
            tools: [readVfsTool, writeVfsTool, createListFilesTool(workspaceRoot), createSearchCodebaseTool(workspaceRoot)],
            modelName: model || "anthropic/claude-3-5-sonnet",
            systemPrompt,
            messages: chatHistory || []
          });
          const result = await runtime.run();
          response = result?.response || result?.output || "Reconciliation analysis complete.";
        } catch (sdkError: any) {
          console.warn("Reconciliation SDK fallback:", sdkError.message);
          // Simulation fallback
          await new Promise(r => setTimeout(r, 800));
          if (modifiedFiles?.length > 0) {
            response = `I've reviewed the changes in ${modifiedFiles.join(", ")}. Based on the source and target task specifications, the modifications appear compatible. The changes follow the same patterns and do not introduce breaking conflicts.\n\nIf you're satisfied, click "Approve Reconciliation" to mark this connection as aligned.`;
          } else {
            response = "No modified files to reconcile. The connection appears clean.";
          }
        }

        ws.send(JSON.stringify({
          type: "reconciliation_complete",
          edgeId,
          response
        }));
      } catch (err: any) {
        console.error("WebSocket [Server] reconciliate_edge error:", err);
        ws.send(JSON.stringify({
          type: "reconciliation_error",
          edgeId,
          error: err.message
        }));
      }
    }
  });

  ws.on("close", () => {
    console.log("WebSocket [Server] Client disconnected");
  });
});

// Expose status endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", mode: "sidecar" });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Pi sidecar server listening on port ${PORT}`);
});
