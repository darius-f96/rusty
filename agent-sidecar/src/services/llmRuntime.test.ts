import assert from "node:assert/strict";
import test from "node:test";
import { importEsm } from "./esmImport";
import { callLlmWithToolsPiStreaming, EmptyLlmResponseError } from "./llmRuntime";

test("empty response errors retain stop-reason diagnostics", () => {
  const error = new EmptyLlmResponseError({
    stopReason: "length",
    content: [{ type: "thinking", thinking: "internal work" }],
    usage: { output: 5000 },
  });

  assert.equal(error.stopReason, "length");
  assert.deepEqual(error.contentTypes, ["thinking"]);
  assert.equal(error.outputTokens, 5000);
  assert.match(error.message, /exhausted its output token budget/);
  assert.match(error.message, /response parts: thinking/);
});

test("provider-neutral tool loop executes calls and continues to final text", async () => {
  const pi = await importEsm<any>("@earendil-works/pi-ai/compat");
  const registration = pi.registerFauxProvider({ api: "rusty-faux-test", provider: "faux-provider" });
  const observedReasoning: string[] = [];
  registration.setResponses([
    (_context: any, options: any) => {
      observedReasoning.push(options.reasoning);
      return pi.fauxAssistantMessage([pi.fauxToolCall("echo", { value: "hello" })], { stopReason: "toolUse" });
    },
    (_context: any, options: any) => {
      observedReasoning.push(options.reasoning);
      return pi.fauxAssistantMessage([pi.fauxText("Tool result accepted.")]);
    },
  ]);

  const streamed: string[] = [];
  try {
    const response = await callLlmWithToolsPiStreaming({
      modelReference: "faux-provider/faux-model::reasoning=high",
      customProvider: {
        id: "faux-provider",
        name: "Faux Provider",
        baseUrl: "https://faux.invalid",
        apiType: registration.api,
        authType: "none",
        models: [{
          id: "faux-provider/faux-model",
          remoteId: "faux-model",
          name: "Faux Model",
          apiType: registration.api,
        }],
      },
      systemPrompt: "Use the echo tool.",
      userMessage: "Echo hello.",
      tools: [{
        name: "echo",
        description: "Echo a value.",
        inputSchema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
        execute: async ({ value }) => ({ echoed: value }),
      }],
      sendLog: () => {},
      sendToken: (token) => streamed.push(token),
    });

    assert.equal(response, "Tool result accepted.");
    assert.equal(streamed.join(""), "Tool result accepted.");
    assert.equal(registration.state.callCount, 2);
    assert.deepEqual(observedReasoning, ["high", "high"]);
  } finally {
    registration.unregister();
  }
});

test("provider-neutral tool loop can finish after a terminal write without resending its large arguments", async () => {
  const pi = await importEsm<any>("@earendil-works/pi-ai/compat");
  const registration = pi.registerFauxProvider({ api: "rusty-faux-terminal-test", provider: "faux-terminal-provider" });
  registration.setResponses([
    pi.fauxAssistantMessage([
      pi.fauxToolCall("write_file", { path: "/workspace/large.ts", content: "complete file content" }),
    ], { stopReason: "toolUse" }),
  ]);
  let written = false;

  try {
    const response = await callLlmWithToolsPiStreaming({
      modelReference: "faux-terminal-provider/faux-model",
      customProvider: {
        id: "faux-terminal-provider",
        name: "Faux Terminal Provider",
        baseUrl: "https://faux.invalid",
        apiType: registration.api,
        authType: "none",
        models: [{
          id: "faux-terminal-provider/faux-model",
          remoteId: "faux-model",
          name: "Faux Model",
          apiType: registration.api,
        }],
      },
      systemPrompt: "Write the file.",
      userMessage: "Write it now.",
      tools: [{
        name: "write_file",
        description: "Write a complete file.",
        inputSchema: { type: "object", properties: {}, required: [] },
        execute: async () => {
          written = true;
          return "written";
        },
      }],
      returnAfterToolNames: ["write_file"],
      sendLog: () => {},
      sendToken: () => {},
    });

    assert.equal(written, true);
    assert.equal(registration.state.callCount, 1);
    assert.match(response, /Completed write_file/);
  } finally {
    registration.unregister();
  }
});
