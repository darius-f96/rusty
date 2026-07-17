/**
 * Transactional build verification for reconciled VFS changes.
 *
 * Reconciliation keeps its edits in the frontend-owned VFS until the user
 * chooses Apply Axiom. To verify those edits without applying them, this
 * service snapshots the corresponding physical files, overlays the VFS
 * contents just long enough to run a detected build command, and restores the
 * physical workspace in a finally block.
 */
import path from "node:path";
import type { Dirent } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  readdir,
  rmdir,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import type { NormalizedCommand } from "./commandPermissions";
import { executeCommand, type CommandResult } from "./commandExecution";

export interface ReconciliationVerificationFile {
  /** Absolute path used to address the frontend VFS. */
  vfsPath: string;
  /** Canonical, workspace-contained physical path used for the temporary overlay. */
  physicalPath: string;
  content: string;
}

export interface DetectedBuildCommand {
  program: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

export interface BuildExecutionOutcome {
  result?: CommandResult;
  error?: Error;
}

export class WorkspaceRollbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceRollbackError";
  }
}

interface FileSnapshot extends ReconciliationVerificationFile {
  existed: boolean;
  originalContent?: Buffer;
  originalMode?: number;
  originalAtime?: Date;
  originalMtime?: Date;
}

const BUILD_TIMEOUT_MS = 15 * 60_000;
const workspaceVerificationQueues = new Map<string, Promise<void>>();

function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function assertInsideWorkspace(workspaceRoot: string, candidate: string): void {
  const relative = path.relative(workspaceRoot, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Verification file must remain inside the workspace: ${candidate}`);
  }
}

/** Resolve existing symlinks while also supporting VFS files that do not exist yet. */
async function resolveWorkspaceFile(workspaceRoot: string, filePath: string): Promise<string> {
  const requestedPath = path.resolve(workspaceRoot, filePath);
  assertInsideWorkspace(workspaceRoot, requestedPath);

  try {
    const canonicalPath = await realpath(requestedPath);
    assertInsideWorkspace(workspaceRoot, canonicalPath);
    return canonicalPath;
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }

  let existingAncestor = path.dirname(requestedPath);
  while (existingAncestor !== workspaceRoot) {
    try {
      const canonicalAncestor = await realpath(existingAncestor);
      assertInsideWorkspace(workspaceRoot, canonicalAncestor);
      return path.join(canonicalAncestor, path.relative(existingAncestor, requestedPath));
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      existingAncestor = path.dirname(existingAncestor);
    }
  }

  return requestedPath;
}

/**
 * Validate file paths and collect their current VFS contents before any
 * physical workspace mutation occurs.
 */
export async function prepareReconciliationVerificationFiles(
  workspaceRoot: string,
  filePaths: string[],
  readVfsFile: (absolutePath: string) => Promise<string>,
): Promise<{ workspaceRoot: string; files: ReconciliationVerificationFile[] }> {
  const requestedRoot = path.resolve(workspaceRoot);
  const canonicalRoot = await realpath(workspaceRoot);
  const resolved = new Map<string, { vfsPath: string; physicalPath: string }>();

  for (const filePath of filePaths) {
    if (typeof filePath !== "string" || !filePath.trim() || filePath.includes("\0")) continue;
    const vfsPath = path.resolve(requestedRoot, filePath);
    assertInsideWorkspace(requestedRoot, vfsPath);
    const physicalCandidate = path.resolve(canonicalRoot, path.relative(requestedRoot, vfsPath));
    const physicalPath = await resolveWorkspaceFile(canonicalRoot, physicalCandidate);
    if (!resolved.has(physicalPath)) resolved.set(physicalPath, { vfsPath, physicalPath });
  }

  const files = await Promise.all(Array.from(resolved.values()).map(async (file) => ({
    ...file,
    content: await readVfsFile(file.vfsPath),
  })));

  return { workspaceRoot: canonicalRoot, files };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

function candidateProjectDirectories(
  workspaceRoot: string,
  files: ReconciliationVerificationFile[],
): string[] {
  const candidates = new Set<string>([workspaceRoot]);
  for (const file of files) {
    let directory = path.dirname(file.physicalPath);
    while (directory !== workspaceRoot) {
      candidates.add(directory);
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return Array.from(candidates).sort((left, right) => {
    const leftDepth = path.relative(workspaceRoot, left).split(path.sep).filter(Boolean).length;
    const rightDepth = path.relative(workspaceRoot, right).split(path.sep).filter(Boolean).length;
    return leftDepth - rightDepth || left.localeCompare(right);
  });
}

async function projectFileContent(
  filePath: string,
  overlays: Map<string, string>,
): Promise<string | undefined> {
  if (overlays.has(filePath)) return overlays.get(filePath);
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

async function detectPackageBuild(
  directory: string,
  overlays: Map<string, string>,
): Promise<DetectedBuildCommand | undefined> {
  const packageJsonPath = path.join(directory, "package.json");
  const packageJsonText = await projectFileContent(packageJsonPath, overlays);
  if (packageJsonText === undefined) return undefined;

  let packageJson: any;
  try {
    packageJson = JSON.parse(packageJsonText);
  } catch (error: any) {
    throw new Error(`Cannot verify the build because ${packageJsonPath} is invalid JSON: ${error.message}`);
  }
  if (typeof packageJson?.scripts?.build !== "string" || !packageJson.scripts.build.trim()) return undefined;

  const declaredManager = typeof packageJson.packageManager === "string"
    ? packageJson.packageManager.split("@")[0]
    : "";
  let program = ["npm", "pnpm", "yarn", "bun"].includes(declaredManager) ? declaredManager : "";
  if (!program) {
    if (await pathExists(path.join(directory, "pnpm-lock.yaml"))) program = "pnpm";
    else if (await pathExists(path.join(directory, "yarn.lock"))) program = "yarn";
    else if (await pathExists(path.join(directory, "bun.lock")) || await pathExists(path.join(directory, "bun.lockb"))) program = "bun";
    else program = "npm";
  }

  return { program, args: ["run", "build"], cwd: directory, timeoutMs: BUILD_TIMEOUT_MS };
}

/** Detect a conservative, non-interactive build command for the affected project. */
export async function detectBuildCommand(
  workspaceRoot: string,
  files: ReconciliationVerificationFile[],
): Promise<DetectedBuildCommand | undefined> {
  const overlays = new Map(files.map((file) => [file.physicalPath, file.content]));
  const candidates = candidateProjectDirectories(workspaceRoot, files);

  for (const directory of candidates) {
    const packageBuild = await detectPackageBuild(directory, overlays);
    if (packageBuild) return packageBuild;

    if (await pathExists(path.join(directory, "Cargo.toml"))) {
      return { program: "cargo", args: ["build"], cwd: directory, timeoutMs: BUILD_TIMEOUT_MS };
    }
    if (await pathExists(path.join(directory, "go.mod"))) {
      return { program: "go", args: ["build", "./..."], cwd: directory, timeoutMs: BUILD_TIMEOUT_MS };
    }
    if (await pathExists(path.join(directory, "pom.xml"))) {
      const wrapper = process.platform === "win32" ? "mvnw.cmd" : "mvnw";
      const wrapperPath = path.join(directory, wrapper);
      return {
        program: await pathExists(wrapperPath) ? wrapperPath : "mvn",
        args: ["-DskipTests", "package"],
        cwd: directory,
        timeoutMs: BUILD_TIMEOUT_MS,
      };
    }
    if (await pathExists(path.join(directory, "build.gradle")) || await pathExists(path.join(directory, "build.gradle.kts"))) {
      const wrapper = process.platform === "win32" ? "gradlew.bat" : "gradlew";
      const wrapperPath = path.join(directory, wrapper);
      return {
        program: await pathExists(wrapperPath) ? wrapperPath : "gradle",
        args: ["build", "--no-daemon"],
        cwd: directory,
        timeoutMs: BUILD_TIMEOUT_MS,
      };
    }

    let directoryEntries: Dirent[] = [];
    try {
      directoryEntries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
    if (directoryEntries.some((entry) => entry.isFile() && (entry.name.endsWith(".sln") || entry.name.endsWith(".csproj")))) {
      return { program: "dotnet", args: ["build"], cwd: directory, timeoutMs: BUILD_TIMEOUT_MS };
    }

    const makefilePath = path.join(directory, "Makefile");
    const makefile = await projectFileContent(makefilePath, overlays);
    if (makefile && /^build\s*:/m.test(makefile)) {
      return { program: "make", args: ["build"], cwd: directory, timeoutMs: BUILD_TIMEOUT_MS };
    }
  }

  return undefined;
}

async function withWorkspaceVerificationLock<T>(workspaceRoot: string, action: () => Promise<T>): Promise<T> {
  const previous = workspaceVerificationQueues.get(workspaceRoot) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.catch(() => {}).then(() => current);
  workspaceVerificationQueues.set(workspaceRoot, queued);

  await previous.catch(() => {});
  try {
    return await action();
  } finally {
    release();
    if (workspaceVerificationQueues.get(workspaceRoot) === queued) {
      workspaceVerificationQueues.delete(workspaceRoot);
    }
  }
}

async function snapshotFiles(files: ReconciliationVerificationFile[]): Promise<FileSnapshot[]> {
  return Promise.all(files.map(async (file) => {
    try {
      const fileStat = await stat(file.physicalPath);
      if (!fileStat.isFile()) throw new Error(`Verification path is not a regular file: ${file.physicalPath}`);
      return {
        ...file,
        existed: true,
        originalContent: await readFile(file.physicalPath),
        originalMode: fileStat.mode,
        originalAtime: fileStat.atime,
        originalMtime: fileStat.mtime,
      };
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      return { ...file, existed: false };
    }
  }));
}

async function collectMissingDirectories(workspaceRoot: string, snapshots: FileSnapshot[]): Promise<Set<string>> {
  const missing = new Set<string>();
  for (const snapshot of snapshots) {
    let directory = path.dirname(snapshot.physicalPath);
    while (directory !== workspaceRoot) {
      if (await pathExists(directory)) break;
      missing.add(directory);
      directory = path.dirname(directory);
    }
  }
  return missing;
}

async function restoreWorkspace(
  snapshots: FileSnapshot[],
  appliedPaths: Set<string>,
  createdDirectories: Set<string>,
): Promise<void> {
  const restoreErrors: string[] = [];
  for (const snapshot of [...snapshots].reverse()) {
    if (!appliedPaths.has(snapshot.physicalPath)) continue;
    try {
      if (snapshot.existed) {
        await mkdir(path.dirname(snapshot.physicalPath), { recursive: true });
        await writeFile(snapshot.physicalPath, snapshot.originalContent!);
        if (snapshot.originalMode !== undefined) await chmod(snapshot.physicalPath, snapshot.originalMode & 0o7777);
        if (snapshot.originalAtime && snapshot.originalMtime) {
          await utimes(snapshot.physicalPath, snapshot.originalAtime, snapshot.originalMtime);
        }
      } else {
        try {
          await unlink(snapshot.physicalPath);
        } catch (error) {
          if (!isMissingFileError(error)) throw error;
        }
      }
    } catch (error: any) {
      restoreErrors.push(`${snapshot.physicalPath}: ${error.message || String(error)}`);
    }
  }

  const deepestFirst = Array.from(createdDirectories).sort((left, right) => right.length - left.length);
  for (const directory of deepestFirst) {
    try {
      await rmdir(directory);
    } catch (error: any) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") {
        restoreErrors.push(`${directory}: ${error.message || String(error)}`);
      }
    }
  }

  if (restoreErrors.length > 0) {
    throw new WorkspaceRollbackError(`Physical workspace rollback failed:\n${restoreErrors.join("\n")}`);
  }
}

/** Materialize reconciled files, execute the approved command, and always restore them. */
export async function executeBuildWithTemporaryReconciliation(
  sessionId: string,
  workspaceRoot: string,
  files: ReconciliationVerificationFile[],
  command: NormalizedCommand,
  onOutput: (stream: "stdout" | "stderr", content: string) => void,
): Promise<BuildExecutionOutcome> {
  return withWorkspaceVerificationLock(workspaceRoot, async () => {
    const snapshots = await snapshotFiles(files);
    const createdDirectories = await collectMissingDirectories(workspaceRoot, snapshots);
    const appliedPaths = new Set<string>();
    let outcome: BuildExecutionOutcome = {};

    try {
      for (const snapshot of snapshots) {
        await mkdir(path.dirname(snapshot.physicalPath), { recursive: true });
        appliedPaths.add(snapshot.physicalPath);
        await writeFile(snapshot.physicalPath, snapshot.content, "utf8");
      }

      try {
        outcome.result = await executeCommand(sessionId, command, onOutput);
      } catch (error: any) {
        outcome.error = error instanceof Error ? error : new Error(String(error));
      }
    } finally {
      await restoreWorkspace(snapshots, appliedPaths, createdDirectories);
    }

    return outcome;
  });
}
