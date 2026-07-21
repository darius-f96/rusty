import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import {
  RpcError,
  cleanupPendingRequests,
  getBackpressureStateForTests,
  pendingRequests,
  request,
  resetRpcStateForTests,
  resolvePendingResponse,
  safeSend,
  validateRpcResponse,
} from "./websocket";

function socket(send: (raw: string) => void): WebSocket {
  return { readyState: WebSocket.OPEN, send } as unknown as WebSocket;
}

test.beforeEach(() => resetRpcStateForTests());
test.afterEach(() => resetRpcStateForTests());

test("registers before sending and accepts an immediate response", async () => {
  let fakeSocket: WebSocket;
  fakeSocket = socket((raw) => {
    const sent = JSON.parse(raw);
    assert.equal(pendingRequests.has(sent.requestId), true);
    assert.equal(resolvePendingResponse(fakeSocket, { requestId: sent.requestId, runId: sent.runId, content: "ok" }).status, "resolved");
  });

  const response = await request(fakeSocket, {
    type: "read_file",
    runId: "run-1",
    payload: { path: "/tmp/example" },
    validateResponse: validateRpcResponse,
  });
  assert.equal(response.content, "ok");
  assert.equal(pendingRequests.size, 0);
});

test("send failure rejects immediately and cleans pending state", async () => {
  const fakeSocket = socket(() => { throw new Error("write exploded"); });
  await assert.rejects(
    request(fakeSocket, { type: "read_file", runId: "run-1", payload: {}, validateResponse: validateRpcResponse }),
    (error: unknown) => error instanceof RpcError && error.code === "RPC_SEND_FAILED",
  );
  assert.equal(pendingRequests.size, 0);
});

test("disconnect rejects every request owned by the socket", async () => {
  const fakeSocket = socket(() => undefined);
  const pending = request(fakeSocket, { type: "read_file", runId: "run-1", payload: {}, validateResponse: validateRpcResponse });
  cleanupPendingRequests(fakeSocket);
  await assert.rejects(pending, (error: unknown) => error instanceof RpcError && error.code === "RPC_DISCONNECTED");
  assert.equal(pendingRequests.size, 0);
});

test("a response from another socket cannot settle a request", async () => {
  let sentRequestId = "";
  const owner = socket((raw) => { sentRequestId = JSON.parse(raw).requestId; });
  const intruder = socket(() => undefined);
  const pending = request(owner, { type: "read_file", runId: "run-1", payload: {}, validateResponse: validateRpcResponse });

  const wrongOwner = resolvePendingResponse(intruder, { requestId: sentRequestId, runId: "run-1", content: "bad" });
  assert.equal(wrongOwner.status, "wrong_owner");
  assert.equal(pendingRequests.has(sentRequestId), true);
  resolvePendingResponse(owner, { requestId: sentRequestId, runId: "run-1", content: "good" });
  assert.equal((await pending).content, "good");
});

test("duplicate and unknown late responses have defined diagnostics", async () => {
  let sentRequestId = "";
  const fakeSocket = socket((raw) => { sentRequestId = JSON.parse(raw).requestId; });
  const pending = request(fakeSocket, { type: "read_file", runId: "run-1", payload: {}, validateResponse: validateRpcResponse });
  resolvePendingResponse(fakeSocket, { requestId: sentRequestId, runId: "run-1" });
  await pending;
  assert.equal(resolvePendingResponse(fakeSocket, { requestId: sentRequestId, runId: "run-1" }).status, "duplicate");
  assert.equal(resolvePendingResponse(fakeSocket, { requestId: "never-seen", runId: "run-1" }).status, "late");
});

test("timeout rejects and removes the pending entry", async () => {
  const fakeSocket = socket(() => undefined);
  await assert.rejects(
    request(fakeSocket, { type: "read_file", runId: "run-1", payload: {}, timeoutMs: 5, validateResponse: validateRpcResponse }),
    (error: unknown) => error instanceof RpcError && error.code === "RPC_TIMEOUT",
  );
  assert.equal(pendingRequests.size, 0);
});

test("invalid response payload rejects with a validation error", async () => {
  let sentRequestId = "";
  const fakeSocket = socket((raw) => { sentRequestId = JSON.parse(raw).requestId; });
  const pending = request(fakeSocket, {
    type: "read_file",
    runId: "run-1",
    payload: {},
    validateResponse(value) {
      const response = validateRpcResponse(value);
      if (typeof response.content !== "string") throw new Error("content is required");
      return response;
    },
  });
  resolvePendingResponse(fakeSocket, { requestId: sentRequestId, runId: "run-1", content: 42 });
  await assert.rejects(pending, (error: unknown) => error instanceof RpcError && error.code === "RPC_INVALID_PAYLOAD");
});

test("a mismatched run response rejects the owned request", async () => {
  let sentRequestId = "";
  const fakeSocket = socket((raw) => { sentRequestId = JSON.parse(raw).requestId; });
  const pending = request(fakeSocket, { type: "read_file", runId: "run-1", payload: {}, validateResponse: validateRpcResponse });
  const result = resolvePendingResponse(fakeSocket, { requestId: sentRequestId, runId: "run-2" });
  assert.equal(result.status, "invalid");
  await assert.rejects(pending, (error: unknown) => error instanceof RpcError && error.code === "RPC_INVALID_PAYLOAD");
});

test("concurrent requests use collision-resistant unique IDs", async () => {
  const ids: string[] = [];
  let fakeSocket: WebSocket;
  fakeSocket = socket((raw) => {
    const sent = JSON.parse(raw);
    ids.push(sent.requestId);
    queueMicrotask(() => resolvePendingResponse(fakeSocket, { requestId: sent.requestId, runId: sent.runId }));
  });
  await Promise.all(Array.from({ length: 100 }, () => request(fakeSocket, {
    type: "read_file",
    runId: "run-1",
    payload: {},
    validateResponse: validateRpcResponse,
  })));
  assert.equal(new Set(ids).size, 100);
  assert.equal(ids.every((id) => /^[0-9a-f-]{36}$/i.test(id)), true);
});

test("backpressure coalesces token chunks and bounds queued work", () => {
  const slowSocket = {
    readyState: WebSocket.OPEN,
    bufferedAmount: 600 * 1024,
    send() { throw new Error("send should remain delayed while pressure is high"); },
  } as unknown as WebSocket;
  assert.equal(safeSend(slowSocket, { type: "token", runId: "run-1", content: "a" }), true);
  assert.equal(safeSend(slowSocket, { type: "token", runId: "run-1", content: "b" }), true);
  assert.equal(getBackpressureStateForTests(slowSocket).queuedItems, 1);
  cleanupPendingRequests(slowSocket);
  assert.equal(getBackpressureStateForTests(slowSocket).queuedItems, 0);
});
