import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { importEsm } from "../services/esmImport";
import { generateTaskNodes } from "./generateTaskNodes";

test("task generation retries a reasoning-only response with a larger budget", async () => {
  const pi = await importEsm<any>("@earendil-works/pi-ai/compat");
  const registration = pi.registerFauxProvider({
    api: "axiom-faux-task-generation",
    provider: "faux-task-provider",
    models: [{ id: "faux-task-model", reasoning: true, maxTokens: 32_000 }],
  });
  const observedOptions: any[] = [];
  registration.setResponses([
    (_context: any, options: any) => {
      observedOptions.push(options);
      return pi.fauxAssistantMessage([pi.fauxThinking("Planning the graph")], { stopReason: "length" });
    },
    (_context: any, options: any) => {
      observedOptions.push(options);
      return pi.fauxAssistantMessage(pi.fauxText(JSON.stringify({
        tasks: [{ key: "task-1", title: "Implement change", description: "Implement it", dependsOn: [] }],
        contexts: [],
      })));
    },
  ]);

  const sent: any[] = [];
  const ws = {
    readyState: WebSocket.OPEN,
    send: (payload: string) => sent.push(JSON.parse(payload)),
  } as unknown as WebSocket;

  try {
    await generateTaskNodes(ws, {
      requestId: "request-1",
      nodeId: "global-chat-1",
      model: "faux-task-provider/faux-task-model",
      customProvider: {
        id: "faux-task-provider",
        name: "Faux task provider",
        baseUrl: "https://faux.invalid",
        apiType: registration.api,
        authType: "none",
        models: [{
          id: "faux-task-provider/faux-task-model",
          remoteId: "faux-task-model",
          name: "Faux task model",
          apiType: registration.api,
          reasoning: true,
          maxTokens: 32_000,
        }],
      },
      chatHistory: [{ role: "user", content: "Implement the agreed change." }],
    });

    assert.equal(registration.state.callCount, 2);
    assert.equal(observedOptions[0].maxTokens, 16_000);
    assert.equal(observedOptions[0].reasoning, "minimal");
    assert.ok(sent.some((message) => message.type === "generate_task_nodes_log" && /no visible task JSON/.test(message.message)));
    const completed = sent.find((message) => message.type === "generate_task_nodes_complete");
    assert.equal(completed?.attempts, 2);
    assert.equal(completed?.tasks?.[0]?.title, "Implement change");
    assert.ok(!sent.some((message) => message.type === "generate_task_nodes_error"));
  } finally {
    registration.unregister();
  }
});
