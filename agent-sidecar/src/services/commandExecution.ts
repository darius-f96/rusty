/**
 * Non-interactive process runner for Pi's run_command tool.
 *
 * Commands are spawned without an implicit shell, so Axiom passes each argument
 * literally rather than interpreting pipes, substitutions, redirects, or
 * chains. Working directories are canonicalized and must remain inside the
 * active workspace. Active processes are tracked by Pi session so Stop cancels
 * the model and every child command.
 */
import { spawn, ChildProcess } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { NormalizedCommand } from "./commandPermissions";

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const MAX_TIMEOUT_MS = 30 * 60_000;
const MAX_CAPTURE_CHARS = 100_000;
const activeCommands = new Map<string, Map<string, ChildProcess>>();

export interface CommandResult extends NormalizedCommand {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export async function normalizeCommand(input: any, workspaceRoot: string): Promise<NormalizedCommand> {
  const program = String(input?.program || "").trim();
  if (!program || program.includes("\0")) throw new Error("A valid command program is required.");
  const args: string[] = Array.isArray(input?.args) ? input.args.map((arg: any) => String(arg)) : [];
  if (args.length > 256 || args.some((arg: string) => arg.length > 16_384 || arg.includes("\0"))) {
    throw new Error("Command arguments exceed the allowed limits.");
  }

  const canonicalRoot = await realpath(workspaceRoot);
  const requestedCwd = path.resolve(canonicalRoot, String(input?.cwd || "."));
  const canonicalCwd = await realpath(requestedCwd);
  const cwdStat = await stat(canonicalCwd);
  if (!cwdStat.isDirectory()) throw new Error("Command working directory is not a directory.");
  const relative = path.relative(canonicalRoot, canonicalCwd);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Command working directory must remain inside the workspace.");
  }

  const requestedTimeout = Number(input?.timeoutMs) || DEFAULT_TIMEOUT_MS;
  return { program, args, cwd: canonicalCwd, timeoutMs: Math.max(1_000, Math.min(requestedTimeout, MAX_TIMEOUT_MS)) };
}

function appendBounded(current: string, chunk: string): string {
  const next = current + chunk;
  return next.length <= MAX_CAPTURE_CHARS ? next : next.slice(next.length - MAX_CAPTURE_CHARS);
}

function signalProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try { child.kill(signal); } catch { /* The process already exited. */ }
  }
}

function killProcess(child: ChildProcess): void {
  signalProcess(child, "SIGTERM");
  const forceKillTimer = setTimeout(() => signalProcess(child, "SIGKILL"), 2_000);
  forceKillTimer.unref();
}

export function stopCommandsForSession(sessionId: string): number {
  const commands = activeCommands.get(sessionId);
  if (!commands) return 0;
  for (const child of commands.values()) killProcess(child);
  return commands.size;
}

export async function executeCommand(
  sessionId: string,
  command: NormalizedCommand,
  onOutput: (stream: "stdout" | "stderr", content: string) => void,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const executionId = crypto.randomUUID();
    const child = spawn(command.program, command.args, {
      cwd: command.cwd,
      env: process.env,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const sessionCommands = activeCommands.get(sessionId) || new Map<string, ChildProcess>();
    sessionCommands.set(executionId, child);
    activeCommands.set(sessionId, sessionCommands);

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcess(child);
    }, command.timeoutMs);

    child.stdout?.on("data", (data) => {
      const content = data.toString();
      stdout = appendBounded(stdout, content);
      onOutput("stdout", content);
    });
    child.stderr?.on("data", (data) => {
      const content = data.toString();
      stderr = appendBounded(stderr, content);
      onOutput("stderr", content);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      sessionCommands.delete(executionId);
      if (sessionCommands.size === 0 && activeCommands.get(sessionId) === sessionCommands) {
        activeCommands.delete(sessionId);
      }
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      sessionCommands.delete(executionId);
      if (sessionCommands.size === 0 && activeCommands.get(sessionId) === sessionCommands) {
        activeCommands.delete(sessionId);
      }
      resolve({ ...command, exitCode, signal, timedOut, stdout, stderr });
    });
  });
}
