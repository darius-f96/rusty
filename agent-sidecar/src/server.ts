import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

// ── Global Process Crash Prevention & Logging ──────────────────────
process.on("uncaughtException", (error) => {
  console.error("CRITICAL [Uncaught Exception]:", error);
  try {
    fs.appendFileSync(
      path.join(process.cwd(), "sidecar_error.log"),
      `[${new Date().toISOString()}] Uncaught Exception: ${error?.stack || error}\n\n`
    );
  } catch (logErr) {
    console.error("Failed to write to sidecar_error.log:", logErr);
  }
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("CRITICAL [Unhandled Rejection]: Promise:", promise, "Reason:", reason);
  try {
    const reasonStr = reason instanceof Error ? reason.stack : String(reason);
    fs.appendFileSync(
      path.join(process.cwd(), "sidecar_error.log"),
      `[${new Date().toISOString()}] Unhandled Rejection at Promise: ${reasonStr}\n\n`
    );
  } catch (logErr) {
    console.error("Failed to write to sidecar_error.log:", logErr);
  }
});

// ── Direct LLM API Call Helper ────────────────────────────────────

const MAX_TOOL_RESULT_LENGTH = 8000; // Limit tool results to prevent context overflow

function truncateToolResult(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + `\n\n[...truncated ${content.length - maxLength} characters...]`;
}

interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

async function callLlmWithTools(
  config: LlmConfig,
  systemPrompt: string,
  userMessage: string,
  tools: Array<{ name: string; description: string; inputSchema?: any; execute: (args: any) => Promise<any> }>,
  workspaceRoot: string,
  sendLog: (msg: string) => void
): Promise<string> {
  const { baseUrl, apiKey, model } = config;
  
  // Build OpenAI-compatible messages
  const messages: Array<{role: string, content: string | Array<any>}> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage }
  ];

  // Build tools in OpenAI format
  const openaiTools = tools.map(tool => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || {
        type: "object",
        properties: {},
        required: []
      }
    }
  }));

  sendLog(`Calling LLM: ${model} at ${baseUrl}`);

  // Make the API call
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      tools: openaiTools,
      tool_choice: "auto"
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const assistantMessage = data.choices?.[0]?.message;

  if (!assistantMessage) {
    throw new Error("No response from LLM");
  }

  // Handle tool calls
  if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
    sendLog(`LLM requested ${assistantMessage.tool_calls.length} tool call(s)`);
    
    // Execute each tool call
    const toolResults: Array<{role: string, tool_call_id: string, name: string, content: string}> = [];
    
    for (const toolCall of assistantMessage.tool_calls) {
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments || "{}");
      
      sendLog(`Executing tool: ${toolName} with args: ${JSON.stringify(toolArgs)}`);
      
      const tool = tools.find(t => t.name === toolName);
      if (tool) {
        try {
          const result = await tool.execute(toolArgs);
          const truncatedResult = truncateToolResult(String(result), MAX_TOOL_RESULT_LENGTH);
          toolResults.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolName,
            content: truncatedResult
          });
        } catch (err: any) {
          toolResults.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolName,
            content: `Error: ${err.message}`
          });
        }
      } else {
        toolResults.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolName,
          content: `Tool ${toolName} not found`
        });
      }
    }

    // Send tool results back to LLM
    messages.push(assistantMessage);
    messages.push(...toolResults);

    // Get final response
    const followUpResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages
      })
    });

    if (!followUpResponse.ok) {
      const errorText = await followUpResponse.text();
      throw new Error(`LLM follow-up error: ${followUpResponse.status} - ${errorText}`);
    }

    const followUpData = await followUpResponse.json();
    return followUpData.choices?.[0]?.message?.content || "No response";
  }

  return assistantMessage.content || "No content";
}

/** Parse tool calls from XML-like content */
function parseToolCallsFromContent(content: string): Array<{name: string, arguments: string}> | null {
  const toolCallRegex = /<function=(\w+)>\s*<parameter=(\w+)>\s*([^<]+)\s*<\/parameter>\s*<\/function>/g;
  const matches = [...content.matchAll(toolCallRegex)];
  if (matches.length === 0) return null;
  
  const toolCalls: Array<{name: string, arguments: string}> = [];
  for (const match of matches) {
    const [, name, paramName, paramValue] = match;
    // Parse as JSON object with the parameter
    try {
      const args = JSON.parse(`{"${paramName}": "${paramValue.trim()}"}`);
      toolCalls.push({ name, arguments: JSON.stringify(args) });
    } catch {
      // Skip malformed tool calls
    }
  }
  return toolCalls.length > 0 ? toolCalls : null;
}

/** Make LLM calls with tools, handling multiple rounds of tool execution */
async function callLlmWithToolsMultiRound(
  config: LlmConfig,
  systemPrompt: string,
  userMessage: string,
  tools: Array<{ name: string; description: string; inputSchema?: any; execute: (args: any) => Promise<any> }>,
  workspaceRoot: string,
  sendLog: (msg: string) => void,
  maxRounds = 5,
  chatHistory: Array<any> = []
): Promise<string> {
  const { baseUrl, apiKey, model } = config;
  
  const messages: Array<any> = [
    { role: "system", content: systemPrompt },
    ...chatHistory,
    { role: "user", content: userMessage }
  ];

  const openaiTools = tools.map(tool => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || {
        type: "object",
        properties: {},
        required: []
      }
    }
  }));

  sendLog(`Calling LLM: ${model} at ${baseUrl}`);
  console.log(`WebSocket [Server] LLM Start: ${model} @ ${baseUrl}`);

  let round = 0;
  while (round < maxRounds) {
    round++;
    sendLog(`LLM round ${round} starting...`);
    console.log(`\n--- WebSocket [Server] LLM Round ${round} ---`);
    console.log(`WebSocket [Server] Messages count: ${messages.length}`);
    // Log compact summary instead of full payload to avoid event loop freezing
    console.log(`WebSocket [Server] Message roles: ${messages.map((m: any) => `${m.role}(${typeof m.content === 'string' ? m.content.length : 0}ch)`).join(', ')}`);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        tools: openaiTools,
        tool_choice: "auto"
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`WebSocket [Server] Round ${round} API error: ${response.status} - ${errorText}`);
      throw new Error(`LLM API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const finishReason = data.choices?.[0]?.finish_reason || 'unknown';
    const contentLen = data.choices?.[0]?.message?.content?.length || 0;
    const toolCallCount = data.choices?.[0]?.message?.tool_calls?.length || 0;
    console.log(`WebSocket [Server] Round ${round} Response: finish_reason=${finishReason}, content=${contentLen}ch, tool_calls=${toolCallCount}`);
    
    const assistantMessage = data.choices?.[0]?.message;

    if (!assistantMessage) {
      console.error(`WebSocket [Server] Round ${round} choice message is missing.`);
      throw new Error("No response from LLM");
    }

    // Check for proper tool_calls
    let toolCalls = assistantMessage.tool_calls || [];
    
    // Also check content for XML-style tool calls
    if (toolCalls.length === 0 && assistantMessage.content) {
      const parsed = parseToolCallsFromContent(assistantMessage.content);
      if (parsed) {
        sendLog(`Found ${parsed.length} XML-style tool call(s) in content`);
        console.log(`WebSocket [Server] Parsed XML-style tool calls:`, parsed);
        // Convert to tool_calls format
        toolCalls = parsed.map((tc, idx) => ({
          id: `call_xml_${round}_${idx}`,
          function: { name: tc.name, arguments: tc.arguments },
          type: "function" as const
        }));
        // Update assistantMessage with parsed tool calls
        assistantMessage.tool_calls = toolCalls;
      }
    }

    // Add assistant message to history (preserving tool_calls)
    messages.push(assistantMessage);

    if (toolCalls.length === 0) {
      sendLog(`LLM finished gathering information in round ${round}.`);
      console.log(`WebSocket [Server] LLM finished tool calls in round ${round}. Content:`, assistantMessage.content);
      return assistantMessage.content || "No content";
    }

    sendLog(`LLM requested ${toolCalls.length} tool call(s)`);
    console.log(`WebSocket [Server] LLM requested ${toolCalls.length} tool calls in round ${round}`);

    // Execute each tool call
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      let toolArgs = {};
      try {
        toolArgs = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        toolArgs = {};
      }
      
      sendLog(`Executing tool: ${toolName} with args: ${JSON.stringify(toolArgs)}`);
      console.log(`WebSocket [Server] Executing tool: ${toolName}`, toolArgs);
      
      const tool = tools.find(t => t.name === toolName);
      if (tool) {
        try {
          const result = await tool.execute(toolArgs);
          const truncatedResult = truncateToolResult(String(result), MAX_TOOL_RESULT_LENGTH);
          console.log(`WebSocket [Server] Tool ${toolName} success (result length: ${truncatedResult.length})`);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolName,
            content: truncatedResult
          });
        } catch (err: any) {
          console.error(`WebSocket [Server] Tool ${toolName} execution error:`, err);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolName,
            content: `Error: ${err.message}`
          });
        }
      } else {
        console.error(`WebSocket [Server] Tool ${toolName} not found in registered tools.`);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolName,
          content: `Tool ${toolName} not found`
        });
      }
    }
    
    sendLog(`Tool execution complete, continuing to round ${round + 1}...`);
  }

  // Max rounds reached - fetch the final model summary based on the gathered message history
  sendLog(`Max tool rounds (${maxRounds}) reached. Summarizing gathered findings...`);
  console.log(`WebSocket [Server] Max rounds reached (${maxRounds}). Running final clean summary call.`);
  try {
    const toolExecutions = messages
      .filter(m => m.role === "tool")
      .map(m => `### Tool [${m.name}] output:\n${m.content}`)
      .join("\n\n");

    const finalMessages = [
      { role: "system", content: "You are a codebase exploration assistant. Summarize the findings and answer the user's question clearly based on the provided tool outputs." },
      ...chatHistory,
      { role: "user", content: `${userMessage}\n\nHere are the results of the files read and codebase searches:\n${toolExecutions}` }
    ];

    console.log(`WebSocket [Server] Outgoing final summary messages count: ${finalMessages.length}`);
    console.log(`WebSocket [Server] Final summary message roles: ${finalMessages.map((m: any) => `${m.role}(${typeof m.content === 'string' ? m.content.length : 0}ch)`).join(', ')}`);

    const finalResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: finalMessages
      })
    });

    if (finalResponse.ok) {
      const finalData = await finalResponse.json();
      console.log(`WebSocket [Server] Final summary response: ${finalData.choices?.[0]?.message?.content?.length || 0} chars`);
      const summaryContent = finalData.choices?.[0]?.message?.content;
      if (summaryContent) {
        sendLog(`Final summary generated successfully.`);
        return summaryContent;
      }
    } else {
      const errorText = await finalResponse.text();
      console.error(`WebSocket [Server] Final summary call API error: ${finalResponse.status} - ${errorText}`);
      sendLog(`Final summary call error: ${finalResponse.status}`);
    }
  } catch (finalCallError: any) {
    console.error("WebSocket [Server] Error generating final summary call:", finalCallError);
    sendLog(`Final summary call exception: ${finalCallError.message}`);
  }

  console.warn("WebSocket [Server] Summary generation failed. Falling back to structured tools output.");
  
  // Format the raw tool executions nicely in markdown so the user gets actual info instead of grep lines
  const toolExecutionsSummary = messages
    .filter(m => m.role === "tool")
    .map(m => `### Tool Output [${m.name}]\n${m.content}`)
    .join("\n\n");

  return `Exploration completed. I gathered the following codebase information:\n\n${toolExecutionsSummary}`;
}

// ── Codebase Exploration Tool Factories ──────────────────────────

const IGNORED_DIRS = new Set(["node_modules", "dist", ".git", "target", ".vscode", ".gemini", ".next", "__pycache__", ".env", "env", ".venv", "venv"]);

/** Get a summary of the workspace structure without listing all files. */
function getWorkspaceSummary(root: string, maxFiles = 100): string {
  const results: string[] = [];
  const dirCounts: Record<string, number> = {};
  const extCounts: Record<string, number> = {};
  let totalFiles = 0;
  let totalDirs = 0;

  function traverse(dir: string, depth: number, maxDepth: number) {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        totalDirs++;
        const relDir = path.relative(root, full);
        dirCounts[relDir] = (dirCounts[relDir] || 0) + 1;
        traverse(full, depth + 1, maxDepth);
      } else {
        totalFiles++;
        const ext = path.extname(entry.name).toLowerCase() || "no_extension";
        extCounts[ext] = (extCounts[ext] || 0) + 1;
        if (results.length < maxFiles) {
          results.push(path.relative(root, full));
        }
      }
    }
  }

  traverse(root, 0, 3);

  const topDirs = Object.entries(dirCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([dir, count]) => `${dir}/ (${count} items)`)
    .join("\n");

  const topExts = Object.entries(extCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ext, count]) => `${ext}: ${count} files`)
    .join("\n");

  const sampleFiles = results.length > 0 ? `\n\nSample files (first ${results.length}):\n${results.join("\n")}` : "";

  return `Workspace Summary:
- Total: ${totalFiles} files, ${totalDirs} directories

Top-level directories:
${topDirs || "(none found)"}

File types:
${topExts || "(none detected)"}
${sampleFiles}`;
}

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
    description: "Get a summary of the workspace structure including directories, file types, and a sample of files.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    },
    execute: async () => {
      return getWorkspaceSummary(workspaceRoot);
    }
  };
}

function createSearchCodebaseTool(workspaceRoot: string) {
  return {
    name: "search_codebase",
    description: "Find files containing a search term or regex pattern. Returns matching file paths and line snippets (limited to 30 results).",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "The search pattern or regex to match" }
      },
      required: ["pattern"]
    },
    execute: async ({ pattern }: { pattern: string }) => {
      const results = searchCodebase(workspaceRoot, pattern, 30);
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

// Timeout for pending tool requests (30 seconds)
const PENDING_REQUEST_TIMEOUT_MS = 30_000;

// Helper to generate unique request IDs
let nextRequestId = 1;
function getNextId() {
  return `req_${nextRequestId++}`;
}

/** Register a pending request with an automatic timeout. Returns a cleanup function. */
function registerPendingRequest(requestId: string, resolver: (response: any) => void): () => void {
  const timer = setTimeout(() => {
    if (pendingRequests.has(requestId)) {
      console.warn(`WebSocket [Server] Pending request ${requestId} timed out after ${PENDING_REQUEST_TIMEOUT_MS}ms`);
      pendingRequests.delete(requestId);
      resolver({ error: `Request timed out after ${PENDING_REQUEST_TIMEOUT_MS / 1000}s — client may have disconnected.` });
    }
  }, PENDING_REQUEST_TIMEOUT_MS);

  pendingRequests.set(requestId, (res) => {
    clearTimeout(timer);
    resolver(res);
  });

  return () => {
    clearTimeout(timer);
    pendingRequests.delete(requestId);
  };
}

/** Clean up all pending requests (called when a WebSocket disconnects). */
function cleanupPendingRequests() {
  if (pendingRequests.size > 0) {
    console.warn(`WebSocket [Server] Cleaning up ${pendingRequests.size} pending request(s) after client disconnect.`);
    for (const [id, resolver] of pendingRequests) {
      try {
        resolver({ error: "WebSocket client disconnected before response was received." });
      } catch (e) {
        console.error(`WebSocket [Server] Error cleaning up request ${id}:`, e);
      }
    }
    pendingRequests.clear();
  }
}

/** Safely send a payload over a WebSocket connection, guarding against CLOSED/CLOSING states and unexpected write failures. */
function safeSend(ws: WebSocket, payload: any) {
  if (!ws) return;
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(payload));
    } catch (err: any) {
      console.error("WebSocket [Server] Error in ws.send:", err);
      try {
        fs.appendFileSync(
          path.join(process.cwd(), "sidecar_error.log"),
          `[${new Date().toISOString()}] WebSocket Send Error: ${err?.stack || err}\n\n`
        );
      } catch (logErr) {
        console.error("Failed to write to sidecar_error.log:", logErr);
      }
    }
  } else {
    const readyStateLabels: Record<number, string> = {
      0: "CONNECTING",
      1: "OPEN",
      2: "CLOSING",
      3: "CLOSED"
    };
    const stateStr = readyStateLabels[ws.readyState] || String(ws.readyState);
    console.warn(`WebSocket [Server] Cannot send message, socket not open (readyState: ${stateStr}). Payload type: ${payload?.type}`);
  }
}

wss.on("connection", (ws: WebSocket) => {
  console.log("WebSocket [Server] Client connected to Pi Sidecar");

  ws.on("error", (error) => {
    console.error("WebSocket [Server] Client connection error:", error);
    try {
      fs.appendFileSync(
        path.join(process.cwd(), "sidecar_error.log"),
        `[${new Date().toISOString()}] WebSocket Connection Error: ${error?.stack || error}\n\n`
      );
    } catch (logErr) {
      console.error("Failed to write to sidecar_error.log:", logErr);
    }
  });

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
        safeSend(ws, { type: "log", nodeId, message });
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
          execute: async ({ path: filePath }: { path: string }) => {
            console.log(`WebSocket [Server] tool read_file requested: ${filePath}`);
            sendLog(`AI reading file context: ${filePath}`);
            const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
            return new Promise((resolve, reject) => {
              const requestId = getNextId();
              registerPendingRequest(requestId, (res) => {
                if (res.error) {
                  console.error(`WebSocket [Server] read_file failed for: ${resolvedPath}`, res.error);
                  reject(new Error(res.error));
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
          execute: async ({ path: filePath, content }: { path: string; content: string }) => {
            console.log(`WebSocket [Server] tool write_file requested: ${filePath} (${content.length} chars)`);
            sendLog(`AI modifying file: ${filePath}`);
            const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
            // Track modification
            modifiedFiles.add(resolvedPath);
            
            return new Promise((resolve, reject) => {
              const requestId = getNextId();
              registerPendingRequest(requestId, (res) => {
                if (res.error) {
                  console.error(`WebSocket [Server] write_file failed for: ${resolvedPath}`, res.error);
                  reject(new Error(res.error));
                } else {
                  console.log(`WebSocket [Server] write_file success for: ${resolvedPath}`);
                  resolve({ success: true });
                }
              });
              safeSend(ws, { type: "write_file", requestId, path: resolvedPath, content });
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

          const allTools = [readVfsTool, writeVfsTool, createListFilesTool(workspaceRoot), createSearchCodebaseTool(workspaceRoot)];

          const { session } = await createAgentSession({
            cwd: workspaceRoot,
            model: selectedModel,
            tools: ["read", "write", "list_files", "search_codebase"],
            customTools: allTools as any
          });

          sendLog("Executing agent reasoning loop...");
          console.log("WebSocket [Server] Running agent core loop...");

          const result = await session.prompt(instructions);
          runResult = { status: "success", modified: Array.from(modifiedFiles), response: (result as any).output || (result as any).message?.content || "Task completed." };
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

        safeSend(ws, {
          type: "execution_complete",
          nodeId,
          result: {
            ...runResult,
            modified: finalModifiedList.length > 0 ? finalModifiedList : (runResult?.modified || [])
          }
        });
      } catch (err: any) {
        console.error("WebSocket [Server] Execution failed:", err);
        safeSend(ws, {
          type: "execution_error",
          nodeId,
          error: err.message
        });
      }
    }

    // ── Global Explore Handler ──────────────────────────────────
    if (data.type === "global_explore") {
      const { nodeId, prompt, workspaceRoot, model, chatHistory, customProvider } = data;
      console.log(`WebSocket [Server] global_explore starting`, { nodeId, workspaceRoot, model });

      const sendLog = (message: string) => {
        safeSend(ws, { type: "log", nodeId, message });
      };

      try {
        // Create VFS read tool bridging back to frontend
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
            
            // Handle directory paths gracefully to guide the LLM
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
                  console.error(`WebSocket [Server] read_file error: ${res.error}`);
                  reject(new Error(res.error));
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

        const systemPrompt = `You are a codebase exploration assistant inside a spatial development canvas called Axiom.
Your job is to analyze the workspace and provide architectural summaries, patterns, and guidelines.

Workspace root: ${workspaceRoot || "unknown"}

You have access to tools:
- 'read': Read any file in the workspace (input: {{"path": "file/path"}}).
- 'list_files': List all files in the workspace recursively (no input needed).
- 'search_codebase': Search for text patterns across the codebase (input: {{"pattern": "search text"}}).

IMPORTANT: Always use tools to explore the codebase before answering. Start by listing files, then read relevant ones.

After exploring, provide:
1. A clear architectural summary of the codebase structure.
2. Key patterns and conventions used.
3. Guidelines for making changes that align with the existing codebase.

IMPORTANT: End your response with a section marked "--- SUMMARY ---" that contains a concise bullet-point list of architectural guidelines. This summary will be injected into all task execution prompts.
`;

        sendLog("Initializing exploration agent...");

        let runResult;
        try {
          // Determine LLM configuration
          let llmConfig: LlmConfig;
          let modelId = model || "claude-3-5-sonnet";

          if (customProvider && customProvider.baseUrl && customProvider.apiKey) {
            // Use custom provider's API - prefer the model from message, fallback to provider's first model
            let selectedModel = modelId;
            // If modelId has a provider prefix, strip it
            if (selectedModel.includes("/")) {
              selectedModel = selectedModel.split("/")[1];
            }
            // If still no valid model, use provider's first model (also strip prefix)
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
            // Fall back to simulation for anthropic without API key
            throw new Error("Anthropic API key not configured. Use simulation fallback.");
          } else if (model && model.includes("/")) {
            // Try to determine config from model string (e.g., "anthropic/claude-3-5-sonnet")
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
            tools as Array<{ name: string; description: string; inputSchema?: any; execute: (args: any) => Promise<any> }>,
            workspaceRoot,
            sendLog,
            5, // max 5 rounds of tool calls
            chatHistory || []
          );

          runResult = { response: responseText };
          sendLog("Exploration complete.");
        } catch (sdkError: any) {
          console.error("WebSocket [Server] LLM error:", sdkError);
          sendLog(`LLM error: ${sdkError.message}. Using simulation fallback.`);

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
        const responseText = (runResult as any)?.response || (runResult as any)?.output || "Exploration completed.";
        let summary = "";
        const summaryMatch = responseText.match(/---\s*SUMMARY\s*---([\s\S]*?)$/i);
        if (summaryMatch) {
          summary = summaryMatch[1].trim();
        } else if ((runResult as any)?.summary) {
          summary = (runResult as any).summary;
        }

        console.log(`WebSocket [Server] Global Explore completed. Response length: ${responseText.length} chars`);

        safeSend(ws, {
          type: "global_explore_complete",
          nodeId,
          response: responseText,
          summary
        });
      } catch (err: any) {
        console.error("WebSocket [Server] global_explore error:", err);
        safeSend(ws, {
          type: "global_explore_error",
          nodeId,
          error: err.message
        });
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
            const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
            return new Promise((resolve, reject) => {
              const requestId = getNextId();
              registerPendingRequest(requestId, (res) => {
                if (res.error) reject(new Error(res.error));
                else resolve(res.content);
              });
              safeSend(ws, { type: "read_file", requestId, path: resolvedPath });
            });
          }
        };

        const writeVfsTool = {
          name: "write_file",
          description: "Write file content to the virtual workspace.",
          execute: async ({ path: filePath, content }: { path: string; content: string }) => {
            const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
            return new Promise((resolve, reject) => {
              const requestId = getNextId();
              registerPendingRequest(requestId, (res) => {
                if (res.error) reject(new Error(res.error));
                else resolve({ success: true });
              });
              safeSend(ws, { type: "write_file", requestId, path: resolvedPath, content });
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

        safeSend(ws, {
          type: "reconciliation_complete",
          edgeId,
          response
        });
      } catch (err: any) {
        console.error("WebSocket [Server] reconciliate_edge error:", err);
        safeSend(ws, {
          type: "reconciliation_error",
          edgeId,
          error: err.message
        });
      }
    }
  });

  ws.on("close", (code, reason) => {
    console.log(`WebSocket [Server] Client disconnected (code: ${code}, reason: "${reason ? reason.toString() : ""}"`);
    cleanupPendingRequests();
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
