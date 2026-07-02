import * as path from "path";
import { LspManager } from "./lspManager";

function mapExtToLang(ext: string): string {
  const mapping: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "typescript",
    jsx: "typescript",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
  };
  return mapping[ext.toLowerCase()] || ext;
}

function formatUri(uri: string, workspaceRoot: string): string {
  if (uri.startsWith("file://")) {
    const rawPath = uri.substring(7);
    return path.relative(workspaceRoot, rawPath);
  }
  return uri;
}

export function createLspTools(
  workspaceRoot: string,
  lspSettings: { enabled: boolean; servers: Record<string, { serverPath: string; args: string[] }> } | undefined,
  sendLog: (msg: string) => void
) {
  if (!lspSettings || !lspSettings.enabled) {
    return [];
  }

  const lspGetDefinitionTool = {
    name: "lsp_get_definition",
    description: "Determine the exact definition site of a symbol (class, method, variable, etc.) in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The relative or absolute path of the file containing the symbol reference." },
        line: { type: "integer", description: "The 1-based line number of the symbol reference." },
        character: { type: "integer", description: "The 1-based character position (column) of the symbol reference." }
      },
      required: ["path", "line", "character"]
    },
    execute: async ({ path: filePath, line, character }: { path: string; line: number; character: number }) => {
      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
      const ext = path.extname(resolvedPath).slice(1);
      const lang = mapExtToLang(ext);

      sendLog(`LSP: Querying definition for symbol in ${filePath} at line ${line}, col ${character}`);

      const serverConf = lspSettings.servers?.[lang];
      if (!serverConf) {
        return `LSP: Language server is not configured for '${lang}' (ext: '${ext}').`;
      }

      try {
        const result = await LspManager.getInstance().queryLsp(
          lang,
          workspaceRoot,
          serverConf.serverPath,
          serverConf.args || [],
          "textDocument/definition",
          {
            textDocument: { uri: `file://${resolvedPath}` },
            position: { line: line - 1, character: character - 1 }
          }
        );

        if (!result) {
          return "LSP: No definition found.";
        }

        const locations = Array.isArray(result) ? result : [result];
        if (locations.length === 0) {
          return "LSP: No definition found.";
        }

        const formatted = locations.map((loc: any) => {
          // Some LSP returns LocationLink object, extract targetUri & targetRange
          const uri = loc.targetUri || loc.uri;
          const range = loc.targetSelectionRange || loc.targetRange || loc.range;
          if (!uri || !range) return JSON.stringify(loc);

          const fileRel = formatUri(uri, workspaceRoot);
          const startLine = range.start.line + 1;
          const startCol = range.start.character + 1;
          return `Defined in: ${fileRel} at line ${startLine}, column ${startCol}`;
        });

        return formatted.join("\n");
      } catch (err: any) {
        return `LSP [Error]: Failed to fetch definition. ${err.message}`;
      }
    }
  };

  const lspGetReferencesTool = {
    name: "lsp_get_references",
    description: "Find all reference locations of a symbol in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The relative or absolute file path containing the symbol." },
        line: { type: "integer", description: "The 1-based line number of the symbol." },
        character: { type: "integer", description: "The 1-based character position (column) of the symbol." }
      },
      required: ["path", "line", "character"]
    },
    execute: async ({ path: filePath, line, character }: { path: string; line: number; character: number }) => {
      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
      const ext = path.extname(resolvedPath).slice(1);
      const lang = mapExtToLang(ext);

      sendLog(`LSP: Finding references for symbol in ${filePath} at line ${line}, col ${character}`);

      const serverConf = lspSettings.servers?.[lang];
      if (!serverConf) {
        return `LSP: Language server is not configured for '${lang}' (ext: '${ext}').`;
      }

      try {
        const result = await LspManager.getInstance().queryLsp(
          lang,
          workspaceRoot,
          serverConf.serverPath,
          serverConf.args || [],
          "textDocument/references",
          {
            textDocument: { uri: `file://${resolvedPath}` },
            position: { line: line - 1, character: character - 1 },
            context: { includeDeclaration: true }
          }
        );

        if (!result || !Array.isArray(result) || result.length === 0) {
          return "LSP: No references found.";
        }

        const lines = result.map((loc: any) => {
          const fileRel = formatUri(loc.uri, workspaceRoot);
          const startLine = loc.range.start.line + 1;
          const startCol = loc.range.start.character + 1;
          return `- ${fileRel} (line ${startLine}, col ${startCol})`;
        });

        return `Found ${result.length} reference(s):\n${lines.join("\n")}`;
      } catch (err: any) {
        return `LSP [Error]: Failed to find references. ${err.message}`;
      }
    }
  };

  const lspGetDiagnosticsTool = {
    name: "lsp_get_diagnostics",
    description: "Get compilation, syntax, and type check errors (diagnostics) for a specific file.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The file path to fetch diagnostics for." }
      },
      required: ["path"]
    },
    execute: async ({ path: filePath }: { path: string }) => {
      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
      const ext = path.extname(resolvedPath).slice(1);
      const lang = mapExtToLang(ext);

      sendLog(`LSP: Querying diagnostics for file ${filePath}`);

      const serverConf = lspSettings.servers?.[lang];
      if (!serverConf) {
        return `LSP: Language server is not configured for '${lang}' (ext: '${ext}').`;
      }

      try {
        // Some language servers push diagnostics automatically via textDocument/publishDiagnostics,
        // but we can query them or trigger a change/open to force diagnostics publish.
        // We'll query if the server supports diagnostic pull model (textDocument/diagnostic),
        // falling back to notification intercept if needed.
        const result = await LspManager.getInstance().queryLsp(
          lang,
          workspaceRoot,
          serverConf.serverPath,
          serverConf.args || [],
          "textDocument/diagnostic", // LSP 3.17 pull diagnostics
          {
            textDocument: { uri: `file://${resolvedPath}` }
          }
        );

        if (!result || (!result.items && !Array.isArray(result.reports))) {
          return "LSP: No diagnostics found or diagnostic pull model not supported by this server. Errors are usually reported automatically via standard syntax updates.";
        }

        const items = result.items || [];
        if (items.length === 0) {
          return "LSP: File is clean. No warnings or errors.";
        }

        const formatted = items.map((diag: any) => {
          const severityStr =
            diag.severity === 1
              ? "Error"
              : diag.severity === 2
              ? "Warning"
              : diag.severity === 3
              ? "Info"
              : "Hint";
          const startLine = diag.range.start.line + 1;
          const startCol = diag.range.start.character + 1;
          return `[${severityStr}] Line ${startLine}, col ${startCol}: ${diag.message} (${diag.code || "no-code"})`;
        });

        return `Diagnostics for ${filePath}:\n${formatted.join("\n")}`;
      } catch (err: any) {
        return `LSP [Error]: Diagnostic pull failed. ${err.message}. If the server uses push model, compile errors will be visible in the code editor tabs automatically.`;
      }
    }
  };

  return [lspGetDefinitionTool, lspGetReferencesTool, lspGetDiagnosticsTool];
}
