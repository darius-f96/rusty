/**
 * LSP Installer — generic install pipeline driven by lspRegistry recipes.
 *
 * Pipeline (install()):
 *   1. Validate runtime requirement (e.g. java, go, dotnet, ruby) is present.
 *   2. Resolve latest version from upstream (npm registry / GitHub API / Eclipse index).
 *   3. Dispatch by purlType to a strategy:
 *        npm     -> npm install --prefix <cache>/<lang> <pkg>@<ver> [extraPackages]
 *        github  -> HTTP download asset for current target, unpack (gz/zip), chmod +x
 *        golang  -> GOBIN=<cache>/go/bin go install <pkg>@latest
 *        gem     -> GEM_HOME=<cache>/ruby gem install <pkg>
 *        dotnet  -> dotnet tool install --tool-path <cache>/dotnet <pkg>
 *        generic -> HTTP download URL(s), unpack (tar.gz/zip)
 *   4. Resolve bin path per spec.bin mapping.
 *   5. Symlink any linkShare entries into a shared dir (jdtls plugins).
 *   6. Write receipt.json recording version + installedAt + binPath.
 *   7. Return the absolute path to the resolved executable.
 *
 * detect() first checks PATH for the configured serverPath, then the cache
 * receipt. install() is only invoked when detect() returns null.
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import https from "https";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import { createGunzip } from "zlib";
import {
  LSP_REGISTRY,
  getPackageSpec,
  AssetSpec,
  BinResolution,
  PackageSpec,
  Target,
} from "./lspRegistry";

export type ProgressStage =
  | "detecting-runtime"
  | "resolving-version"
  | "downloading"
  | "extracting"
  | "installing-deps"
  | "linking"
  | "done";

export interface ProgressEvent {
  language: string;
  stage: ProgressStage;
  message: string;
}

export type ProgressCallback = (event: ProgressEvent) => void;

export interface DetectResult {
  detected: boolean;
  serverPath?: string;
  reason?: string;
}

export interface InstallResult {
  language: string;
  serverPath: string;
  version: string;
}

interface Receipt {
  language: string;
  version: string;
  installedAt: string;
  binPath: string;
  /** Environment variables to set when spawning this server (e.g. JAVA_HOME). */
  envOverrides?: Record<string, string>;
}

const CACHE_ROOT = path.join(os.homedir(), ".axiom", "lsp");
const SHARE_ROOT = path.join(os.homedir(), ".axiom", "lsp", "share");

export class LspInstaller {
  /** Re-entrancy guard: language -> in-flight install promise. */
  private static inFlight = new Map<string, Promise<InstallResult>>();

  /**
   * Detect whether a server is already available.
   * 1. If `configuredServerPath` resolves on PATH, return it.
   * 2. If a receipt exists in the cache, return the recorded binPath.
   */
  public static async detect(
    language: string,
    configuredServerPath: string
  ): Promise<DetectResult> {
    const spec = getPackageSpec(language);
    if (!spec) {
      return { detected: false, reason: `No registry entry for language "${language}"` };
    }

    // 1. Check PATH for the configured serverPath.
    if (configuredServerPath) {
      const onPath = await this.resolveOnPath(configuredServerPath);
      if (onPath) {
        return { detected: true, serverPath: onPath };
      }
    }

    // 2. Check the cache for a prior install receipt.
    const receipt = this.readReceipt(language);
    if (receipt && fs.existsSync(receipt.binPath)) {
      // Verify the bin is executable on unix.
      try {
        if (process.platform !== "win32") {
          await fs.promises.chmod(receipt.binPath, 0o755);
        }
        return { detected: true, serverPath: receipt.binPath };
      } catch {
        // fall through
      }
    }

    return { detected: false, reason: "Not found on PATH and no cached install" };
  }

  /**
   * Install (or reuse) the server for `language`. Safe to call concurrently —
   * only one install per language runs at a time; concurrent callers await
   * the same in-flight promise.
   */
  public static async install(
    language: string,
    onProgress?: ProgressCallback
  ): Promise<InstallResult> {
    const existing = this.inFlight.get(language);
    if (existing) return existing;

    const promise = this.runInstall(language, onProgress).finally(() => {
      this.inFlight.delete(language);
    });
    this.inFlight.set(language, promise);
    return promise;
  }

  /** List all languages the registry knows about. */
  public static listLanguages(): string[] {
    return Object.keys(LSP_REGISTRY);
  }

  // ── Internals ──────────────────────────────────────────────────────

  private static async runInstall(
    language: string,
    onProgress?: ProgressCallback
  ): Promise<InstallResult> {
    const spec = getPackageSpec(language);
    if (!spec) {
      throw new Error(`No registry entry for language "${language}"`);
    }

    const cacheDir = path.join(CACHE_ROOT, language);
    const emit = (stage: ProgressStage, message: string) =>
      onProgress?.({ language, stage, message });

    // 1. Runtime requirement check.
    let runtimeEnvOverrides: Record<string, string> | undefined;
    if (spec.runtimeRequirement) {
      emit("detecting-runtime", `Checking for ${spec.runtimeRequirement.binary}...`);
      const rtResult = await this.checkRuntimeResolved(spec.runtimeRequirement);
      if (!rtResult.ok) {
        throw new Error(spec.runtimeRequirement.message);
      }
      runtimeEnvOverrides = rtResult.envOverrides;
    }

    // For "system-only" servers (clangd) with no assets, detect() is the only path.
    if (spec.purlType === "generic" && (!spec.assets || spec.assets.length === 0)) {
      throw new Error(
        spec.runtimeRequirement?.message ||
          `${spec.name} cannot be auto-installed. Please install it manually.`
      );
    }

    // 2. Resolve latest version.
    emit("resolving-version", `Resolving latest version of ${spec.name}...`);
    const version = await spec.resolveLatest();

    // Ensure cache dir exists.
    await fs.promises.mkdir(cacheDir, { recursive: true });

    // 3. Dispatch by purlType.
    let binPath: string;
    switch (spec.purlType) {
      case "npm":
        binPath = await this.installNpm(spec, version, cacheDir, emit);
        break;
      case "github":
      case "generic":
        binPath = await this.installDownload(spec, version, cacheDir, emit);
        break;
      case "golang":
        binPath = await this.installGolang(spec, cacheDir, emit);
        break;
      case "gem":
        binPath = await this.installGem(spec, cacheDir, emit);
        break;
      case "dotnet":
        binPath = await this.installDotnet(spec, cacheDir, emit);
        break;
      default:
        throw new Error(`Unsupported purlType: ${(spec as any).purlType}`);
    }

    // 5. linkShare symlinks (jdtls plugins).
    if (spec.linkShare) {
      emit("linking", `Linking shared files for ${spec.name}...`);
      await this.linkShare(spec, cacheDir);
    }

    // Make bin executable on unix.
    if (process.platform !== "win32") {
      try {
        await fs.promises.chmod(binPath, 0o755);
      } catch {
        /* best-effort */
      }
    }

    // 6. Write receipt.
    const receipt: Receipt = {
      language,
      version,
      installedAt: new Date().toISOString(),
      binPath,
      envOverrides: runtimeEnvOverrides,
    };
    this.writeReceipt(language, receipt);

    emit("done", `${spec.name} v${version} installed at ${binPath}`);
    return { language, serverPath: binPath, version };
  }

  // ── purlType strategies ────────────────────────────────────────────

  private static async installNpm(
    spec: PackageSpec,
    version: string,
    cacheDir: string,
    emit: (stage: ProgressStage, message: string) => void
  ): Promise<string> {
    emit("installing-deps", `npm install ${spec.name}@${version}${spec.extraPackages ? " " + spec.extraPackages.join(" ") : ""}...`);

    const pkgName = spec.purlId.replace(/^npm\//, "");
    const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
    const args = ["install", "--prefix", cacheDir, `${pkgName}@${version}`];
    if (spec.extraPackages && spec.extraPackages.length > 0) {
      args.push(...spec.extraPackages);
    }

    await this.runCommand(npmBin, args, { cwd: cacheDir });

    // Resolve bin: node_modules/.bin/<exec>
    const execName = Object.keys(spec.bin)[0];
    const binDir = path.join(cacheDir, "node_modules", ".bin");
    const resolved = process.platform === "win32" ? `${execName}.cmd` : execName;
    const binPath = path.join(binDir, resolved);
    if (!fs.existsSync(binPath)) {
      throw new Error(`npm install completed but ${binPath} was not created`);
    }
    return binPath;
  }

  private static async installDownload(
    spec: PackageSpec,
    version: string,
    cacheDir: string,
    emit: (stage: ProgressStage, message: string) => void
  ): Promise<string> {
    const target = this.currentTarget();
    const asset = this.pickAsset(spec.assets || [], target);
    if (!asset) {
      throw new Error(`No download asset defined for ${spec.name} on ${target}`);
    }

    const url = typeof asset.url === "function" ? asset.url(version, target) : asset.url;
    const urlBasename = path.basename(new URL(url).pathname);
    const downloadPath = path.join(cacheDir, urlBasename);

    emit("downloading", `Downloading ${urlBasename}...`);
    await this.downloadFile(url, downloadPath);

    emit("extracting", `Extracting ${urlBasename}...`);
    await this.extractArchive(downloadPath, cacheDir, asset.archive, asset.stripComponents);

    // Resolve bin from spec.bin (first entry; github/generic use asset/launcher kind).
    const execName = Object.keys(spec.bin)[0];
    const binResolution = spec.bin[execName];
    const binPath = this.resolveBinPath(binResolution, cacheDir, execName);

    // For gz (single-file) extracts, the output file is named after the asset
    // (e.g. "rust-analyzer-aarch64-apple-darwin"), not the expected bin name.
    // Rename it to match the expected bin path.
    if (!fs.existsSync(binPath) && asset.archive === "gz") {
      const extractedPath = downloadPath.replace(/\.gz$/i, "");
      if (fs.existsSync(extractedPath) && path.resolve(extractedPath) !== path.resolve(binPath)) {
        await fs.promises.rename(extractedPath, binPath);
      }
    }

    if (!fs.existsSync(binPath)) {
      throw new Error(`Extraction completed but expected bin ${binPath} was not found`);
    }
    return binPath;
  }

  private static async installGolang(
    spec: PackageSpec,
    cacheDir: string,
    emit: (stage: ProgressStage, message: string) => void
  ): Promise<string> {
    const goBin = process.platform === "win32" ? "go.exe" : "go";
    const gopath = path.join(cacheDir, "go");
    const gobin = path.join(gopath, "bin");
    await fs.promises.mkdir(gobin, { recursive: true });

    const execName = Object.keys(spec.bin)[0];
    const resolution = spec.bin[execName];
    if (resolution.kind !== "golang") {
      throw new Error(`Expected golang bin resolution for ${spec.name}`);
    }
    emit("installing-deps", `go install ${resolution.pkg}@latest...`);
    await this.runCommand(goBin, ["install", `${resolution.pkg}@latest`], {
      cwd: cacheDir,
      env: { ...process.env, GOBIN: gobin, GOPATH: gopath },
    });

    const resolved = process.platform === "win32" ? `${execName}.exe` : execName;
    const binPath = path.join(gobin, resolved);
    if (!fs.existsSync(binPath)) {
      throw new Error(`go install completed but ${binPath} was not found`);
    }
    return binPath;
  }

  private static async installGem(
    spec: PackageSpec,
    cacheDir: string,
    emit: (stage: ProgressStage, message: string) => void
  ): Promise<string> {
    const gemBin = process.platform === "win32" ? "gem.bat" : "gem";
    const gemHome = path.join(cacheDir, "ruby");
    await fs.promises.mkdir(gemHome, { recursive: true });

    const execName = Object.keys(spec.bin)[0];
    const resolution = spec.bin[execName];
    if (resolution.kind !== "gem") {
      throw new Error(`Expected gem bin resolution for ${spec.name}`);
    }
    emit("installing-deps", `gem install ${resolution.pkg}...`);
    await this.runCommand(gemBin, ["install", resolution.pkg, "--no-document"], {
      cwd: cacheDir,
      env: { ...process.env, GEM_HOME: gemHome },
    });

    const binDir = path.join(gemHome, "bin");
    const resolved = process.platform === "win32" ? `${execName}.bat` : execName;
    const binPath = path.join(binDir, resolved);
    if (!fs.existsSync(binPath)) {
      // Some gems install under wrappers; fallback to a glob.
      const alt = path.join(binDir, `${execName}`);
      if (fs.existsSync(alt)) return alt;
      throw new Error(`gem install completed but ${binPath} was not found`);
    }
    return binPath;
  }

  private static async installDotnet(
    spec: PackageSpec,
    cacheDir: string,
    emit: (stage: ProgressStage, message: string) => void
  ): Promise<string> {
    const dotnetBin = process.platform === "win32" ? "dotnet.exe" : "dotnet";
    const toolPath = path.join(cacheDir, "dotnet");
    await fs.promises.mkdir(toolPath, { recursive: true });

    const execName = Object.keys(spec.bin)[0];
    const resolution = spec.bin[execName];
    if (resolution.kind !== "dotnet") {
      throw new Error(`Expected dotnet bin resolution for ${spec.name}`);
    }
    emit("installing-deps", `dotnet tool install ${resolution.pkg}...`);
    await this.runCommand(dotnetBin, ["tool", "install", "--tool-path", toolPath, resolution.pkg], {
      cwd: cacheDir,
    });

    const resolved = process.platform === "win32" ? `${execName}.exe` : execName;
    const binPath = path.join(toolPath, resolved);
    if (!fs.existsSync(binPath)) {
      throw new Error(`dotnet tool install completed but ${binPath} was not found`);
    }
    return binPath;
  }

  // ── Platform / asset helpers ───────────────────────────────────────

  private static currentTarget(): Target {
    const platform = process.platform;
    const arch = process.arch;
    if (platform === "darwin" && arch === "arm64") return "darwin_arm64";
    if (platform === "darwin" && arch === "x64") return "darwin_x64";
    if (platform === "linux" && arch === "x64") {
      // Distinguish gnu/musl by checking for glibc — default to gnu (vast majority).
      return "linux_x64_gnu";
    }
    if (platform === "linux" && arch === "arm64") return "linux_arm64_gnu";
    if (platform === "win32" && arch === "x64") return "win_x64";
    if (platform === "win32" && arch === "arm64") return "win_arm64";
    throw new Error(`Unsupported platform: ${platform}-${arch}`);
  }

  private static pickAsset(assets: AssetSpec[], target: Target): AssetSpec | null {
    // First match wins, considering platform groups.
    for (const asset of assets) {
      for (const t of asset.targets) {
        if (t === target) return asset;
        if (t === "unix" && (target.startsWith("darwin") || target.startsWith("linux"))) return asset;
        if (t === "win" && target.startsWith("win")) return asset;
        if (t === "linux" && target.startsWith("linux")) return asset;
      }
    }
    return null;
  }

  private static resolveBinPath(
    resolution: BinResolution,
    cacheDir: string,
    execName: string
  ): string {
    switch (resolution.kind) {
      case "asset":
      case "launcher":
        return path.join(cacheDir, resolution.path);
      case "npm": {
        const binDir = path.join(cacheDir, "node_modules", ".bin");
        const resolved = process.platform === "win32" ? `${execName}.cmd` : execName;
        return path.join(binDir, resolved);
      }
      case "golang": {
        const gobin = path.join(cacheDir, "go", "bin");
        const resolved = process.platform === "win32" ? `${execName}.exe` : execName;
        return path.join(gobin, resolved);
      }
      case "gem": {
        const resolved = process.platform === "win32" ? `${execName}.bat` : execName;
        return path.join(cacheDir, "ruby", "bin", resolved);
      }
      case "dotnet": {
        const resolved = process.platform === "win32" ? `${execName}.exe` : execName;
        return path.join(cacheDir, "dotnet", resolved);
      }
      default:
        throw new Error(`Unsupported bin resolution kind: ${(resolution as any).kind}`);
    }
  }

  // ── Download / extract ─────────────────────────────────────────────

  private static downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(destPath);
      const handler = (res: import("http").IncomingMessage) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Follow redirect.
          file.close();
          fs.unlink(destPath, () => {});
          this.downloadFile(res.headers.location, destPath).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(destPath, () => {});
          reject(new Error(`Download failed: ${url} returned ${res.statusCode}`));
          return;
        }
        pipeline(res, file).then(resolve, reject);
      };
      https.get(url, handler).on("error", (err) => {
        file.close();
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });
  }

  private static async extractArchive(
    archivePath: string,
    destDir: string,
    format: "tar.gz" | "gz" | "zip" | "none",
    stripComponents?: number
  ): Promise<void> {
    if (format === "none") {
      // Single-file download (already at archivePath); nothing to extract.
      return;
    }

    if (format === "gz") {
      // Single-file gzip (e.g. rust-analyzer). Decompress to the same name without .gz.
      const outPath = archivePath.replace(/\.gz$/i, "");
      await pipeline(
        fs.createReadStream(archivePath),
        createGunzip(),
        fs.createWriteStream(outPath)
      );
      await fs.promises.unlink(archivePath);
      return;
    }

    if (format === "tar.gz") {
      // Use system tar (available on macOS/Linux; bundled on Windows 10+).
      const tarArgs = ["-xzf", archivePath, "-C", destDir];
      if (stripComponents && stripComponents > 0) {
        tarArgs.splice(1, 0, `--strip-components=${stripComponents}`);
      }
      await this.runCommand("tar", tarArgs, { cwd: destDir });
      await fs.promises.unlink(archivePath);
      return;
    }

    if (format === "zip") {
      // Use system unzip on unix, PowerShell Expand-Archive on Windows.
      if (process.platform === "win32") {
        await this.runCommand("powershell.exe", [
          "-NoProfile",
          "-Command",
          `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force`,
        ]);
      } else {
        await this.runCommand("unzip", ["-o", archivePath, "-d", destDir]);
      }
      await fs.promises.unlink(archivePath);
      return;
    }
  }

  // ── Runtime detection ──────────────────────────────────────────────

  private static async checkRuntime(req: {
    binary: string;
    envVar?: string;
    minMajor?: number;
  }): Promise<boolean> {
    const result = await this.checkRuntimeResolved(req);
    return result.ok;
  }

  /**
   * Like checkRuntime, but returns the resolved binary path and derived
   * envOverrides (e.g. { JAVA_HOME: "..." }) so the caller can persist
   * them for later use when spawning the server.
   */
  private static async checkRuntimeResolved(req: {
    binary: string;
    envVar?: string;
    minMajor?: number;
  }): Promise<{ ok: boolean; resolvedPath?: string; envOverrides?: Record<string, string> }> {
    // Collect candidate binaries: envVar-resolved first, then PATH.
    const candidates: string[] = [];
    if (req.envVar && process.env[req.envVar]) {
      const candidate = path.join(process.env[req.envVar]!, "bin", req.binary);
      if (fs.existsSync(candidate)) candidates.push(candidate);
    }

    const onPath = await this.resolveOnPath(req.binary);
    if (onPath) candidates.push(onPath);

    if (candidates.length === 0) return { ok: false };

    // If no version requirement, any candidate suffices.
    if (req.minMajor === undefined) return { ok: true, resolvedPath: candidates[0] };

    // Try each candidate until one satisfies the version requirement.
    for (const candidate of candidates) {
      try {
        const out = await this.runCommandCapture(candidate, ["--version"]);
        const match = out.match(/(\d+)\./);
        if (match && parseInt(match[1], 10) >= req.minMajor) {
          // Derive envOverrides: if the winning binary is NOT the envVar-resolved
          // one, set the env var to the correct JAVA_HOME so the server uses the
          // right runtime at spawn time.
          const envOverrides: Record<string, string> = {};
          if (req.envVar) {
            const expectedPath = process.env[req.envVar]
              ? path.join(process.env[req.envVar]!, "bin", req.binary)
              : null;
            if (expectedPath !== candidate) {
              // Derive JAVA_HOME from the binary path: .../bin/java -> ...
              const homeDir = path.dirname(path.dirname(candidate));
              envOverrides[req.envVar] = homeDir;
            }
          }
          return { ok: true, resolvedPath: candidate, envOverrides };
        }
      } catch {
        // This candidate failed; try the next one.
      }
    }
    return { ok: false };
  }

  // ── linkShare ──────────────────────────────────────────────────────

  private static async linkShare(spec: PackageSpec, cacheDir: string): Promise<void> {
    if (!spec.linkShare) return;
    await fs.promises.mkdir(SHARE_ROOT, { recursive: true });
    for (const [target, source] of Object.entries(spec.linkShare)) {
      const targetPath = path.join(SHARE_ROOT, target);
      const sourcePath = path.join(cacheDir, source);
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      if (fs.existsSync(targetPath)) {
        await fs.promises.rm(targetPath, { recursive: true, force: true });
      }
      try {
        await fs.promises.symlink(sourcePath, targetPath);
      } catch {
        // Symlink may fail on Windows without dev mode; ignore (jdtls reads from cache directly).
      }
    }
  }

  // ── Receipts ───────────────────────────────────────────────────────

  private static receiptPath(language: string): string {
    return path.join(CACHE_ROOT, language, "receipt.json");
  }

  private static readReceipt(language: string): Receipt | null {
    try {
      const p = this.receiptPath(language);
      if (!fs.existsSync(p)) return null;
      const data = fs.readFileSync(p, "utf8");
      return JSON.parse(data) as Receipt;
    } catch {
      return null;
    }
  }

  /**
   * Read envOverrides from a prior install receipt (e.g. { JAVA_HOME: "..." }).
   * Used by LspManager when spawning a server to ensure the correct runtime
   * is used even if the user's JAVA_HOME points to an older JDK.
   */
  public static getEnvOverrides(language: string): Record<string, string> | null {
    const receipt = this.readReceipt(language);
    return receipt?.envOverrides || null;
  }

  private static writeReceipt(language: string, receipt: Receipt): void {
    try {
      const p = this.receiptPath(language);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(receipt, null, 2));
    } catch (err) {
      console.warn(`[LSP Installer] Failed to write receipt for ${language}:`, err);
    }
  }

  // ── PATH resolution / command exec ─────────────────────────────────

  private static async resolveOnPath(binary: string): Promise<string | null> {
    // If it's already an absolute path and exists, use it directly.
    if (path.isAbsolute(binary) && fs.existsSync(binary)) {
      return binary;
    }
    return new Promise((resolve) => {
      const cmd = process.platform === "win32" ? "where" : "which";
      const child = spawn(cmd, [binary], { stdio: ["ignore", "pipe", "ignore"] });
      let stdout = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.on("close", (code) => {
        if (code === 0) {
          const resolved = stdout.trim().split(/\r?\n/)[0];
          resolve(resolved || null);
        } else {
          resolve(null);
        }
      });
      child.on("error", () => resolve(null));
    });
  }

  private static runCommand(
    command: string,
    args: string[],
    options?: { cwd?: string; env?: NodeJS.ProcessEnv }
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options?.cwd,
        env: options?.env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      });
      let stderr = "";
      child.stderr?.on("data", (d) => (stderr += d.toString()));
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Command "${command} ${args.join(" ")}" exited with code ${code}\n${stderr}`));
      });
      child.on("error", reject);
    });
  }

  private static runCommandCapture(
    command: string,
    args: string[]
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d) => (stdout += d.toString()));
      child.stderr?.on("data", (d) => (stderr += d.toString()));
      child.on("close", (code) => {
        if (code === 0) resolve(`${stdout}\n${stderr}`);
        else reject(new Error(`Command "${command} ${args.join(" ")}" exited ${code}\n${stderr}`));
      });
      child.on("error", reject);
    });
  }
}
