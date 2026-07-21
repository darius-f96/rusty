/**
 * Pi capability factory for approved, non-interactive terminal commands.
 *
 * Keeping this adapter separate from authorization and process execution lets
 * every Pi environment share identical safety rules while choosing how command
 * output is presented in its own activity stream.
 */
import { WebSocket } from "ws";
import { safeSend } from "../../services/websocket";
import { authorizeCommand } from "../../services/commandPermissions";
import { executeCommand, normalizeCommand } from "../../services/commandExecution";

export interface RunCommandToolOptions {
  ws: WebSocket;
  sessionId: string;
  workspaceRoot: string;
  sendLog: (message: string) => void;
}

export function createRunCommandTool(options: RunCommandToolOptions) {
  return {
    name: "run_command",
    description: "Last-resort tool for an essential build, test, typecheck, lint, generator, or explicitly requested executable after user approval. Use Axiom's read_file, write_file, list_files, and search_codebase tools for workspace operations; never use this tool to inspect, search, create, edit, move, or delete files. Use separate program and args fields; do not wrap commands in sh or bash.",
    inputSchema: {
      type: "object",
      properties: {
        program: { type: "string", description: "Executable name, for example terragrunt, npm, or git." },
        args: { type: "array", items: { type: "string" }, description: "Arguments passed literally to the executable." },
        cwd: { type: "string", description: "Workspace-relative working directory. Defaults to the workspace root." },
        timeoutMs: { type: "number", description: "Timeout in milliseconds, between 1 second and 30 minutes." },
      },
      required: ["program"],
    },
    execute: async (input: any) => {
      const command = await normalizeCommand(input, options.workspaceRoot);
      await authorizeCommand(options.ws, options.sessionId, command);
      options.sendLog(`Running approved command: ${[command.program, ...command.args].join(" ")}`);
      const result = await executeCommand(options.sessionId, command, (stream, content) => {
        safeSend(options.ws, { type: "command_output", sessionId: options.sessionId, stream, content });
      });
      safeSend(options.ws, {
        type: "command_complete",
        sessionId: options.sessionId,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
      });
      options.sendLog(`Command exited ${result.exitCode === null ? `with ${result.signal || "no status"}` : `with code ${result.exitCode}`}.`);
      return result;
    },
  };
}
