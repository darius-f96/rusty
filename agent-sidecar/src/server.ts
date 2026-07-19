/**
 * Axiom Agent Sidecar Server
 * 
 * Architectural Overview:
 * 
 *    ┌──────────────────────────────────────────────────────────┐
 *    │                      Axiom Frontend                      │
 *    └────────────────────────────┬─────────────────────────────┘
 *                                 │ (WebSocket on Port 4000)
 *                                 ▼
 *    ┌──────────────────────────────────────────────────────────┐
 *    │                   Agent Sidecar Server                   │
 *    │                                                          │
 *    │  - WebSocket connection accepts messages                 │
 *    │  - Routes message data.type to injected capability       │
 *    │                                                          │
 *    │       ┌───────────────┬────────────────────────┐         │
 *    │       │               │                        │         │
 *    │       ▼               ▼                        ▼         │
 *    │  execute_node   global_explore   reconciliate_edge       │
 *    │       │               │                        │         │
 *    │       └───────────────┼────────────────────────┘         │
 *    │                       ▼                                  │
 *    │              Core Services Layer                         │
 *    │       ┌────────────────────────────────────────┐         │
 *    │       │ - websocket (message queue & pairing)  │         │
 *    │       │ - tools (codebase search & VFS tools)  │         │
 *    │       │ - llm (chat round completion loops)    │         │
 *    │       └────────────────────────────────────────┘         │
 *    └──────────────────────────────────────────────────────────┘
 * 
 * General Functionality:
 * Initializes Express endpoints and WebSocket Server. Upon connection, it maps 
 * incoming requests to modular capabilities injected into the WebSocket event loop, 
 * communicating with VFS tools and LLM providers.
 */

import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

// Services
import { 
  pendingRequests, 
  cleanupPendingRequests, 
  safeSend 
} from "./services/websocket";

// Capabilities
import { executeNode } from "./capabilities/executeNode";
import { stopPiAgentRun } from "./services/piAgentChat";
import { globalExplore } from "./capabilities/globalExplore";
import { reconciliateEdge } from "./capabilities/reconciliateEdge";
import { reconciliateGraph } from "./capabilities/reconciliateGraph";
import { agentChat } from "./capabilities/agentChat";
import { generateSkill } from "./capabilities/generateSkill";
import { inlineChat } from "./capabilities/inlineChat";
import { generateTaskNodes, stopTaskNodeGeneration } from "./capabilities/generateTaskNodes";
import { stopCommandsForSession } from "./services/commandExecution";
import { clearCommandSession } from "./services/commandPermissions";
import { discoverProviderModels, testProviderConnection } from "./services/llmProviders";

dotenv.config();

// LSP Manager
import { LspManager } from "./services/lspManager";
import { LspInstaller } from "./services/lspInstaller";
import { getPackageSpec, listRegisteredLanguages } from "./services/lspRegistry";

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

const app = express();
app.use(cors());
app.use(express.json());

// Provider-aware endpoints keep authentication, catalog URLs, headers, and
// response normalization out of the WebView. The old generic proxy could only
// handle OpenAI-shaped providers and silently produced unusable model IDs for
// providers such as Anthropic and GitHub Models.
app.post("/llm/models", async (req, res) => {
  try {
    const models = await discoverProviderModels(req.body?.provider || {});
    res.json({ models });
  } catch (err: any) {
    console.error("LLM model discovery error:", err?.message || err);
    res.status(502).json({ error: err?.message || "Failed to fetch provider models." });
  }
});

app.post("/llm/test", async (req, res) => {
  try {
    const result = await testProviderConnection(req.body?.provider || {});
    res.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("LLM connection test error:", err?.message || err);
    res.status(502).json({ error: err?.message || "Provider connection test failed." });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
  const parsedUrl = new URL(req.url || "", "http://localhost");

  // LSP admin channel: install / detect language servers on demand.
  // NOTE: must be checked before /lsp because /lsp-admin starts with /lsp.
  if (parsedUrl.pathname.startsWith("/lsp-admin")) {
    console.log("WebSocket [LSP-Admin] Client connected");
    ws.on("message", async (messageStr: string) => {
      let data;
      try {
        data = JSON.parse(messageStr);
      } catch (e) {
        console.error("WebSocket [LSP-Admin] Invalid JSON", e);
        return;
      }

      try {
        if (data.type === "lsp_detect") {
          const { language, serverPath } = data;
          const spec = getPackageSpec(language);
          if (!spec) {
            ws.send(JSON.stringify({ type: "lsp_detect_result", language, detected: false, reason: "No registry entry" }));
            return;
          }
          const result = await LspInstaller.detect(language, serverPath || "");
          ws.send(JSON.stringify({ type: "lsp_detect_result", language, detected: result.detected, serverPath: result.serverPath, reason: result.reason }));
          return;
        }

        if (data.type === "lsp_detect_all") {
          const languages = listRegisteredLanguages();
          const results: any[] = [];
          for (const lang of languages) {
            const r = await LspInstaller.detect(lang, "");
            results.push({ language: lang, detected: r.detected, serverPath: r.serverPath });
          }
          ws.send(JSON.stringify({ type: "lsp_detect_all_result", results }));
          return;
        }

        if (data.type === "lsp_install") {
          const { language } = data;
          const spec = getPackageSpec(language);
          if (!spec) {
            ws.send(JSON.stringify({ type: "lsp_install_result", language, error: `No registry entry for language "${language}"` }));
            return;
          }
          try {
            const result = await LspInstaller.install(language, (event) => {
              ws.send(JSON.stringify({ type: "lsp_install_progress", language: event.language, stage: event.stage, message: event.message }));
            });
            ws.send(JSON.stringify({ type: "lsp_install_result", language: result.language, serverPath: result.serverPath, version: result.version }));
          } catch (err: any) {
            ws.send(JSON.stringify({ type: "lsp_install_result", language, error: err?.message || String(err) }));
          }
          return;
        }

        if (data.type === "lsp_list") {
          ws.send(JSON.stringify({ type: "lsp_list_result", languages: listRegisteredLanguages() }));
          return;
        }

        console.warn(`WebSocket [LSP-Admin] Unknown message type: ${data.type}`);
      } catch (err: any) {
        console.error(`WebSocket [LSP-Admin] Error handling ${data.type}:`, err);
      }
    });
    return;
  }

  // LSP runtime channel: connects a frontend editor to a language server process.
  if (parsedUrl.pathname.startsWith("/lsp")) {
    const language = parsedUrl.searchParams.get("language") || "";
    const workspacePath = parsedUrl.searchParams.get("workspacePath") || "";
    const serverPath = parsedUrl.searchParams.get("serverPath") || "";
    const argsStr = parsedUrl.searchParams.get("args") || "";
    let args: string[] = [];
    if (argsStr) {
      try {
        const parsedArgs = JSON.parse(argsStr);
        args = Array.isArray(parsedArgs) ? parsedArgs.map(String) : [];
      } catch {
        // Backward compatibility for older frontend builds that sent args as
        // a single space-delimited string. New builds send JSON so paths and
        // JVM arguments containing spaces survive the WebSocket URL intact.
        args = argsStr.split(" ").filter(Boolean);
      }
    }

    if (!language || !workspacePath || !serverPath) {
      console.error("WebSocket [LSP] Missing connection parameters:", { language, workspacePath, serverPath });
      ws.send(JSON.stringify({ type: "lsp_error", error: "Missing language, workspacePath or serverPath" }));
      ws.close();
      return;
    }

    console.log(`WebSocket [LSP] Client connected for ${language} in ${workspacePath}`);
    LspManager.getInstance().handleConnection(ws, language, workspacePath, serverPath, args);
    return;
  }

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

    // Pair interactive tool responses with the originating Sidecar request.
    if (data.type === "read_file_response" || data.type === "write_file_response" || data.type === "write_plan_response" || data.type === "agent_question_response" || data.type === "command_permission_response") {
      console.log(`WebSocket [Server] Resolving pending request: ${data.requestId}`, { hasError: !!data.error });
      const pending = pendingRequests.get(data.requestId);
      if (pending && (data.type !== "command_permission_response" || pending.ws === ws)) {
        pending.resolver(data);
        pendingRequests.delete(data.requestId);
      } else if (pending) {
        console.warn(`WebSocket [Server] Ignored command permission response from a different client: ${data.requestId}`);
      }
      return;
    }

    // Inject capabilities
    try {
      if (data.type === "agent_chat_stop") {
        const stopped = await stopPiAgentRun(data.tabId, "Stop requested by user; cancelling all agent tasks.");
        const stoppedCommands = stopCommandsForSession(data.tabId);
        safeSend(ws, {
          type: "agent_chat_stopped",
          tabId: data.tabId,
          stopped,
          stoppedCommands,
        });
      } else if (data.type === "inline_chat_stop") {
        const stopped = await stopPiAgentRun(data.sessionId, "Inline chat stopped by user.");
        safeSend(ws, { type: "inline_chat_stopped", sessionId: data.sessionId, stopped });
      } else if (data.type === "execute_node") {
        await executeNode(ws, data);
      } else if (data.type === "global_explore") {
        await globalExplore(ws, data);
      } else if (data.type === "reconciliate_edge") {
        await reconciliateEdge(ws, data);
      } else if (data.type === "reconciliate_graph") {
        await reconciliateGraph(ws, data);
      } else if (data.type === "agent_chat") {
        await agentChat(ws, data);
      } else if (data.type === "inline_chat") {
        await inlineChat(ws, data);
      } else if (data.type === "generate_skill") {
        await generateSkill(ws, data);
      } else if (data.type === "generate_task_nodes") {
        await generateTaskNodes(ws, data);
      } else if (data.type === "generate_task_nodes_stop") {
        const stopped = stopTaskNodeGeneration(data.requestId);
        safeSend(ws, { type: "generate_task_nodes_stopped", requestId: data.requestId, nodeId: data.nodeId, stopped });
      } else if (data.type === "command_session_close") {
        stopCommandsForSession(data.sessionId);
        clearCommandSession(data.sessionId);
      } else {
        console.warn(`WebSocket [Server] Unknown message type: ${data.type}`);
      }
    } catch (err: any) {
      console.error(`WebSocket [Server] Error executing capability for type: ${data.type}`, err);
    }
  });

  ws.on("close", (code, reason) => {
    console.log(`WebSocket [Server] Client disconnected (code: ${code}, reason: "${reason ? reason.toString() : ""}"`);
    cleanupPendingRequests(ws);
    const tabId = (ws as any).__activeAgentTabId;
    if (typeof tabId === "string") {
      void stopPiAgentRun(tabId, "Client disconnected; cancelling all agent tasks.");
      stopCommandsForSession(tabId);
    }
  });
});

// Expose health status endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    mode: "sidecar",
    nodeVersion: process.versions.node,
    execPath: process.execPath
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Pi sidecar server listening on port ${PORT} with Node ${process.versions.node} (${process.execPath})`);
});
