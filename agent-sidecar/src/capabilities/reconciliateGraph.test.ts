import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import { buildOverlappingFileContext, reconciliateGraph } from "./reconciliateGraph";
import { importEsm } from "../services/esmImport";
import { pendingRequests } from "../services/websocket";

test("builds overlap context from the live VFS and each owning task version", async () => {
  const workspaceRoot = path.resolve("/workspace/project");
  const absoluteFile = path.join(workspaceRoot, "src/shared.ts");
  const reads: string[] = [];

  const context = await buildOverlappingFileContext({
    workspaceRoot,
    duplicateFiles: { "src/shared.ts": ["task-a", "task-b"] },
    nodes: [
      {
        id: "task-a",
        name: "Add A",
        prompt: "Keep behavior A",
        generatedFileContents: { [absoluteFile]: "export const a = true;" },
        originalFileContents: { "src/shared.ts": "export {};" },
      },
      {
        id: "task-b",
        name: "Add B",
        prompt: "Keep behavior B",
        generatedFileContents: { "src/shared.ts": "export const b = true;" },
      },
      {
        id: "unrelated",
        generatedFileContents: { "src/shared.ts": "must not be included" },
      },
    ],
    readVfsFile: async (filePath) => {
      reads.push(filePath);
      return "export const current = true;";
    },
  });

  assert.deepEqual(reads, [absoluteFile]);
  assert.equal(context.length, 1);
  assert.equal(context[0].path, absoluteFile);
  assert.equal(context[0].currentVfsContent, "export const current = true;");
  assert.deepEqual(context[0].tasks.map((task) => task.id), ["task-a", "task-b"]);
  assert.equal(context[0].tasks[0].originalContent, "export {};");
  assert.equal(context[0].tasks[0].generatedContent, "export const a = true;");
  assert.equal(context[0].tasks[1].generatedContent, "export const b = true;");
});

test("rejects overlap paths outside the workspace", async () => {
  await assert.rejects(
    buildOverlappingFileContext({
      workspaceRoot: path.resolve("/workspace/project"),
      duplicateFiles: { "../outside.ts": ["task-a"] },
      nodes: [{ id: "task-a" }],
      readVfsFile: async () => "",
    }),
    /must be inside the workspace/,
  );
});

test("writes an overlap fix while leaving ordinary changed files TaskNode-owned", async () => {
  const pi = await importEsm<any>("@earendil-works/pi-ai/compat");
  const registration = pi.registerFauxProvider({ api: "axiom-reconciliation-test", provider: "faux-reconciliation" });
  const mergedContent = "export const a = true;\nexport const b = true;\n";
  const workspaceRoot = path.resolve("/workspace/project");
  const filePath = path.join(workspaceRoot, "src/shared.ts");
  registration.setResponses([
    pi.fauxAssistantMessage(
      [pi.fauxToolCall("write_file", { path: filePath, content: mergedContent })],
      { stopReason: "toolUse" },
    ),
    pi.fauxAssistantMessage([pi.fauxText("Merged both task behaviors in shared.ts.")]),
  ]);

  const uniqueFilePath = path.join(workspaceRoot, "src/only-a.ts");
  const vfs = new Map([
    [filePath, "export const b = true;\n"],
    [uniqueFilePath, "export const onlyA = true;\n"],
  ]);
  const sent: any[] = [];
  const fakeSocket = {
    readyState: WebSocket.OPEN,
    send(raw: string) {
      const message = JSON.parse(raw);
      sent.push(message);
      if (message.type !== "read_file" && message.type !== "write_file") return;

      queueMicrotask(() => {
        if (message.type === "write_file") vfs.set(message.path, message.content);
        const pending = pendingRequests.get(message.requestId);
        pending?.resolver(message.type === "read_file"
          ? { requestId: message.requestId, content: vfs.get(message.path) ?? "" }
          : { requestId: message.requestId });
        pendingRequests.delete(message.requestId);
      });
    },
  } as unknown as WebSocket;

  try {
    await reconciliateGraph(fakeSocket, {
      tabId: "canvas-1",
      model: "faux-reconciliation/faux-model",
      workspaceRoot,
      duplicateFiles: { [filePath]: ["task-a", "task-b"] },
      nodes: [
        {
          id: "task-a",
          prompt: "Keep A",
          modifiedFiles: [filePath, uniqueFilePath],
          generatedFileContents: { [filePath]: "export const a = true;\n", [uniqueFilePath]: "export const onlyA = true;\n" },
        },
        {
          id: "task-b",
          prompt: "Keep B",
          modifiedFiles: [filePath],
          generatedFileContents: { [filePath]: "export const b = true;\n" },
        },
      ],
      chatHistory: [],
      customProvider: {
        id: "faux-reconciliation",
        name: "Faux Reconciliation",
        baseUrl: "https://faux.invalid",
        apiType: registration.api,
        authType: "none",
        models: [{
          id: "faux-reconciliation/faux-model",
          remoteId: "faux-model",
          name: "Faux Model",
          apiType: registration.api,
        }],
      },
    });

    const writes = sent.filter((message) => message.type === "write_file");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, filePath);
    assert.equal(writes[0].content, mergedContent);

    const completion = sent.find((message) => message.type === "reconciliation_graph_complete");
    assert.deepEqual(completion.reconciledFiles, [filePath]);
    assert.deepEqual(completion.modifiedFiles, [filePath]);
    assert.deepEqual(completion.reviewedFiles, [filePath]);
    assert.equal(sent.find((message) => message.type === "reconciliation_file_complete")?.filePath, filePath);
  } finally {
    registration.unregister();
  }
});

test("reviews multiple overlaps as independent single-file model calls", async () => {
  const pi = await importEsm<any>("@earendil-works/pi-ai/compat");
  const registration = pi.registerFauxProvider({ api: "axiom-reconciliation-case-test", provider: "faux-reconciliation-cases" });
  const workspaceRoot = path.resolve("/workspace/project");
  const firstPath = path.join(workspaceRoot, "src/first.ts");
  const secondPath = path.join(workspaceRoot, "src/second.ts");
  const vfs = new Map([
    [firstPath, "export const first = true;\n"],
    [secondPath, "export const second = true;\n"],
  ]);
  registration.setResponses([
    pi.fauxAssistantMessage([pi.fauxText("FIRST_CASE_REVIEWED")]),
    pi.fauxAssistantMessage([pi.fauxText("SECOND_CASE_REVIEWED")]),
  ]);

  const sent: any[] = [];
  const fakeSocket = {
    readyState: WebSocket.OPEN,
    send(raw: string) {
      const message = JSON.parse(raw);
      sent.push(message);
      if (message.type !== "read_file" && message.type !== "write_file") return;
      queueMicrotask(() => {
        if (message.type === "write_file") vfs.set(message.path, message.content);
        const pending = pendingRequests.get(message.requestId);
        pending?.resolver(message.type === "read_file"
          ? { requestId: message.requestId, content: vfs.get(message.path) ?? "" }
          : { requestId: message.requestId });
        pendingRequests.delete(message.requestId);
      });
    },
  } as unknown as WebSocket;

  try {
    await reconciliateGraph(fakeSocket, {
      tabId: "canvas-cases",
      model: "faux-reconciliation-cases/faux-model",
      workspaceRoot,
      duplicateFiles: {
        [firstPath]: ["task-a", "task-b"],
        [secondPath]: ["task-a", "task-b"],
      },
      nodes: [
        {
          id: "task-a",
          modifiedFiles: [firstPath, secondPath],
          generatedFileContents: {
            [firstPath]: "export const first = \"a\";\n",
            [secondPath]: "export const second = \"a\";\n",
          },
        },
        {
          id: "task-b",
          modifiedFiles: [firstPath, secondPath],
          generatedFileContents: {
            [firstPath]: "export const first = \"b\";\n",
            [secondPath]: "export const second = \"b\";\n",
          },
        },
      ],
      chatHistory: [],
      customProvider: {
        id: "faux-reconciliation-cases",
        name: "Faux Reconciliation Cases",
        baseUrl: "https://faux.invalid",
        apiType: registration.api,
        authType: "none",
        models: [{
          id: "faux-reconciliation-cases/faux-model",
          remoteId: "faux-model",
          name: "Faux Model",
          apiType: registration.api,
        }],
      },
    });

    const completion = sent.find((message) => message.type === "reconciliation_graph_complete");
    assert.match(completion.response, /FIRST_CASE_REVIEWED/);
    assert.match(completion.response, /SECOND_CASE_REVIEWED/);
    assert.deepEqual(completion.reviewedFiles, [firstPath, secondPath]);
  } finally {
    registration.unregister();
  }
});

test("records completed cases and identifies the exact file when a later case fails", async () => {
  const pi = await importEsm<any>("@earendil-works/pi-ai/compat");
  const registration = pi.registerFauxProvider({ api: "axiom-reconciliation-error-test", provider: "faux-reconciliation-error" });
  const workspaceRoot = path.resolve("/workspace/project");
  const firstPath = path.join(workspaceRoot, "src/complete.ts");
  const failingPath = path.join(workspaceRoot, "src/failing.ts");
  const vfs = new Map([
    [firstPath, "export const complete = true;\n"],
    [failingPath, "export const failing = true;\n"],
  ]);
  registration.setResponses([
    pi.fauxAssistantMessage([pi.fauxText("First file is compatible.")]),
    () => { throw new Error("MODEL_CASE_FAILURE"); },
  ]);
  const sent: any[] = [];
  const fakeSocket = {
    readyState: WebSocket.OPEN,
    send(raw: string) {
      const message = JSON.parse(raw);
      sent.push(message);
      if (message.type !== "read_file" && message.type !== "write_file") return;
      queueMicrotask(() => {
        const pending = pendingRequests.get(message.requestId);
        pending?.resolver(message.type === "read_file"
          ? { requestId: message.requestId, content: vfs.get(message.path) ?? "" }
          : { requestId: message.requestId });
        pendingRequests.delete(message.requestId);
      });
    },
  } as unknown as WebSocket;

  try {
    await reconciliateGraph(fakeSocket, {
      tabId: "canvas-error-ledger",
      model: "faux-reconciliation-error/faux-model",
      workspaceRoot,
      duplicateFiles: {
        [firstPath]: ["task-a", "task-b"],
        [failingPath]: ["task-a", "task-b"],
      },
      nodes: [
        { id: "task-a", modifiedFiles: [firstPath, failingPath] },
        { id: "task-b", modifiedFiles: [firstPath, failingPath] },
      ],
      chatHistory: [],
      customProvider: {
        id: "faux-reconciliation-error",
        name: "Faux Reconciliation Error",
        baseUrl: "https://faux.invalid",
        apiType: registration.api,
        authType: "none",
        models: [{
          id: "faux-reconciliation-error/faux-model",
          remoteId: "faux-model",
          name: "Faux Model",
          apiType: registration.api,
        }],
      },
    });

    assert.equal(sent.find((message) => message.type === "reconciliation_file_complete")?.filePath, firstPath);
    assert.equal(sent.find((message) => message.type === "reconciliation_file_error")?.filePath, failingPath);
    assert.equal(sent.find((message) => message.type === "reconciliation_graph_error")?.filePath, failingPath);
    assert.equal(sent.some((message) => message.type === "reconciliation_graph_complete"), false);
  } finally {
    registration.unregister();
  }
});

test("leaves non-overlapping task files outside the reconciliation owner", async () => {
  const workspaceRoot = path.resolve("/workspace/project");
  const filePath = path.join(workspaceRoot, "src/unique.ts");
  const content = "export const unique = true;\n";
  const sent: any[] = [];
  const fakeSocket = {
    readyState: WebSocket.OPEN,
    send(raw: string) {
      const message = JSON.parse(raw);
      sent.push(message);
      if (message.type !== "read_file" && message.type !== "write_file") return;
      queueMicrotask(() => {
        const pending = pendingRequests.get(message.requestId);
        pending?.resolver(message.type === "read_file"
          ? { requestId: message.requestId, content }
          : { requestId: message.requestId });
        pendingRequests.delete(message.requestId);
      });
    },
  } as unknown as WebSocket;

  await reconciliateGraph(fakeSocket, {
    tabId: "canvas-no-overlaps",
    workspaceRoot,
    duplicateFiles: {},
    nodes: [{ id: "task-a", modifiedFiles: [filePath], generatedFileContents: { [filePath]: content } }],
    chatHistory: [],
  });

  const completion = sent.find((message) => message.type === "reconciliation_graph_complete");
  assert.deepEqual(completion.reconciledFiles, []);
  assert.deepEqual(completion.reviewedFiles, []);
  assert.deepEqual(completion.modifiedFiles, []);
  assert.equal(sent.some((message) => message.type === "read_file" || message.type === "write_file"), false);
  assert.match(completion.response, /No unreconciled overlapping task files/);
});

test("does not inspect or rewrite a stale non-overlapping TaskNode VFS key", async () => {
  const workspaceRoot = path.resolve("/Users/current/Development/wbc/wbc-core-service-api");
  const staleVfsPath = path.resolve("/Users/previous/Development/wbc/wbc-core-service-api/docs/security/MINIO_PRESIGN_INFRA_GATE.md");
  const activeWorkspacePath = path.join(workspaceRoot, "docs/security/MINIO_PRESIGN_INFRA_GATE.md");
  const content = "# VFS-only reconciliation content\n";
  const sent: any[] = [];
  const fakeSocket = {
    readyState: WebSocket.OPEN,
    send(raw: string) {
      const message = JSON.parse(raw);
      sent.push(message);
      if (message.type !== "read_file" && message.type !== "write_file") return;
      queueMicrotask(() => {
        const pending = pendingRequests.get(message.requestId);
        pending?.resolver(message.type === "read_file"
          ? { requestId: message.requestId, content }
          : { requestId: message.requestId });
        pendingRequests.delete(message.requestId);
      });
    },
  } as unknown as WebSocket;

  await reconciliateGraph(fakeSocket, {
    tabId: "canvas-stale-vfs-path",
    workspaceRoot,
    duplicateFiles: {},
    fileSources: { [activeWorkspacePath]: staleVfsPath },
    nodes: [{
      id: "task-a",
      modifiedFiles: [staleVfsPath],
      generatedFileContents: { [staleVfsPath]: content },
    }],
    chatHistory: [],
  });

  const reads = sent.filter((message) => message.type === "read_file");
  const writes = sent.filter((message) => message.type === "write_file");
  assert.deepEqual(reads, []);
  assert.deepEqual(writes, []);

  const completion = sent.find((message) => message.type === "reconciliation_graph_complete");
  assert.deepEqual(completion.reconciledFiles, []);
  assert.deepEqual(completion.reviewedFiles, []);
});
