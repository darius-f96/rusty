import type { DelegatedTask } from "./delegationManager";

/**
 * Validates the user-controlled delegation options before they enter the
 * scheduler. Keeping this pure makes the policy reusable by other callers
 * without coupling them to manager state.
 */
export function validateDelegatedTask(task: DelegatedTask): void {
  if (!task.objective.trim()) throw new Error("Delegated task objective is required.");
  if (!Array.isArray(task.scope) || task.scope.length === 0) {
    throw new Error("Delegated task scope is required.");
  }
  if (task.maxTurns !== undefined && (!Number.isInteger(task.maxTurns) || task.maxTurns < 1)) {
    throw new Error("Delegated task maxTurns must be positive when set.");
  }
  if (!Number.isFinite(task.timeoutMs) || task.timeoutMs < 1) {
    throw new Error("Delegated task timeoutMs must be positive.");
  }
}
