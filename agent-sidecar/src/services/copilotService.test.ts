import assert from "node:assert/strict";
import test from "node:test";
import type { ModelInfo } from "@github/copilot-sdk";
import { normalizeCopilotModel, parseCopilotLoginOutput } from "./copilotService";

function copilotModel(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: "claude-sonnet-4.5",
    name: "Claude Sonnet 4.5",
    capabilities: {
      supports: {
        vision: true,
        reasoningEffort: true,
      },
      limits: {
        max_context_window_tokens: 200_000,
      },
    } as ModelInfo["capabilities"],
    supportedReasoningEfforts: ["low", "medium", "high"],
    defaultReasoningEffort: "medium",
    billing: { multiplier: 1 },
    policy: { state: "enabled", terms: "" },
    ...overrides,
  };
}

test("Copilot catalog models retain SDK capabilities and billing metadata", () => {
  const model = normalizeCopilotModel(copilotModel());

  assert.equal(model.id, "github-copilot/claude-sonnet-4.5");
  assert.equal(model.remoteId, "claude-sonnet-4.5");
  assert.equal(model.apiType, "copilot-sdk");
  assert.equal(model.supported, true);
  assert.deepEqual(model.input, ["text", "image"]);
  assert.deepEqual(model.capabilities, ["tool-calling", "vision", "reasoning"]);
  assert.equal(model.contextWindow, 200_000);
  assert.deepEqual(model.supportedReasoningEfforts, ["low", "medium", "high"]);
  assert.equal(model.defaultReasoningEffort, "medium");
  assert.equal(model.compat?.billingMultiplier, 1);
  assert.deepEqual(model.compat?.supportedReasoningEfforts, ["low", "medium", "high"]);
});

test("Copilot policy-disabled models remain visible but cannot be selected", () => {
  const model = normalizeCopilotModel(copilotModel({
    id: "restricted-model",
    policy: { state: "disabled", terms: "organization policy" },
  }));

  assert.equal(model.id, "github-copilot/restricted-model");
  assert.equal(model.supported, false);
});

test("Copilot device-flow output exposes the verification URL and user code", () => {
  const result = parseCopilotLoginOutput(
    "\u001b[32mTo authenticate, visit https://github.com/login/device and enter code ABCD-EFGH\u001b[0m\nWaiting for authorization...",
  );

  assert.deepEqual(result, {
    verificationUri: "https://github.com/login/device",
    userCode: "ABCD-EFGH",
  });
});

test("Copilot device-flow parsing works when CLI output arrives in separate chunks", () => {
  const firstChunk = "To authenticate, visit https://github.com/login/";
  const secondChunk = "device and enter code WXYZ-1234\n";

  assert.deepEqual(parseCopilotLoginOutput(firstChunk + secondChunk), {
    verificationUri: "https://github.com/login/device",
    userCode: "WXYZ-1234",
  });
});
