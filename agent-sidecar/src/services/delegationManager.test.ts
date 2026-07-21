import assert from "node:assert/strict";
import test from "node:test";
import { DelegatedTask, DelegationAdapter, DelegationManager } from "./delegationManager";

const task = (objective: string, timeoutMs = 1_000): DelegatedTask => ({
  objective,
  scope: ["src"],
  expectedOutput: "findings",
  evidenceRequired: true,
  maxTurns: 4,
  timeoutMs,
  benefit: "parallelism",
});

function deferredAdapter() {
  const resolvers: Array<(value: { findings: string }) => void> = [];
  const adapter: DelegationAdapter = {
    execute: () => new Promise((resolve) => resolvers.push(resolve)),
  };
  return { adapter, resolvers };
}

test("enforces concurrency, assigns stable identities, and joins buffered results", async () => {
  const events: string[] = [];
  const manager = new DelegationManager(1, (event) => events.push(`${event.type}:${event.handle.task.objective}`));
  const deferred = deferredAdapter();
  const first = await manager.spawn("run-1", "parent", task("first"), deferred.adapter);
  const second = await manager.spawn("run-1", "parent", task("second"), deferred.adapter);
  assert.notEqual(first.agentId, second.agentId);
  assert.deepEqual(manager.list("run-1").map((item) => item.status), ["running", "queued"]);
  deferred.resolvers[0]({ findings: "one" });
  assert.equal((await manager.join(first.agentId)).findings, "one");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(manager.list("run-1").map((item) => item.status), ["completed", "running"]);
  deferred.resolvers[1]({ findings: "two" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await manager.join(second.agentId)).findings, "two");
  assert.equal(manager.list("run-1")[1].resultConsumed, true);
  assert.ok(events.includes("delegation.queued:second"));
  assert.ok(events.includes("delegation.started:second"));
});

test("supports cancellation while queued and while running", async () => {
  const manager = new DelegationManager(1);
  const deferred = deferredAdapter();
  const running = await manager.spawn("run-1", "parent", task("running"), deferred.adapter);
  const queued = await manager.spawn("run-1", "parent", task("queued"), deferred.adapter);
  await manager.cancel(queued.agentId, "not needed");
  assert.equal((await manager.join(queued.agentId)).status, "cancelled");
  await manager.cancel(running.agentId, "stop");
  assert.equal((await manager.join(running.agentId)).status, "cancelled");
});

test("times out an adapter and retains a structured terminal result", async () => {
  const manager = new DelegationManager(1);
  const deferred = deferredAdapter();
  const handle = await manager.spawn("run-1", "parent", task("slow", 5), deferred.adapter);
  const result = await manager.join(handle.agentId);
  assert.equal(result.status, "timed_out");
  assert.match(result.error || "", /timed out/i);
});

test("parent run cancellation cascades to all children", async () => {
  const manager = new DelegationManager(2);
  const deferred = deferredAdapter();
  const first = await manager.spawn("run-1", "parent", task("first"), deferred.adapter);
  const second = await manager.spawn("run-1", "parent", task("second"), deferred.adapter);
  await manager.cancelRun("run-1", "parent cancelled");
  assert.deepEqual([(await manager.join(first.agentId)).status, (await manager.join(second.agentId)).status], ["cancelled", "cancelled"]);
});

test("returns an explicit unsupported error for steering when an adapter cannot emulate it", async () => {
  const manager = new DelegationManager();
  const deferred = deferredAdapter();
  const handle = await manager.spawn("run-1", "parent", task("inspect"), deferred.adapter);
  await assert.rejects(manager.steer(handle.agentId, "focus elsewhere"), /DELEGATION_OPERATION_UNSUPPORTED/);
  await manager.cancel(handle.agentId);
});
