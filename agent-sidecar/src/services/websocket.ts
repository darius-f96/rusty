/**
 * WebSocket Service
 * 
 * Manages WebSocket messaging helpers, request tracking maps, request/response pairing via IDs,
 * safe sending utilities, and request queue cleanups on client disconnections.
 */

import { WebSocket } from "ws";
import fs from "fs";
import path from "path";

// Map to track active websocket callbacks for tool requests
export interface PendingRequest {
  resolver: (response: any) => void;
  ws: WebSocket;
}

export const pendingRequests = new Map<string, PendingRequest>();

// Timeout for pending tool requests (30 seconds)
const PENDING_REQUEST_TIMEOUT_MS = 30_000;

// Helper to generate unique request IDs
let nextRequestId = 1;
export function getNextId() {
  return `req_${nextRequestId++}`;
}

/** Register a pending request with an automatic timeout. Returns a cleanup function. */
export function registerPendingRequest(
  requestId: string,
  ws: WebSocket,
  resolver: (response: any) => void,
  timeoutMs = PENDING_REQUEST_TIMEOUT_MS
): () => void {
  const timer = setTimeout(() => {
    if (pendingRequests.has(requestId)) {
      console.warn(`WebSocket [Server] Pending request ${requestId} timed out after ${timeoutMs}ms`);
      pendingRequests.delete(requestId);
      resolver({ error: `Request timed out after ${timeoutMs / 1000}s — client may have disconnected.` });
    }
  }, PENDING_REQUEST_TIMEOUT_MS);

  pendingRequests.set(requestId, {
    resolver: (res) => {
      clearTimeout(timer);
      resolver(res);
    },
    ws,
  });

  return () => {
    clearTimeout(timer);
    pendingRequests.delete(requestId);
  };
}

/** Clean up all pending requests for a specific client socket on disconnection. */
export function cleanupPendingRequests(ws: WebSocket) {
  if (pendingRequests.size > 0) {
    const toClean: string[] = [];
    for (const [id, req] of pendingRequests) {
      if (req.ws === ws) {
        toClean.push(id);
        try {
          req.resolver({ error: "WebSocket client disconnected before response was received." });
        } catch (e) {
          console.error(`WebSocket [Server] Error cleaning up request ${id}:`, e);
        }
      }
    }
    for (const id of toClean) {
      pendingRequests.delete(id);
    }
    if (toClean.length > 0) {
      console.warn(`WebSocket [Server] Cleaned up ${toClean.length} pending request(s) for disconnected client.`);
    }
  }
}

/** Safely send a payload over a WebSocket connection, guarding against CLOSED/CLOSING states and unexpected write failures. */
export function safeSend(ws: WebSocket, payload: any) {
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
