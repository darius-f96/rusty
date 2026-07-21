import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AGENT_TAB_HARNESS_POLICY,
  GLOBAL_CHAT_TASK_DEPENDENCY_POLICY,
  agentDelegationPolicy,
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

test("Agent Tab policy makes harness tools primary and command execution a last resort", () => {
  assert.match(AGENT_TAB_HARNESS_POLICY, /write_file.*every file creation or edit/i);
  assert.match(AGENT_TAB_HARNESS_POLICY, /Never use 'run_command'.*create, edit/i);
  assert.match(AGENT_TAB_HARNESS_POLICY, /Treat 'run_command' as a last resort/i);
  assert.match(AGENT_TAB_HARNESS_POLICY, /smallest relevant check/i);
});

test("non-trivial Agent Tab work is delegated using the active runtime tool", () => {
  const piPolicy = agentDelegationPolicy("Agent");
  const managedRuntimePolicy = agentDelegationPolicy("delegate_task");

  assert.match(piPolicy, /Delegate at least one.*every non-trivial request/i);
  assert.match(piPolicy, /multiple 'Agent' tool calls in the same turn/i);
  assert.match(managedRuntimePolicy, /multiple 'delegate_task' tool calls in the same turn/i);
  assert.match(managedRuntimePolicy, /parent agent owns all file edits/i);
  assert.match(managedRuntimePolicy, /incorporate every result before concluding/i);
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
