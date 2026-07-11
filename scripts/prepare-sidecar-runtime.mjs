import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sidecarDir = path.join(rootDir, "agent-sidecar");
const runtimeDir = path.join(rootDir, "src-tauri", "resources", "sidecar");

// The Pi runtime is loaded with dynamic ESM imports, so it cannot be folded into
// server.js by tsup. Copy the installed dependency tree beside the bundled
// server. This also preserves Pi's package-local npm shrinkwrap dependencies.
await rm(runtimeDir, { recursive: true, force: true });
await mkdir(runtimeDir, { recursive: true });

await Promise.all([
  cp(path.join(sidecarDir, "dist", "server.js"), path.join(runtimeDir, "server.js")),
  cp(path.join(sidecarDir, "package.json"), path.join(runtimeDir, "package.json")),
  cp(path.join(sidecarDir, "node_modules"), path.join(runtimeDir, "node_modules"), { recursive: true }),
]);
