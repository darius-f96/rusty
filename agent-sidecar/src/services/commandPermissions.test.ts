import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyCommandRisk,
  commandGrantKey,
  commandSessionGrantScope,
  type NormalizedCommand,
} from "./commandPermissions";

function command(program: string, args: string[] = [], cwd = "/workspace"): NormalizedCommand {
  return { program, args, cwd, timeoutMs: 5_000 };
}

test("normal grep commands share an executable-level session grant", () => {
  const first = command("grep", ["-r", "TimeEntryService", "."]);
  const second = command("grep", ["-n", "another pattern", "src"]);

  assert.equal(classifyCommandRisk(first), "normal");
  assert.equal(commandSessionGrantScope(first), "executable");
  assert.equal(commandGrantKey(first), commandGrantKey(second));
});

test("risk words used as grep patterns do not elevate a read-only command", () => {
  const search = command("rg", ["destroy|deploy|rm", "src"]);

  assert.equal(classifyCommandRisk(search), "normal");
  assert.equal(commandSessionGrantScope(search), "executable");
});

test("read-only sed flags stay normal while in-place edits ask separately", () => {
  const print = command("sed", ["--silent", "1,5p", "README.md"]);
  const edit = command("sed", ["-i.bak", "s/old/new/g", "README.md"]);

  assert.equal(classifyCommandRisk(print), "normal");
  assert.equal(commandSessionGrantScope(print), "executable");
  assert.equal(classifyCommandRisk(edit), "elevated");
  assert.equal(commandSessionGrantScope(edit), "exact_command");
});

test("a destructive variant does not inherit a normal executable grant", () => {
  const status = command("git", ["status", "--short"]);
  const push = command("git", ["push", "--force", "origin", "main"]);

  assert.equal(classifyCommandRisk(status), "normal");
  assert.equal(commandSessionGrantScope(status), "executable");
  assert.equal(classifyCommandRisk(push), "destructive");
  assert.equal(commandSessionGrantScope(push), "exact_command");
  assert.notEqual(commandGrantKey(status), commandGrantKey(push));
});

test("destructive long-form git flags do not inherit a normal git grant", () => {
  const status = command("git", ["status"]);
  const deleteBranch = command("git", ["branch", "--delete", "old-branch"]);

  assert.equal(classifyCommandRisk(deleteBranch), "destructive");
  assert.notEqual(commandGrantKey(status), commandGrantKey(deleteBranch));
});

test("interpreters retain exact-command grants even for normal-risk invocations", () => {
  const first = command("bash", ["-c", "printf hello"]);
  const second = command("bash", ["-c", "printf goodbye"]);

  assert.equal(commandSessionGrantScope(first), "exact_command");
  assert.notEqual(commandGrantKey(first), commandGrantKey(second));
});

test("higher-risk commands only reuse an identical command grant", () => {
  const first = command("git", ["push", "origin", "main"]);
  const same = command("git", ["push", "origin", "main"], "/workspace");
  const changed = command("git", ["push", "--force", "origin", "main"]);

  assert.equal(commandGrantKey(first), commandGrantKey(same));
  assert.notEqual(commandGrantKey(first), commandGrantKey(changed));
});
