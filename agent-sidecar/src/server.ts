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
import { globalExplore } from "./capabilities/globalExplore";
import { reconciliateEdge } from "./capabilities/reconciliateEdge";
import { agentChat } from "./capabilities/agentChat";
import { generateSkill } from "./capabilities/generateSkill";

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

    // Pair request callbacks returning from frontend VFS
    if (data.type === "read_file_response" || data.type === "write_file_response") {
      console.log(`WebSocket [Server] Resolving pending request: ${data.requestId}`, { hasError: !!data.error });
      const pending = pendingRequests.get(data.requestId);
      if (pending) {
        pending.resolver(data);
        pendingRequests.delete(data.requestId);
      }
      return;
    }

    // Inject capabilities
    try {
      if (data.type === "execute_node") {
        await executeNode(ws, data);
      } else if (data.type === "global_explore") {
        await globalExplore(ws, data);
      } else if (data.type === "reconciliate_edge") {
        await reconciliateEdge(ws, data);
      } else if (data.type === "agent_chat") {
        await agentChat(ws, data);
      } else if (data.type === "generate_skill") {
        await generateSkill(ws, data);
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
  });
});

// Expose health status endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", mode: "sidecar" });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Pi sidecar server listening on port ${PORT}`);
});
