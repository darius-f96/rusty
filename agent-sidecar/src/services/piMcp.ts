import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { importEsm } from "./esmImport";

export async function writeMcpConfig(workspaceRoot: string, axiomServers: any[]): Promise<boolean> {
  const mcpServers: Record<string, any> = {};

  for (const server of axiomServers || []) {
    if (server.enabled === false) continue;

    const transportType = server.transport?.type || "stdio";
    let transport: "stdio" | "streamable-http" | "sse" = "stdio";
    if (transportType === "http") {
      transport = "streamable-http";
    } else if (transportType === "sse") {
      transport = "sse";
    } else if (transportType === "stdio") {
      transport = "stdio";
    }

    const entry: any = {
      transport,
      lifecycle: "eager", // Connect auto on session start
    };

    if (transport === "stdio") {
      entry.command = server.transport.command;
      entry.args = server.transport.args || [];
      entry.env = server.transport.env || {};
    } else {
      entry.url = server.transport.url;
      const headers: Record<string, string> = {};

      if (server.auth?.type === "bearer" && server.auth.token) {
        headers["Authorization"] = `Bearer ${server.auth.token}`;
      } else if (server.auth?.type === "apiKey" && server.auth.header && server.auth.value) {
        headers[server.auth.header] = server.auth.value;
      }

      if (Object.keys(headers).length > 0) {
        entry.headers = headers;
      }
    }

    mcpServers[server.name] = entry;
  }

  const mcpDir = path.join(workspaceRoot, ".pi");
  await fs.mkdir(mcpDir, { recursive: true });
  const mcpPath = path.join(mcpDir, "mcp.json");

  if (Object.keys(mcpServers).length === 0) {
    try {
      await fs.unlink(mcpPath);
    } catch {
      // ignore
    }
    return false;
  }

  const configContent = JSON.stringify({ mcpServers }, null, 2);
  await fs.writeFile(mcpPath, configContent, "utf-8");
  return true;
}

function resolveInstalledPackageDir(packageName: string): string {
  const nodeModuleRoots = [
    path.resolve(__dirname, "../node_modules"),
    path.resolve(__dirname, "../../node_modules"),
    path.resolve(__dirname, "../../../agent-sidecar/node_modules"),
    path.resolve(process.cwd(), "node_modules"),
    path.resolve(process.cwd(), "agent-sidecar/node_modules")
  ];

  for (const root of nodeModuleRoots) {
    const packageDir = path.join(root, packageName);
    if (fsSync.existsSync(path.join(packageDir, "package.json"))) {
      return packageDir;
    }
  }

  return path.join(__dirname, "../node_modules", packageName);
}

/**
 * Loads Pi packages that extend every Axiom agent session.
 *
 * `pi-web-access` is independent of MCP configuration, so this loader must be
 * created even when the canvas has no MCP nodes. The MCP extension still reads
 * the workspace `.pi/mcp.json` written above when servers are configured.
 */
export async function getPiResourceLoader(
  workspaceRoot: string,
  appendSystemPrompt: string[] = []
): Promise<any | undefined> {
  try {
    const { DefaultResourceLoader } = await importEsm("@earendil-works/pi-coding-agent");
    const mcpExtensionPath = resolveInstalledPackageDir("pi-mcp-extension");
    const webAccessPackagePath = resolveInstalledPackageDir("pi-web-access");
    const subagentsPackagePath = resolveInstalledPackageDir("@tintinweb/pi-subagents");
    const agentDir = path.join(os.homedir(), ".pi", "agent");

    const loader = new DefaultResourceLoader({
      cwd: workspaceRoot,
      agentDir,
      additionalExtensionPaths: [mcpExtensionPath, webAccessPackagePath, subagentsPackagePath],
      appendSystemPrompt
    });
    await loader.reload();
    return loader;
  } catch (err) {
    console.error("Failed to construct Pi extension ResourceLoader:", err);
    return undefined;
  }
}
