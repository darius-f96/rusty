import { useWorkspaceStore } from "../store";

// Map Monaco language string to server keys in settings
export function getLspLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const mapping: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "typescript",
    jsx: "typescript",
    mjs: "typescript",
    cjs: "typescript",
    mts: "typescript",
    cts: "typescript",
    py: "python",
    pyw: "python",
    go: "go",
    rs: "rust",
    java: "java",
    c: "c",
    h: "cpp",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    cs: "csharp",
    rb: "ruby",
    php: "php",
    lua: "lua",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    fish: "bash",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    html: "html",
    htm: "html",
    css: "css",
    scss: "css",
    sass: "css",
    less: "css",
  };
  return mapping[ext] || ext;
}

/** Set of valid LSP language keys (matches lspSettings.servers keys). */
const LSP_REGISTRY_KEYS = new Set([
  "typescript", "python", "go", "rust", "java",
  "c", "cpp", "csharp", "ruby", "php", "lua", "bash",
  "json", "yaml", "html", "css",
]);

class LspConnection {
  private socket: WebSocket | null = null;
  private isConnecting = false;
  private pendingRequests = new Map<number, { resolve: (res: any) => void; reject: (err: any) => void }>();
  private requestCounter = 0;
  private messageQueue: any[] = [];
  private activeModels = new Set<string>();

  constructor(
    public language: string,
    public workspacePath: string,
    public serverPath: string,
    public args: string[]
  ) {}

  public isOpen(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  public connect(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.isConnecting) {
      return new Promise((resolve) => {
        const check = setInterval(() => {
          if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            clearInterval(check);
            resolve();
          }
        }, 100);
      });
    }

    this.isConnecting = true;
    return new Promise<void>((resolve, reject) => {
      const argsStr = this.args.join(" ");
      const wsUrl = `ws://localhost:4000/lsp?language=${this.language}&workspacePath=${encodeURIComponent(
        this.workspacePath
      )}&serverPath=${encodeURIComponent(this.serverPath)}&args=${encodeURIComponent(argsStr)}`;

      console.log(`[LSP Client] Connecting to language server via: ${wsUrl}`);
      const socket = new WebSocket(wsUrl);
      let isOpened = false;

      socket.onopen = () => {
        isOpened = true;
        console.log(`[LSP Client] Connection established for ${this.language}`);
        this.socket = socket;
        this.isConnecting = false;

        // Initialize handshake
        this.sendRequest("initialize", {
          processId: null,
          rootPath: this.workspacePath,
          rootUri: `file://${this.workspacePath}`,
          capabilities: {
            textDocument: {
              synchronization: {
                dynamicRegistration: true,
                willSave: false,
                willSaveWaitUntil: false,
                didSave: true,
              },
              completion: { dynamicRegistration: true },
              hover: { dynamicRegistration: true },
              definition: { dynamicRegistration: true },
              references: { dynamicRegistration: true },
            },
          },
        }).then(() => {
          this.sendNotification("initialized", {});
          // Send any queued messages
          while (this.messageQueue.length > 0) {
            const queued = this.messageQueue.shift();
            this.sendRaw(queued);
          }
          resolve();
        }).catch((err) => {
          this.isConnecting = false;
          reject(err);
        });
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "lsp_message" && data.payload) {
            const payload = data.payload;
            if (payload.id !== undefined) {
              // It's a response
              const pending = this.pendingRequests.get(payload.id);
              if (pending) {
                if (payload.error) {
                  pending.reject(payload.error);
                } else {
                  pending.resolve(payload.result);
                }
                this.pendingRequests.delete(payload.id);
              }
            } else if (payload.method === "textDocument/publishDiagnostics") {
              // It's push diagnostics notification
              this.handleDiagnostics(payload.params);
            }
          }
        } catch (e) {
          console.error(`[LSP Client] Error parsing socket message:`, e);
        }
      };

      socket.onerror = (err) => {
        console.error(`[LSP Client] Error on ${this.language} socket:`, err);
        if (!isOpened) {
          this.isConnecting = false;
          reject(err);
        }
      };

      socket.onclose = () => {
        console.log(`[LSP Client] Closed connection for ${this.language}`);
        this.socket = null;
        this.isConnecting = false;
        if (!isOpened) {
          reject(new Error("Connection closed before open"));
        }
        // Reject all pending
        for (const [, pending] of this.pendingRequests) {
          pending.reject(new Error("Connection closed"));
        }
        this.pendingRequests.clear();
      };
    });
  }

  public sendRequest(method: string, params: any, timeoutMs = 800): Promise<any> {
    const id = ++this.requestCounter;
    const msg = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`LSP Request ${method} (id: ${id}) timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (res) => {
          clearTimeout(timer);
          resolve(res);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      });

      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.sendRaw(msg);
      } else {
        clearTimeout(timer);
        this.messageQueue.push(msg);
        this.connect().catch((err) => {
          this.pendingRequests.delete(id);
          reject(err);
        });
      }
    });
  }

  public sendNotification(method: string, params: any) {
    const msg = { jsonrpc: "2.0", method, params };
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.sendRaw(msg);
    } else {
      this.messageQueue.push(msg);
      this.connect().catch(() => {});
    }
  }

  private sendRaw(msg: any) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "lsp_message", payload: msg }));
    }
  }

  public openModel(uri: string, languageId: string, version: number, text: string) {
    if (this.activeModels.has(uri)) return;
    this.activeModels.add(uri);
    this.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId, version, text },
    });
  }

  public changeModel(uri: string, version: number, text: string) {
    this.sendNotification("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  public closeModel(uri: string) {
    if (!this.activeModels.has(uri)) return;
    this.activeModels.delete(uri);
    this.sendNotification("textDocument/didClose", {
      textDocument: { uri },
    });
  }

  private handleDiagnostics(params: any) {
    const { uri, diagnostics } = params;
    if (!uri) return;

    // Find active monaco editor model for this uri
    const monaco = (window as any).monaco;
    if (!monaco) return;

    const model = monaco.editor.getModel(monaco.Uri.parse(uri));
    if (!model) return;

    const markers = diagnostics.map((diag: any) => {
      // Map severity
      let severity = 1; // Hint as fallback
      if (diag.severity === 1) severity = 8; // Error
      else if (diag.severity === 2) severity = 4; // Warning
      else if (diag.severity === 3) severity = 2; // Info

      return {
        severity,
        message: diag.message,
        source: diag.source || "LSP",
        startLineNumber: diag.range.start.line + 1,
        startColumn: diag.range.start.character + 1,
        endLineNumber: diag.range.end.line + 1,
        endColumn: diag.range.end.character + 1,
      };
    });

    monaco.editor.setModelMarkers(model, "lsp", markers);
  }

  public dispose() {
    if (this.socket) {
      this.socket.close();
    }
  }
}

export class LspService {
  private static connections = new Map<string, LspConnection>();
  private static registeredProviders = new Set<string>();

  public static async ensureConnection(filePath: string): Promise<LspConnection | null> {
    const store = useWorkspaceStore.getState();
    const lspSettings = store.lspSettings;
    const workspacePath = store.rootPath;

    if (!lspSettings || !lspSettings.enabled || !workspacePath) {
      return null;
    }

    const language = getLspLanguage(filePath);
    const serverConf = lspSettings.servers?.[language];
    if (!serverConf || !serverConf.serverPath) {
      return null;
    }

    const key = `${language}:${workspacePath}`;
    let conn = this.connections.get(key);
    if (!conn) {
      conn = new LspConnection(language, workspacePath, serverConf.serverPath, serverConf.args || []);
      this.connections.set(key, conn);
    }
    try {
      await conn.connect();
      return conn;
    } catch (err) {
      console.warn(`[LSP Client] Failed to connect to server for ${language}:`, err);
      return null;
    }
  }

  public static getConnection(filePath: string): LspConnection | null {
    const store = useWorkspaceStore.getState();
    const lspSettings = store.lspSettings;
    const workspacePath = store.rootPath;

    if (!lspSettings || !lspSettings.enabled || !workspacePath) {
      return null;
    }

    const language = getLspLanguage(filePath);
    const key = `${language}:${workspacePath}`;
    const conn = this.connections.get(key);
    if (conn && conn.isOpen()) {
      return conn;
    }
    return null;
  }

  public static registerEditor(editor: any, filePath: string) {
    const monaco = (window as any).monaco;
    if (!monaco) return null;

    const model = editor.getModel();
    if (!model) return null;

    const uri = model.uri.toString();
    const languageId = model.getLanguageId();

    this.ensureConnection(filePath).then((connection) => {
      if (!connection) return;

      // Sync document open
      connection.openModel(uri, languageId, model.getVersionId(), model.getValue());

      // Sync modifications
      const changeDisposable = model.onDidChangeContent(() => {
        connection.changeModel(uri, model.getVersionId(), model.getValue());
      });

      // Track disposable on the editor object
      editor._lspDisposable = {
        dispose: () => {
          changeDisposable.dispose();
          connection.closeModel(uri);
          // Clear markers
          monaco.editor.setModelMarkers(model, "lsp", []);
        },
      };
    });

    // Make sure Monaco providers are registered globally once per language.
    // Use the LSP language key (mapped from file extension) so the registry
    // matches the lspSettings servers config.
    const lang = getLspLanguage(filePath);
    if (LSP_REGISTRY_KEYS.has(lang)) {
      this.ensureProvidersRegistered(lang);
    }
  }

  public static disposeEditor(editor: any) {
    if (editor && editor._lspDisposable) {
      editor._lspDisposable.dispose();
      delete editor._lspDisposable;
    }
  }

  private static ensureProvidersRegistered(lang: string) {
    if (this.registeredProviders.has(lang)) return;
    this.registeredProviders.add(lang);

    const monaco = (window as any).monaco;
    if (!monaco) return;

    console.log(`[LSP Service] Registering Monaco LSP providers globally for: ${lang}`);

    // Helper to map definition/reference locations
    const mapLocation = (loc: any) => {
      const targetUri = loc.uri || loc.targetUri;
      const targetRange = loc.range || loc.targetSelectionRange || loc.targetRange;
      return {
        uri: monaco.Uri.parse(targetUri),
        range: {
          startLineNumber: targetRange.start.line + 1,
          startColumn: targetRange.start.character + 1,
          endLineNumber: targetRange.end.line + 1,
          endColumn: targetRange.end.character + 1,
        },
      };
    };

    // 1. Completion Provider
    monaco.languages.registerCompletionItemProvider(lang, {
      triggerCharacters: [".", ":", "/", "@", "(", '"', "'"],
      provideCompletionItems: async (model: any, position: any) => {
        const filePath = model.uri.path;
        const conn = this.getConnection(filePath);
        if (!conn) return { suggestions: [] };

        try {
          const result = await conn.sendRequest("textDocument/completion", {
            textDocument: { uri: model.uri.toString() },
            position: { line: position.lineNumber - 1, character: position.column - 1 },
          });

          if (!result) return { suggestions: [] };

          const items = Array.isArray(result) ? result : result.items || [];
          const wordRange = model.getWordUntilPosition(position);
          const suggestions = items.map((item: any) => {
            // Map completion kind (LSP to Monaco)
            let kind = monaco.languages.CompletionItemKind.Property;
            if (item.kind >= 1 && item.kind <= 25) {
              kind = item.kind - 1;
            }

            const label = typeof item.label === "string" ? item.label : item.label.label;

            // Determine insert text: prefer textEdit, then insertText, then label
            let insertText = label;
            let range: any = {
              startLineNumber: wordRange.startLineNumber,
              startColumn: wordRange.startColumn,
              endLineNumber: wordRange.endLineNumber,
              endColumn: wordRange.endColumn,
            };

            if (item.textEdit) {
              const te = item.textEdit.newText ? item.textEdit : item.textEdit;
              const newText = te.newText || te.text || "";
              const teRange = te.range || te.replace || te.insert;
              if (newText) insertText = newText;
              if (teRange) {
                range = {
                  startLineNumber: teRange.start.line + 1,
                  startColumn: teRange.start.character + 1,
                  endLineNumber: teRange.end.line + 1,
                  endColumn: teRange.end.character + 1,
                };
              }
            } else if (item.insertText) {
              insertText = item.insertText;
            }

            // Handle snippet insert text format (LSP insertTextFormat: 2 = Snippet)
            let insertTextRules = undefined;
            if (item.insertTextFormat === 2) {
              insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
            }

            return {
              label,
              kind,
              detail: item.detail || "",
              documentation: item.documentation || "",
              insertText,
              insertTextRules,
              range,
            };
          });

          return { suggestions };
        } catch (e) {
          return { suggestions: [] };
        }
      },
    });

    // 2. Hover Provider
    monaco.languages.registerHoverProvider(lang, {
      provideHover: async (model: any, position: any) => {
        const filePath = model.uri.path;
        const conn = this.getConnection(filePath);
        if (!conn) return null;

        try {
          const result = await conn.sendRequest("textDocument/hover", {
            textDocument: { uri: model.uri.toString() },
            position: { line: position.lineNumber - 1, character: position.column - 1 },
          });

          if (!result || !result.contents) return null;

          const contents = Array.isArray(result.contents) ? result.contents : [result.contents];
          const value = contents
            .map((content: any) => {
              if (typeof content === "string") return content;
              if (content.value) return content.value;
              return "";
            })
            .join("\n\n");

          return {
            contents: [{ value }],
            range: result.range
              ? {
                  startLineNumber: result.range.start.line + 1,
                  startColumn: result.range.start.character + 1,
                  endLineNumber: result.range.end.line + 1,
                  endColumn: result.range.end.character + 1,
                }
              : undefined,
          };
        } catch (e) {
          return null;
        }
      },
    });

    // 3. Definition Provider
    monaco.languages.registerDefinitionProvider(lang, {
      provideDefinition: async (model: any, position: any) => {
        const filePath = model.uri.path;
        const conn = this.getConnection(filePath);
        if (!conn) return null;

        try {
          const result = await conn.sendRequest("textDocument/definition", {
            textDocument: { uri: model.uri.toString() },
            position: { line: position.lineNumber - 1, character: position.column - 1 },
          });

          if (!result) return null;

          if (Array.isArray(result)) {
            return result.map(mapLocation);
          }
          return mapLocation(result);
        } catch (e) {
          return null;
        }
      },
    });

    // 4. Reference Provider
    monaco.languages.registerReferenceProvider(lang, {
      provideReferences: async (model: any, position: any, context: any) => {
        const filePath = model.uri.path;
        const conn = this.getConnection(filePath);
        if (!conn) return null;

        try {
          const result = await conn.sendRequest("textDocument/references", {
            textDocument: { uri: model.uri.toString() },
            position: { line: position.lineNumber - 1, character: position.column - 1 },
            context,
          });

          if (!result || !Array.isArray(result)) return null;
          return result.map(mapLocation);
        } catch (e) {
          return null;
        }
      },
    });
  }
}
