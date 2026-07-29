import assert from "node:assert/strict";
import test from "node:test";
import { codexDynamicTools, normalizeCodexModel } from "./codexService";

test("Codex catalog models retain account model metadata", () => {
  const model = normalizeCodexModel({
    id: "gpt-5.6-sol",
    model: "gpt-5.6-sol",
    displayName: "GPT-5.6 Sol",
    hidden: false,
    isDefault: true,
    inputModalities: ["text", "image"],
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: [
      { reasoningEffort: "medium", description: "Balanced" },
      { reasoningEffort: "high", description: "Deeper reasoning" },
    ],
  });

  assert.equal(model.id, "openai-codex/gpt-5.6-sol");
  assert.equal(model.remoteId, "gpt-5.6-sol");
  assert.equal(model.apiType, "codex-app-server");
  assert.equal(model.supported, true);
  assert.deepEqual(model.input, ["text", "image"]);
  assert.deepEqual(model.capabilities, ["reasoning", "vision"]);
  assert.deepEqual(model.supportedReasoningEfforts, ["medium", "high"]);
  assert.equal(model.defaultReasoningEffort, "high");
  assert.equal(model.compat?.isDefault, true);
  assert.equal(model.compat?.defaultReasoningEffort, "high");
  assert.deepEqual(model.compat?.supportedReasoningEfforts, ["medium", "high"]);
});

test("Codex dynamic tools are namespaced, sanitized, and collision-safe", () => {
  const execute = async () => "ok";
  const result = codexDynamicTools([
    { name: "read/file", description: "Read", execute },
    { name: "read.file", description: "Read another", execute },
  ]);

  assert.equal(result.specs.length, 1);
  assert.equal(result.specs[0].type, "namespace");
  assert.equal(result.specs[0].name, "rusty");
  assert.deepEqual(result.specs[0].tools.map((tool: any) => tool.name), ["read_file", "read_file_2"]);
  assert.equal(result.byName.get("read_file")?.name, "read/file");
  assert.equal(result.byName.get("read_file_2")?.name, "read.file");
});
