export interface AgentChatPolicyOptions {
  planOnly?: boolean;
  vfsOnly?: boolean;
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
