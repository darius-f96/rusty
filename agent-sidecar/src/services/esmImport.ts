import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const nativeImport = new Function("specifier", "return import(specifier)") as <T = any>(specifier: string) => Promise<T>;

const packageEntries: Record<string, string> = {
  "@earendil-works/pi-coding-agent": "dist/index.js",
  "@earendil-works/pi-ai": "dist/index.js",
  "@earendil-works/pi-agent-core": "dist/index.js"
};

function resolveInstalledPackageEntry(specifier: string): string | undefined {
  const entry = packageEntries[specifier];
  if (!entry) return undefined;

  const nodeModuleRoots = [
    path.resolve(__dirname, "../../node_modules"),
    path.resolve(__dirname, "../../../agent-sidecar/node_modules"),
    path.resolve(process.cwd(), "node_modules"),
    path.resolve(process.cwd(), "agent-sidecar/node_modules")
  ];

  for (const root of nodeModuleRoots) {
    const candidate = path.join(root, specifier, entry);
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
