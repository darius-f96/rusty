import assert from "node:assert/strict";
import { after, test } from "node:test";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { normalizeCommand } from "./commandExecution";

const workspacePromise = mkdtemp(path.join(tmpdir(), "axiom-command-normalization-"));

after(async () => {
  await rm(await workspacePromise, { recursive: true, force: true });
});

test("normalizeCommand removes a duplicated executable argument", async () => {
  const workspace = await workspacePromise;
  const command = await normalizeCommand({
    program: "ls",
    args: ["ls", "-la", "."],
  }, workspace);

  assert.equal(command.program, "ls");
  assert.deepEqual(command.args, ["-la", "."]);
});

test("normalizeCommand preserves a legitimate first argument", async () => {
  const workspace = await workspacePromise;
  const command = await normalizeCommand({
    program: "grep",
    args: ["-r", "TimeEntryService", "."],
  }, workspace);

  assert.deepEqual(command.args, ["-r", "TimeEntryService", "."]);
});
