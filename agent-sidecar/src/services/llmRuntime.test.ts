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
  const pi = await importEsm<any>("@earendil-works/pi-ai");
  const registration = pi.registerFauxProvider({ api: "axiom-faux-test", provider: "faux-provider" });
  registration.setResponses([
    pi.fauxAssistantMessage([pi.fauxToolCall("echo", { value: "hello" })], { stopReason: "toolUse" }),
    pi.fauxAssistantMessage([pi.fauxText("Tool result accepted.")]),
  ]);

  const streamed: string[] = [];
  try {
    const response = await callLlmWithToolsPiStreaming({
      modelReference: "faux-provider/faux-model",
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
  } finally {
    registration.unregister();
  }
});
