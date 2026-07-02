/**
 * LSP Admin Service — frontend client for the sidecar's /lsp-admin channel.
 *
 * Provides install / detect / list operations for language servers, mirroring
 * the message types handled in agent-sidecar/src/server.ts (lsp-admin route).
 * Each operation opens a short-lived WebSocket, sends a request, and resolves
 * with the first matching result message. Progress events are surfaced via
 * callbacks for install operations.
 */

export interface DetectResult {
  language: string;
  detected: boolean;
  serverPath?: string;
  reason?: string;
}

export interface InstallResult {
  language: string;
  serverPath?: string;
  version?: string;
  error?: string;
}

export interface InstallProgress {
  language: string;
  stage: string;
  message: string;
}

const ADMIN_URL = "ws://localhost:4000/lsp-admin";

/** Detect whether the server for a single language is already available. */
export function detectLspServer(
  language: string,
  serverPath: string
): Promise<DetectResult> {
  return new Promise((resolve, reject) => {
    let socket: WebSocket;
    let settled = false;
    try {
      socket = new WebSocket(ADMIN_URL);
    } catch (err) {
      reject(err);
      return;
    }

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch {}
      reject(new Error("Detect timed out"));
    }, 15000);

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "lsp_detect", language, serverPath }));
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "lsp_detect_result" && data.language === language) {
          settled = true;
          clearTimeout(timeout);
          resolve({
            language: data.language,
            detected: data.detected,
            serverPath: data.serverPath,
            reason: data.reason,
          });
          try { socket.close(); } catch {}
        }
      } catch {
        /* ignore malformed */
      }
    };

    socket.onerror = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    };

    socket.onclose = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error("Connection closed before detect result"));
      }
    };
  });
}

/** Detect all registered languages in one round-trip. */
export function detectAllLspServers(): Promise<DetectResult[]> {
  return new Promise((resolve, reject) => {
    let socket: WebSocket;
    let settled = false;
    try {
      socket = new WebSocket(ADMIN_URL);
    } catch (err) {
      reject(err);
      return;
    }

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch {}
      reject(new Error("Detect-all timed out"));
    }, 30000);

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "lsp_detect_all" }));
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "lsp_detect_all_result") {
          settled = true;
          clearTimeout(timeout);
          resolve(data.results as DetectResult[]);
          try { socket.close(); } catch {}
        }
      } catch {
        /* ignore */
      }
    };

    socket.onerror = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    };

    socket.onclose = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error("Connection closed before detect-all result"));
      }
    };
  });
}

/**
 * Install (or auto-detect) the server for a single language.
 * `onProgress` is invoked for each install_progress message from the sidecar.
 */
export function installLspServer(
  language: string,
  onProgress?: (progress: InstallProgress) => void
): Promise<InstallResult> {
  return new Promise((resolve, reject) => {
    let socket: WebSocket;
    let settled = false;
    try {
      socket = new WebSocket(ADMIN_URL);
    } catch (err) {
      reject(err);
      return;
    }

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch {}
      reject(new Error("Install timed out"));
    }, 300000); // 5 min — downloads can be slow (jdtls is ~50MB).

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "lsp_install", language }));
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "lsp_install_progress" && data.language === language) {
          onProgress?.({ language: data.language, stage: data.stage, message: data.message });
        } else if (data.type === "lsp_install_result" && data.language === language) {
          settled = true;
          clearTimeout(timeout);
          resolve({
            language: data.language,
            serverPath: data.serverPath,
            version: data.version,
            error: data.error,
          });
          try { socket.close(); } catch {}
        }
      } catch {
        /* ignore */
      }
    };

    socket.onerror = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    };

    socket.onclose = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error("Connection closed before install result"));
      }
    };
  });
}
