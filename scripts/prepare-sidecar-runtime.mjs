import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";

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
  cp(path.join(sidecarDir, "package-lock.json"), path.join(runtimeDir, "package-lock.json")),
  cp(path.join(sidecarDir, "node_modules"), path.join(runtimeDir, "node_modules"), { recursive: true }),
]);

// Drop devDependencies (tsup/esbuild/rollup/fsevents/ts-node/typescript/...) from the
// shipped copy. They're build-time only, never imported by server.js at runtime, and
// macOS notarization rejects the app if any bundled Mach-O binary is unsigned —
// pruning avoids having to sign build tooling we don't ship on purpose.
execFileSync("npm", ["prune", "--omit=dev"], { cwd: runtimeDir, stdio: "inherit" });

// Everything left under node_modules IS shipped and loaded at runtime (native FFI/
// clipboard/terminal addons pulled in by the Copilot/Codex/Pi SDKs). Every Mach-O
// file macOS finds inside the .app must carry a valid Developer ID signature with
// the hardened runtime + secure timestamp, or notarization comes back "Invalid".
const signingIdentity = process.env.APPLE_SIGNING_IDENTITY;
if (signingIdentity) {
  execFileSync(
    path.join(rootDir, "scripts", "sign-sidecar-binaries.sh"),
    [
      runtimeDir,
      signingIdentity,
      path.join(rootDir, "src-tauri", "runtime-entitlements.plist"),
    ],
    { stdio: "inherit" },
  );
} else {
  console.warn(
    "[prepare-sidecar-runtime] APPLE_SIGNING_IDENTITY not set — skipping sidecar codesign. " +
      "Notarization will fail if this build is meant for distribution.",
  );
}
