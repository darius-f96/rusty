import { ChildProcess } from "child_process";
import { spawn } from "child_process";
import { WebSocket } from "ws";
import { LspInstaller } from "./lspInstaller";

/**
 * Parses incoming stream chunks from language server stdout/stderr 
 * according to the LSP/JSON-RPC content-length header framing.
 */
export class LspStreamParser {
  private buffer = Buffer.alloc(0);

  constructor(private onMessage: (msg: any) => void) {}

  append(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.parse();
  }

  private parse() {
    while (true) {
      const str = this.buffer.toString("utf8");
      const headerMatch = str.match(/^Content-Length:\s*(\d+)\r\n/i);
      if (!headerMatch) {
        break;
      }

      const separatorIdx = str.indexOf("\r\n\r\n");
      if (separatorIdx === -1) {
        break;
      }

      const bodyStart = separatorIdx + 4;
      const contentLength = parseInt(headerMatch[1], 10);

      if (this.buffer.length < bodyStart + contentLength) {
        break;
      }

      const bodyBuffer = this.buffer.subarray(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.subarray(bodyStart + contentLength);

      try {
        const json = JSON.parse(bodyBuffer.toString("utf8"));
        this.onMessage(json);
      } catch (err) {
        console.error("LspStreamParser [Error] Failed to parse JSON body:", err);
      }
    }
  }
}

interface ActiveServer {
  process: ChildProcess;
  parser: LspStreamParser;
  language: string;
  workspacePath: string;
  clients: Set<WebSocket>;
  exitTimeout?: NodeJS.Timeout;
}

export class LspManager {
  private static instance: LspManager;
  private activeServers = new Map<string, ActiveServer>(); // Keyed by language:workspacePath

  private constructor() {}

  public static getInstance(): LspManager {
    if (!LspManager.instance) {
      LspManager.instance = new LspManager();
    }
    return LspManager.instance;
  }

  /**
   * Helper to encode JSON object to LSP header-framed string.
   */
  public static encodeMessage(json: any): string {
    const content = JSON.stringify(json);
    return `Content-Length: ${Buffer.byteLength(content, "utf8")}\r\n\r\n${content}`;
  }

  /**
   * Spawns or returns an existing LSP process. Links the WebSocket client.
   */
  public handleConnection(
    ws: WebSocket,
    language: string,
    workspacePath: string,
    serverPath: string,
    args: string[]
  ) {
    const key = `${language}:${workspacePath}`;
    let server = this.activeServers.get(key);

    if (server) {
      console.log(`LspManager: Found existing server for ${key}`);
      if (server.exitTimeout) {
        clearTimeout(server.exitTimeout);
        server.exitTimeout = undefined;
      }
      server.clients.add(ws);
    } else {
      console.log(`LspManager: Spawning new server for ${key} using ${serverPath} with args`, args);
      this.spawnServer(ws, language, workspacePath, serverPath, args, key, false).catch((err) => {
        console.error(`LspManager [Error] Failed to spawn LSP process for ${key}:`, err);
        ws.send(JSON.stringify({ type: "lsp_error", error: err?.message || String(err) }));
        try { ws.close(); } catch {}
      });
    }

    // Setup input message forwarding from WebSocket to process stdin
    ws.on("message", (messageStr: string) => {
      try {
        const data = JSON.parse(messageStr);
        if (data.type === "lsp_message" && data.payload) {
          const encoded = LspManager.encodeMessage(data.payload);
          const active = this.activeServers.get(key) || server;
          if (active && active.process.stdin && !active.process.stdin.destroyed) {
            active.process.stdin.write(encoded);
          }
        }
      } catch (e) {
        console.error("LspManager [Error] Failed to route WebSocket message to stdin:", e);
      }
    });

    // Cleanup connection list on close
    ws.on("close", () => {
      console.log(`LspManager: WebSocket connection closed for ${key}`);
      const active = this.activeServers.get(key) || server;
      if (active) {
        active.clients.delete(ws);
        if (active.clients.size === 0) {
          // Schedule shutdown of LSP process to conserve resources after inactivity
          console.log(`LspManager: No active clients for ${key}. Scheduling shutdown in 30 seconds...`);
          active.exitTimeout = setTimeout(() => {
            console.log(`LspManager: Shutting down process for ${key} due to inactivity.`);
            if (active && active.process) {
              active.process.kill();
            }
            this.activeServers.delete(key);
          }, 30000);
        }
      }
    });
  }

  /**
   * Spawns the LSP process and wires stdout/stderr/close handlers.
   * On ENOENT (binary missing), retries once via the installer:
   *   1. detect()  -> if found on PATH/cache, retry spawn with resolved path
   *   2. install() -> download + retry spawn with resolved path
   * Progress events from install() are forwarded to the active WS client.
   */
  private async spawnServer(
    ws: WebSocket,
    language: string,
    workspacePath: string,
    serverPath: string,
    args: string[],
    key: string,
    isRetry: boolean
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;

      // Apply env overrides from a prior install receipt (e.g. JAVA_HOME pointing
      // to the correct JDK version, even if the user's env var points elsewhere).
      const envOverrides = LspInstaller.getEnvOverrides(language);
      const spawnEnv = envOverrides
        ? { ...process.env, ...envOverrides }
        : { ...process.env };

      const childProcess = spawn(serverPath, args, {
        cwd: workspacePath,
        env: spawnEnv,
        shell: true,
      });

      // If the binary is missing, spawn emits an 'error' event (not a throw).
      // On first failure, attempt detect/install then retry once. On retry
      // failure, reject so the caller can notify the client.
      childProcess.once("error", async (err: any) => {
        if (settled) return;
        settled = true;

        const isEnoent = (err && (err.code === "ENOENT" || /ENOENT/i.test(err.message || "")));
        if (isEnoent && !isRetry) {
          console.warn(`LspManager: ${serverPath} not found for ${language}. Attempting auto-install...`);
          try {
            const detected = await LspInstaller.detect(language, serverPath);
            let resolvedPath = detected.serverPath;
            if (!resolvedPath) {
              ws.send(JSON.stringify({ type: "lsp_install_start", language, message: `Auto-installing ${language} language server...` }));
              const result = await LspInstaller.install(language, (event) => {
                ws.send(JSON.stringify({ type: "lsp_install_progress", language: event.language, stage: event.stage, message: event.message }));
              });
              resolvedPath = result.serverPath;
              ws.send(JSON.stringify({ type: "lsp_install_result", language: result.language, serverPath: result.serverPath, version: result.version }));
            }
            // Retry spawn with resolved path.
            await this.spawnServer(ws, language, workspacePath, resolvedPath, args, key, true);
            resolve();
          } catch (installErr: any) {
            ws.send(JSON.stringify({ type: "lsp_install_result", language, error: installErr?.message || String(installErr) }));
            reject(installErr);
          }
        } else {
          reject(err);
        }
      });

      // Once the process emits stdout data or a close code, spawn succeeded.
      // Wire up the ActiveServer once we're confident the process is alive.
      const parser = new LspStreamParser((msg) => {
        const msgStr = JSON.stringify({ type: "lsp_message", payload: msg });
        for (const client of this.activeServers.get(key)!.clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(msgStr);
          }
        }
      });

      childProcess.stdout.on("data", (chunk: Buffer) => {
        if (!settled) {
          settled = true;
          // Register the server now that we know the process is alive.
          const newServer: ActiveServer = {
            process: childProcess,
            parser,
            language,
            workspacePath,
            clients: new Set([ws]),
          };
          this.activeServers.set(key, newServer);
          resolve();
        }
        parser.append(chunk);
      });

      childProcess.stderr.on("data", (chunk: Buffer) => {
        const stderrStr = chunk.toString("utf8");
        console.warn(`LspManager [${language} stderr]:`, stderrStr);
        const warnStr = JSON.stringify({ type: "lsp_stderr", payload: stderrStr });
        const active = this.activeServers.get(key);
        if (active) {
          for (const client of active.clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(warnStr);
            }
          }
        } else if (!settled) {
          // Still booting — send directly to the connecting client.
          ws.send(warnStr);
        }
      });

      childProcess.on("close", (code: number | null) => {
        console.log(`LspManager: Server for ${key} exited with code ${code}`);
        const active = this.activeServers.get(key);
        this.activeServers.delete(key);
        if (active) {
          for (const client of active.clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: "lsp_closed", code }));
              client.close();
            }
          }
        } else if (!settled) {
          // Process exited before any stdout — likely a startup crash.
          settled = true;
          if (!isRetry) {
            // Treat like ENOENT: maybe the binary exists but needs install/config.
            // Only auto-install if the configured path is empty or a bare name.
            this.spawnServer(ws, language, workspacePath, serverPath, args, key, true)
              .then(resolve, reject);
          } else {
            reject(new Error(`Language server exited with code ${code} before producing output`));
          }
        }
      });
    });
  }

  /**
   * Helper to query a running language server directly from agent side (semantic query).
   */
  public async queryLsp(
    language: string,
    workspacePath: string,
    serverPath: string,
    args: string[],
    method: string,
    params: any
  ): Promise<any> {
    const key = `${language}:${workspacePath}`;
    let server = this.activeServers.get(key);

    return new Promise((resolve, reject) => {
      const requestId = Math.floor(Math.random() * 1000000);
      let timeout: NodeJS.Timeout;

      // Handle raw temporary connection or reuse active
      let processToUse: ChildProcess;
      let parserToUse: LspStreamParser;

      const cleanupAndResolve = (result: any) => {
        clearTimeout(timeout);
        resolve(result);
      };

      if (server) {
        processToUse = server.process;
        parserToUse = server.parser;
        
        // Simple mock client WS registration to keep server alive
        const mockWs = {
          readyState: WebSocket.OPEN,
          send: (data: string) => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "lsp_message" && parsed.payload && parsed.payload.id === requestId) {
                cleanupAndResolve(parsed.payload.result);
              }
            } catch (e) {}
          },
          close: () => {},
          on: () => {},
        } as any as WebSocket;

        server.clients.add(mockWs);
        timeout = setTimeout(() => {
          if (server) server.clients.delete(mockWs);
          reject(new Error(`LSP query timeout for method ${method}`));
        }, 10000);

        // Send request
        const lspMsg = {
          jsonrpc: "2.0",
          id: requestId,
          method,
          params
        };
        const encoded = LspManager.encodeMessage(lspMsg);
        processToUse.stdin?.write(encoded);
      } else {
        // No server running
        reject(new Error(`LSP server is not running for ${key}. Run it via frontend tab/settings first.`));
      }
    });
  }
}
