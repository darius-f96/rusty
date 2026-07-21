/**
 * Session-scoped authorization for agent-initiated commands.
 *
 * Grants are intentionally held only in process memory. Normal, directly
 * executed programs receive an executable-level grant inside one Pi session,
 * so approving `grep` once also covers another `grep` pattern. Commands with a
 * higher risk classification, plus interpreters and command dispatchers, keep
 * exact-command grants and therefore ask again when their arguments change.
 */
import path from "node:path";
import { WebSocket } from "ws";
import { request, validateRpcResponse } from "./websocket";

export type CommandPermissionDecision = "deny" | "allow_once" | "allow_session";
export type CommandRisk = "normal" | "elevated" | "destructive";
export type CommandSessionGrantScope = "executable" | "exact_command";

export interface NormalizedCommand {
  program: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

const sessionGrants = new Map<string, Set<string>>();

const READ_ONLY_PROGRAMS = new Set([
  "ack", "ag", "basename", "cat", "cmp", "cut", "df", "diff", "dirname",
  "du", "file", "grep", "head", "ls", "pwd", "readlink", "realpath", "rg",
  "stat", "tail", "tree", "tr", "wc", "where", "whereis", "which",
]);

// These programs interpret arguments as code or dispatch to another executable.
// Their risk cannot be reliably inferred from the outer argv, so argument
// changes must always receive a separate grant.
const EXACT_GRANT_PROGRAMS = new Set([
  "awk", "bash", "bun", "bunx", "cargo", "cmd", "deno", "env", "fish", "go",
  "java", "just", "make", "node", "npx", "npm", "osascript", "perl", "php",
  "pnpm", "powershell", "pwsh", "ruby", "sh", "sudo", "task", "xargs", "yarn",
  "zsh",
]);

function programName(command: NormalizedCommand): string {
  return path.basename(command.program).toLowerCase().replace(/\.exe$/, "");
}

function firstPositionalArg(args: string[]): string {
  return (args.find((arg) => arg && !arg.startsWith("-")) || "").toLowerCase();
}

function includesArg(args: string[], ...values: string[]): boolean {
  const expected = new Set(values);
  return args.some((arg) => expected.has(arg.toLowerCase()));
}

export function commandSignature(command: NormalizedCommand): string {
  return JSON.stringify([command.program, command.args, command.cwd]);
}

export function commandExecutableSignature(command: NormalizedCommand): string {
  const usesPath = path.isAbsolute(command.program) || command.program.includes("/") || command.program.includes("\\");
  let identity = usesPath ? path.resolve(command.cwd, command.program) : command.program;
  if (process.platform === "win32") identity = identity.toLowerCase();
  return JSON.stringify([identity]);
}

/** Classify operations rather than arbitrary operands such as grep patterns. */
export function classifyCommandRisk(command: NormalizedCommand): CommandRisk {
  const program = programName(command);
  const args = command.args.map((arg) => arg.toLowerCase());
  const action = firstPositionalArg(args);

  // A search for the word "deploy" is still only a search.
  if (READ_ONLY_PROGRAMS.has(program)) return "normal";

  if (program === "find") {
    if (includesArg(args, "-delete")) return "destructive";
    if (includesArg(args, "-exec", "-execdir", "-ok", "-okdir")) return "elevated";
    return "normal";
  }

  if (program === "sed") {
    return args.some((arg) => /^--in-place(?:=|$)/.test(arg) || /^-[^-]*i/.test(arg)) ? "elevated" : "normal";
  }

  if (program === "git") {
    if (["push", "reset", "clean", "rebase"].includes(action)) return "destructive";
    if (action === "branch" && (args.some((arg) => /^-[dD]$/.test(arg)) || includesArg(args, "--delete"))) return "destructive";
    if (action === "tag" && includesArg(args, "-d", "--delete")) return "destructive";
    if (action === "stash" && includesArg(args, "drop", "clear")) return "destructive";
    if ([
      "blame", "cat-file", "describe", "diff", "grep", "log", "ls-files", "ls-tree",
      "rev-parse", "shortlog", "show", "status", "version", "whatchanged",
    ].includes(action)) return "normal";
    if (!action || (action === "branch" && !includesArg(args, "-m", "-c"))) return "normal";
    return "elevated";
  }

  if (["npm", "pnpm", "yarn", "bun", "npx", "bunx"].includes(program)) {
    if (["publish", "unpublish", "deprecate"].includes(action)) return "destructive";
    if (["list", "ls", "view", "info", "outdated", "why", "help", "version"].includes(action)) return "normal";
    return "elevated";
  }

  if (["terraform", "terragrunt"].includes(program)) {
    if (["apply", "destroy", "import"].includes(action)) return "destructive";
    if (["fmt", "get", "graph", "output", "plan", "providers", "show", "validate", "version"].includes(action)) return "normal";
    return "elevated";
  }

  if (program === "kubectl") {
    if (["delete", "drain", "replace", "rollout", "scale"].includes(action)) return "destructive";
    if (["apply", "attach", "autoscale", "cordon", "create", "edit", "exec", "expose", "label", "patch", "port-forward", "run", "set", "taint", "uncordon"].includes(action)) return "elevated";
    if (["api-resources", "api-versions", "auth", "cluster-info", "describe", "diff", "explain", "get", "logs", "top", "version", "wait"].includes(action)) return "normal";
    return "elevated";
  }

  const text = [program, ...args].join(" ");
  if (/\b(destroy|apply|delete|remove|rm|push|publish|deploy|terminate|uninstall)\b/.test(text)) return "destructive";
  if (/\b(install|update|upgrade|migrate|import|init|write|create)\b/.test(text)) return "elevated";
  return "normal";
}

function requiresExactGrant(command: NormalizedCommand): boolean {
  const program = programName(command);
  return EXACT_GRANT_PROGRAMS.has(program) || /^python(?:\d+(?:\.\d+)*)?$/.test(program);
}

export function commandSessionGrantScope(
  command: NormalizedCommand,
  risk = classifyCommandRisk(command),
): CommandSessionGrantScope {
  return risk === "normal" && !requiresExactGrant(command) ? "executable" : "exact_command";
}

export function commandGrantKey(
  command: NormalizedCommand,
  risk = classifyCommandRisk(command),
): string {
  return commandSessionGrantScope(command, risk) === "executable"
    ? `executable:${commandExecutableSignature(command)}`
    : `exact:${commandSignature(command)}`;
}

export function clearCommandSession(sessionId: string): void {
  sessionGrants.delete(sessionId);
}

/** Ask the frontend unless this command's calculated session grant exists. */
export async function authorizeCommand(
  ws: WebSocket,
  sessionId: string,
  command: NormalizedCommand,
): Promise<void> {
  const risk = classifyCommandRisk(command);
  const sessionGrantScope = commandSessionGrantScope(command, risk);
  const grantKey = commandGrantKey(command, risk);
  if (sessionGrants.get(sessionId)?.has(grantKey)) return;

  const response = await request(ws, {
    type: "command_permission_request",
    runId: sessionId,
    timeoutMs: 10 * 60_000,
    payload: {
      sessionId,
      command,
      risk,
      sessionGrantScope,
      sessionGrantProgram: programName(command),
      description: `The agent wants to run: ${[command.program, ...command.args].join(" ")}`,
    },
    validateResponse: validateRpcResponse,
  });
  if (response.error) throw new Error(String(response.error));
  const decision = response.decision as CommandPermissionDecision;

  if (decision === "deny") throw new Error("Command denied by the user.");
  if (decision !== "allow_once" && decision !== "allow_session") {
    throw new Error("Command permission response was invalid.");
  }
  if (decision === "allow_session") {
    const grants = sessionGrants.get(sessionId) || new Set<string>();
    grants.add(grantKey);
    sessionGrants.set(sessionId, grants);
  }
}
