import { ChildProcess } from "child_process";
import { spawn } from "child_process";
import { WebSocket } from "ws";
import { LspInstaller } from "./lspInstaller";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Parses incoming stream chunks from language server stdout/stderr 
 * according to the LSP/JSON-RPC content-length header framing.
 */
export class LspStreamParser {
  private buffer = Buffer.alloc(0);

  constructor(
    private onMessage: (msg: any) => void,
    private onProtocolNoise?: (noise: string) => void
  ) {}

  append(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.parse();
  }

  private parse() {
    while (true) {
      const str = this.buffer.toString("utf8");
      const headerStart = str.search(/Content-Length:\s*\d+\r\n/i);
      if (headerStart === -1) {
        // Some servers and launchers print banners/warnings to stdout before
        // switching to LSP framing. Keep a small tail in case a header is split
        // across chunks, but discard complete non-protocol noise so parsing can
        // recover for any language server.
        if (this.buffer.length > 32) {
          const noise = this.buffer.subarray(0, this.buffer.length - 32).toString("utf8");
          this.onProtocolNoise?.(noise);
          this.buffer = this.buffer.subarray(this.buffer.length - 32);
        }
        break;
      }
      if (headerStart > 0) {
        const noise = this.buffer.subarray(0, headerStart).toString("utf8");
        this.onProtocolNoise?.(noise);
        this.buffer = this.buffer.subarray(headerStart);
      }

      const framed = this.buffer.toString("utf8");
      const headerMatch = framed.match(/^Content-Length:\s*(\d+)\r\n/i);
      if (!headerMatch) {
        break;
      }

      const separatorIdx = framed.indexOf("\r\n\r\n");
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
  // Messages received before the server's stdin is ready are buffered here
  // and flushed once the ActiveServer is registered. Without this, the very
  // first `initialize` request (sent immediately after WebSocket open) is
  // silently dropped because activeServers.get(key) is still undefined —
  // the server only gets registered when it emits stdout, which it won't do
  // until it receives `initialize`. Chicken-and-egg.
  private pendingMessages = new Map<string, string[]>();

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

  private static pathToFileUri(filePath: string): string {
    let normalized = filePath.replace(/\\/g, "/");
    if (!normalized.startsWith("/")) normalized = `/${normalized}`;
    const encoded = normalized
      .split("/")
      .map((segment, index) => {
        if (index === 1 && /^[a-zA-Z]:$/.test(segment)) return segment;
        return encodeURIComponent(segment);
      })
      .join("/");
    return `file://${encoded}`;
  }

  private static javaSettings(): any {
    return {
      java: {
        import: {
          gradle: { enabled: true, wrapper: { enabled: true } },
          maven: { enabled: true },
        },
        configuration: {
          updateBuildConfiguration: "interactive",
        },
        completion: {
          enabled: true,
        },
        referencesCodeLens: {
          enabled: false,
        },
        implementationCodeLens: "none",
        signatureHelp: {
          enabled: true,
        },
        contentProvider: {
          preferred: "fernflower",
        },
      },
    };
  }

  private static javaWorkspaceConfiguration(section?: string): any {
    const settings = LspManager.javaSettings();
    if (!section) return settings;
    if (section === "java") return settings.java;
    if (section.startsWith("java.")) {
      return section
        .split(".")
        .slice(1)
        .reduce((value: any, key: string) => value?.[key], settings.java);
    }
    return {};
  }

  private static normalizeClientMessage(language: string, workspacePath: string, payload: any): any {
    if (language !== "java" || payload?.method !== "initialize") return payload;

    const rootUri = LspManager.pathToFileUri(workspacePath);
    const rootName = path.basename(workspacePath) || workspacePath;
    const params = payload.params ?? {};
    const initOptions = params.initializationOptions && typeof params.initializationOptions === "object"
      ? params.initializationOptions
      : {};

    return {
      ...payload,
      params: {
        ...params,
        rootPath: params.rootPath ?? workspacePath,
        rootUri: params.rootUri ?? rootUri,
        workspaceFolders: Array.isArray(params.workspaceFolders) && params.workspaceFolders.length > 0
          ? params.workspaceFolders
          : [{ uri: rootUri, name: rootName }],
        initializationOptions: {
          ...initOptions,
          workspaceFolders: Array.isArray(initOptions.workspaceFolders) && initOptions.workspaceFolders.length > 0
            ? initOptions.workspaceFolders
            : [rootUri],
          settings: {
            ...LspManager.javaSettings(),
            ...(initOptions.settings && typeof initOptions.settings === "object" ? initOptions.settings : {}),
          },
        },
      },
    };
  }

  private static javaWorkspaceDataDir(workspacePath: string): string {
    const hash = crypto.createHash("sha1").update(workspacePath).digest("hex").slice(0, 12);
    const base = path.basename(workspacePath).replace(/[^a-zA-Z0-9._-]/g, "_") || "workspace";
    return path.join(os.homedir(), ".rusty", "lsp", "java-workspaces", `${base}-${hash}`);
  }

  private static javaConfigurationDir(workspacePath: string): string {
    const hash = crypto.createHash("sha1").update(workspacePath).digest("hex").slice(0, 12);
    const base = path.basename(workspacePath).replace(/[^a-zA-Z0-9._-]/g, "_") || "workspace";
    return path.join(os.homedir(), ".rusty", "lsp", "java-configurations", `${base}-${hash}`);
  }

  private static prepareServerArgs(language: string, workspacePath: string, args: string[]): string[] {
    if (language !== "java") return args;

    const hasDataArg = args.some((arg) => arg === "-data" || arg === "--data" || arg.startsWith("-data="));
    const hasConfigurationAreaArg = args.some((arg) => arg.includes("-Dosgi.configuration.area="));

    const dataDir = LspManager.javaWorkspaceDataDir(workspacePath);
    const configurationDir = LspManager.javaConfigurationDir(workspacePath);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(configurationDir, { recursive: true });

    const prepared = [...args];
    if (!hasConfigurationAreaArg) {
      prepared.push(`--jvm-arg=-Dosgi.configuration.area=${configurationDir}`);
    }
    if (!hasDataArg) {
      prepared.push("-data", dataDir);
    }
    return prepared;
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
          const payload = LspManager.normalizeClientMessage(language, workspacePath, data.payload);
          const encoded = LspManager.encodeMessage(payload);
          const active = this.activeServers.get(key) || server;
          if (active && active.process.stdin && !active.process.stdin.destroyed) {
            active.process.stdin.write(encoded);
          } else {
            // Server not ready yet (still spawning / installing). Buffer the
            // message so it can be flushed to stdin once the process is alive.
            // Without this, the initial `initialize` request is lost.
            const queue = this.pendingMessages.get(key);
            if (queue) {
              queue.push(encoded);
            } else {
              this.pendingMessages.set(key, [encoded]);
            }
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
            this.pendingMessages.delete(key);
          }, 30000);
        }
      } else {
        // Server never came up — clear any buffered messages too.
        this.pendingMessages.delete(key);
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

      const spawnArgs = LspManager.prepareServerArgs(language, workspacePath, args);
      const childProcess = spawn(serverPath, spawnArgs, {
        cwd: workspacePath,
        env: spawnEnv,
        shell: process.platform === "win32",
      });
      let activeRegistered = false;

      const registerActiveServer = () => {
        if (activeRegistered) return;
        activeRegistered = true;
        const newServer: ActiveServer = {
          process: childProcess,
          parser,
          language,
          workspacePath,
          clients: new Set([ws]),
        };
        this.activeServers.set(key, newServer);

        // Flush messages that arrived while the process was starting. The
        // initialize request is one of these; waiting for stdout before
        // flushing it deadlocks normal LSP startup because servers speak only
        // after they receive initialize.
        const pending = this.pendingMessages.get(key);
        if (pending) {
          this.pendingMessages.delete(key);
          for (const encoded of pending) {
            if (childProcess.stdin && !childProcess.stdin.destroyed) {
              childProcess.stdin.write(encoded);
            }
          }
        }
      };

      // If the binary is missing, spawn emits an 'error' event (not a throw).
      // On first failure, attempt detect/install then retry once. On retry
      // failure, reject so the caller can notify the client.
      childProcess.once("error", async (err: any) => {
        if (settled) return;
        settled = true;
        this.activeServers.delete(key);

        const isEnoent = (err && (err.code === "ENOENT" || /ENOENT/i.test(err.message || "")));
        if (isEnoent && !isRetry) {
          this.detectInstallAndRetry(ws, language, workspacePath, serverPath, args, key)
            .then(resolve, reject);
        } else {
          reject(err);
        }
      });

      // Once the process emits stdout data or a close code, spawn succeeded.
      // Wire up the ActiveServer once we're confident the process is alive.
      const parser = new LspStreamParser(
        (msg) => {
          if (language === "java" && msg?.id !== undefined && msg?.method === "workspace/configuration") {
            const items: any[] = Array.isArray(msg.params?.items) ? msg.params.items : [];
            const response = {
              jsonrpc: "2.0",
              id: msg.id,
              result: items.map((item) => LspManager.javaWorkspaceConfiguration(item?.section)),
            };
            if (childProcess.stdin && !childProcess.stdin.destroyed) {
              childProcess.stdin.write(LspManager.encodeMessage(response));
            }
            return;
          }

          const msgStr = JSON.stringify({ type: "lsp_message", payload: msg });
          for (const client of this.activeServers.get(key)!.clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(msgStr);
            }
          }
        },
        (noise) => {
          const trimmed = noise.trim();
          if (trimmed) console.warn(`LspManager [${language} stdout noise]:`, trimmed);
        }
      );

      childProcess.once("spawn", () => {
        if (!settled) {
          settled = true;
          registerActiveServer();
          resolve();
        }
      });

      childProcess.stdout.on("data", (chunk: Buffer) => {
        if (!activeRegistered) {
          registerActiveServer();
        }
        if (!settled) {
          settled = true;
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
          // Process exited before any stdout — likely a startup crash or the
          // binary wasn't found. When shell:true is used, a missing binary
          // manifests as exit code 127 ("command not found") instead of a
          // Node ENOENT error, so the 'error' handler above never fires.
          settled = true;
          if (!isRetry && code === 127) {
            // Treat exit 127 as "binary not found" — attempt detect/install
            // before retrying, exactly like the ENOENT path.
            this.detectInstallAndRetry(ws, language, workspacePath, serverPath, args, key)
              .then(resolve, reject);
          } else if (!isRetry) {
            // Other exit codes: retry once with the same config in case it
            // was a transient startup issue.
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
   * Shared auto-install logic: detect the server on PATH / in cache, and if
   * not found, download + install it. Then retry the spawn with the resolved
   * path. Called from both the spawn 'error' handler (ENOENT) and the 'close'
   * handler (exit code 127 under shell:true — both mean "binary not found").
   */
  private async detectInstallAndRetry(
    ws: WebSocket,
    language: string,
    workspacePath: string,
    serverPath: string,
    args: string[],
    key: string
  ): Promise<void> {
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
    } catch (installErr: any) {
      ws.send(JSON.stringify({ type: "lsp_install_result", language, error: installErr?.message || String(installErr) }));
      throw installErr;
    }
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
