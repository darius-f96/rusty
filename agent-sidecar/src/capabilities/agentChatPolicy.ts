export interface AgentChatPolicyOptions {
  planOnly?: boolean;
  vfsOnly?: boolean;
}

export const GLOBAL_CHAT_TASK_DEPENDENCY_POLICY = `
- Whenever you provide an implementation plan containing one or more tasks, the final section of your response MUST be titled "Task Dependencies and Influence". Include this section even when the user did not ask for dependency information.
- Give every planned task a stable identifier such as T1, T2, and T3, and use the same identifiers in the final dependency section.
- In that final section, list every task and state both "Depends on" and "Influences". Use "none" when there is no relationship.
- Preserve dependency, ordering, independence, and parallelism explicitly stated by the user.
- If the user did not specify task relationships, default to implementation order: T1 has no dependency, T2 depends on T1, T3 depends on T2, and so on. Each task therefore influences the next task; do not infer parallel execution unless the user requests or confirms it.
- Keep "Task Dependencies and Influence" as the final section so downstream task generation can reliably use it to create TaskNode connections.
`;

/**
 * Agent Tab should use Rusty's structured workspace tools for normal coding
 * work. Keep command execution available for operations that genuinely need a
 * process (for example, a focused test), but do not let it become a substitute
 * for the harness.
 */
export const AGENT_TAB_HARNESS_POLICY = `

Agent Tab harness policy (this overrides any conflicting skill instruction):
- Use the Rusty harness for workspace operations whenever a dedicated tool exists: use 'search_codebase' for code search, 'list_files' for workspace discovery, 'read_file' for file inspection, and 'write_file' for every file creation or edit.
- Never use 'run_command' to read, search, list, create, edit, move, or delete files, or to work around a harness tool. In particular, do not use shell utilities, scripts, interpreters, or package scripts to modify files.
- Treat 'run_command' as a last resort. Use it only for an essential operation that the harness cannot perform, normally one focused build, test, typecheck, lint, generator, or user-requested executable.
- Do not run speculative, redundant, or broad verification commands. After editing, run only the smallest relevant check when its result materially improves confidence; otherwise finish without executing a command.
- When the user requests a code change, begin with the relevant harness reads and searches, apply the change with 'write_file', and do not default to terminal commands.
`;

/** Build the delegation instructions around the tool supported by the active runtime. */
export function agentDelegationPolicy(toolName: "Agent" | "delegate_task"): string {
  const invocation = toolName === "Agent"
    ? "issue multiple 'Agent' tool calls in the same turn"
    : "issue multiple 'delegate_task' tool calls in the same turn";
  const collection = toolName === "Agent"
    ? "Always set max_turns (3 for codebase mapping and 4 for deeper review), then retrieve every delegated result with 'get_subagent_result' before concluding."
    : "Each 'delegate_task' call returns its findings directly; incorporate every result before concluding.";

  return `- Delegate at least one bounded investigation or review for every non-trivial request that spans multiple files, requires both discovery and implementation, combines diagnosis with a fix, or benefits from an independent verification pass.
- Skip delegation only for a genuinely small, obvious, single-file change where a subagent would add no useful evidence.
- When two or more investigations or reviews are independent, ${invocation} so they run concurrently. Use no more than three subagents unless the user explicitly asks for broader research.
- Keep delegated work read-only and narrowly scoped. The parent agent owns all file edits through the Rusty harness; subagents return concise findings with relevant paths and evidence.
- ${collection}
- Do not ask the user a refining question or present a final recommendation while delegated work is active.`;
}

/**
 * Apply surface-level capability boundaries after a skill has requested tools.
 * These restrictions are structural and cannot be widened by a skill prompt.
 */
export function resolveAgentChatToolNames(
  requestedToolNames: string[],
  { planOnly = false, vfsOnly = false }: AgentChatPolicyOptions,
): string[] {
  const requested = Array.from(new Set(requestedToolNames));

  if (planOnly) {
    return Array.from(new Set([
      ...requested.filter((name) => name !== "write_file" && name !== "run_command"),
      "write_plan",
    ]));
  }

  if (vfsOnly) {
    return requested.filter((name) => name !== "run_command" && name !== "write_plan");
  }

  return requested.filter((name) => name !== "write_plan");
}
