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
