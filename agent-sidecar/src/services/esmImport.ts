import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const nativeImport = new Function("specifier", "return import(specifier)") as <T = any>(specifier: string) => Promise<T>;

const packageEntries: Record<string, { packageName: string; entry: string }> = {
  "@earendil-works/pi-coding-agent": { packageName: "@earendil-works/pi-coding-agent", entry: "dist/index.js" },
  "@earendil-works/pi-ai": { packageName: "@earendil-works/pi-ai", entry: "dist/index.js" },
  "@earendil-works/pi-ai/compat": { packageName: "@earendil-works/pi-ai", entry: "dist/compat.js" },
  "@earendil-works/pi-agent-core": { packageName: "@earendil-works/pi-agent-core", entry: "dist/index.js" },
  "@tintinweb/pi-subagents/dist/agent-runner.js": { packageName: "@tintinweb/pi-subagents", entry: "dist/agent-runner.js" }
};

function resolveInstalledPackageEntry(specifier: string): string | undefined {
  const packageEntry = packageEntries[specifier];
  if (!packageEntry) return undefined;

  const nodeModuleRoots = [
    // Production: server.js and node_modules are staged together in the
    // Tauri resource directory.
    path.resolve(__dirname, "node_modules"),
    path.resolve(__dirname, "../../node_modules"),
    path.resolve(__dirname, "../../../agent-sidecar/node_modules"),
    path.resolve(process.cwd(), "node_modules"),
    path.resolve(process.cwd(), "agent-sidecar/node_modules")
  ];

  for (const root of nodeModuleRoots) {
    const candidate = path.join(root, packageEntry.packageName, packageEntry.entry);
    if (fs.existsSync(candidate)) return candidate;
  }

  return undefined;
}

export async function importEsm<T = any>(specifier: string): Promise<T> {
  try {
    return await nativeImport<T>(specifier);
  } catch (err) {
    const installedEntry = resolveInstalledPackageEntry(specifier);
    if (installedEntry) {
      return nativeImport<T>(pathToFileURL(installedEntry).href);
    }
    throw err;
  }
}
