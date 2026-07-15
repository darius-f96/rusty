/**
 * Process-wide guard that removes Pi's unrestricted built-in `bash` tool.
 *
 * Pi subagents create independent AgentSession instances and otherwise receive
 * their own built-in Bash tool, bypassing Axiom's approval protocol. Filtering
 * the tool at AgentSession activation keeps the policy structural: parent
 * agents use Axiom's `run_command` adapter, while subagents return findings to
 * the parent when a command is needed. This also covers custom subagent types.
 */
import { importEsm } from "./esmImport";

const POLICY_MARKER = Symbol.for("axiom:approved-command-policy");

export async function installPiCommandPolicy(): Promise<void> {
  const pi = await importEsm<any>("@earendil-works/pi-coding-agent");
  const prototype = pi.AgentSession?.prototype as any;
  if (!prototype || prototype[POLICY_MARKER]) return;

  const activateTools = prototype.setActiveToolsByName;
  if (typeof activateTools !== "function") {
    throw new Error("The installed Pi runtime does not expose AgentSession tool activation.");
  }

  Object.defineProperty(prototype, POLICY_MARKER, { value: true });
  prototype.setActiveToolsByName = function approvedCommandTools(toolNames: string[]) {
    return activateTools.call(this, toolNames.filter((name) => name !== "bash"));
  };
}
