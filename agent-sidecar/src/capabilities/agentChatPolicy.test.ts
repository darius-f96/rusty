import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GLOBAL_CHAT_TASK_DEPENDENCY_POLICY,
  resolveAgentChatToolNames,
} from "./agentChatPolicy";

const BUILD_TOOLS = [
  "read_file",
  "write_file",
  "list_files",
  "search_codebase",
  "web_search",
  "run_command",
];

test("TaskNode chat keeps VFS writes while removing physical command execution", () => {
  assert.deepEqual(resolveAgentChatToolNames(BUILD_TOOLS, { vfsOnly: true }), [
    "read_file",
    "write_file",
    "list_files",
    "search_codebase",
    "web_search",
  ]);
});

test("planning chat removes implementation tools and exposes only plan persistence", () => {
  assert.deepEqual(resolveAgentChatToolNames(BUILD_TOOLS, { planOnly: true }), [
    "read_file",
    "list_files",
    "search_codebase",
    "web_search",
    "write_plan",
  ]);
});

test("ordinary Agent chat retains build and command tools", () => {
  assert.deepEqual(resolveAgentChatToolNames([...BUILD_TOOLS, "write_plan"], {}), BUILD_TOOLS);
});

test("planning policy wins if conflicting surface flags are supplied", () => {
  const tools = resolveAgentChatToolNames(BUILD_TOOLS, { planOnly: true, vfsOnly: true });

  assert.equal(tools.includes("write_file"), false);
  assert.equal(tools.includes("run_command"), false);
  assert.equal(tools.includes("write_plan"), true);
});

test("Global Chat planning requires a final dependency and influence section", () => {
  assert.match(GLOBAL_CHAT_TASK_DEPENDENCY_POLICY, /final section.*Task Dependencies and Influence/i);
  assert.match(GLOBAL_CHAT_TASK_DEPENDENCY_POLICY, /Depends on/);
  assert.match(GLOBAL_CHAT_TASK_DEPENDENCY_POLICY, /Influences/);
  assert.match(GLOBAL_CHAT_TASK_DEPENDENCY_POLICY, /default to implementation order/i);
});
