/**
 * Session-scoped authorization for agent-initiated commands.
 *
 * Grants are intentionally held only in process memory. A grant applies to one
 * exact normalized command (program + argv + canonical cwd) inside one Pi
 * session. It therefore cannot turn approval for `terragrunt plan` into
 * approval for `terragrunt apply`, another directory, or another agent tab.
 */
import { WebSocket } from "ws";
import { getNextId, registerPendingRequest, safeSend } from "./websocket";

export type CommandPermissionDecision = "deny" | "allow_once" | "allow_session";
export type CommandRisk = "normal" | "elevated" | "destructive";

export interface NormalizedCommand {
  program: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

const sessionGrants = new Map<string, Set<string>>();

export function commandSignature(command: NormalizedCommand): string {
  return JSON.stringify([command.program, command.args, command.cwd]);
}

export function classifyCommandRisk(command: NormalizedCommand): CommandRisk {
  const text = [command.program, ...command.args].join(" ").toLowerCase();
  if (/\b(destroy|apply|delete|remove|rm|push|publish|deploy|terminate)\b/.test(text)) return "destructive";
  if (/\b(install|update|upgrade|migrate|import|init)\b/.test(text)) return "elevated";
  return "normal";
}

export function clearCommandSession(sessionId: string): void {
  sessionGrants.delete(sessionId);
}

/** Ask the frontend unless this exact command already has a session grant. */
export async function authorizeCommand(
  ws: WebSocket,
  sessionId: string,
  command: NormalizedCommand,
): Promise<void> {
  const signature = commandSignature(command);
  if (sessionGrants.get(sessionId)?.has(signature)) return;

  const requestId = getNextId();
  const decision = await new Promise<CommandPermissionDecision>((resolve, reject) => {
    registerPendingRequest(requestId, ws, (response) => {
      if (response.error) return reject(new Error(response.error));
      resolve(response.decision as CommandPermissionDecision);
    }, 10 * 60_000);

    safeSend(ws, {
      type: "command_permission_request",
      requestId,
      sessionId,
      command,
      risk: classifyCommandRisk(command),
      description: `The agent wants to run: ${[command.program, ...command.args].join(" ")}`,
    });
  });

  if (decision === "deny") throw new Error("Command denied by the user.");
  if (decision !== "allow_once" && decision !== "allow_session") {
    throw new Error("Command permission response was invalid.");
  }
  if (decision === "allow_session") {
    const grants = sessionGrants.get(sessionId) || new Set<string>();
    grants.add(signature);
    sessionGrants.set(sessionId, grants);
  }
}
