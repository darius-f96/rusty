/**
 * Test Build Capability
 *
 * Temporarily applies reconciled files to disk (managed by the frontend caller),
 * runs the user-specified build command, and if it fails, asks the model to
 * fix the reconciled files in-place before retrying — up to MAX_ATTEMPTS times.
 *
 * Protocol (frontend → sidecar):
 *   test_build   { tabId, buildCommand, workspaceRoot, reconciledFiles, model, customProvider }
 *
 * Protocol (sidecar → frontend):
 *   test_build_log       { streamId, message }
 *   test_build_iteration { streamId, attempt, maxAttempts }
 *   test_build_complete  { streamId, success, attempts, finalFiles }
 *   test_build_error     { streamId, error }
 */

import { WebSocket } from "ws";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { safeSend } from "../services/websocket";
import { executeCommand } from "../services/commandExecution";
import { callLlmWithToolsPiStreaming } from "../services/llmRuntime";
import type { NormalizedCommand } from "../services/commandPermissions";

const MAX_ATTEMPTS = 5;
const BUILD_TIMEOUT_MS = 5 * 60_000;
const MAX_BUILD_OUTPUT_CHARS = 12_000;

export function getTestBuildStreamId(tabId: string): string {
  return `__test_build__:${tabId}`;
}

export async function testBuild(ws: WebSocket, data: any): Promise<void> {
  const { tabId, buildCommand, workspaceRoot, reconciledFiles, model, customProvider } = data;
  const streamId = getTestBuildStreamId(tabId);

  const sendLog = (message: string) => {
    console.log(`[TestBuild] ${message}`);
    safeSend(ws, { type: "test_build_log", nodeId: streamId, message });
  };

  const sendError = (error: string) => {
    safeSend(ws, { type: "test_build_error", nodeId: streamId, error });
  };

  // ── Parse the build command ────────────────────────────────────────────
  const parts = String(buildCommand || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    sendError("No build command provided.");
    return;
  }

  const filePaths: string[] = Array.isArray(reconciledFiles)
    ? reconciledFiles.filter((p: any) => typeof p === "string")
    : [];
  if (!filePaths.length) {
    sendError("No reconciled files to test.");
    return;
  }

  const command: NormalizedCommand = {
    program: parts[0],
    args: parts.slice(1),
    cwd: String(workspaceRoot || "."),
    timeoutMs: BUILD_TIMEOUT_MS,
  };

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (ws.readyState !== WebSocket.OPEN) return;

      sendLog(`--- Build attempt ${attempt}/${MAX_ATTEMPTS} ---`);
      safeSend(ws, { type: "test_build_iteration", nodeId: streamId, attempt, maxAttempts: MAX_ATTEMPTS });

      let buildOutput = "";
      const result = await executeCommand(streamId, command, (_stream, content) => {
        sendLog(content.trimEnd());
        buildOutput += content;
        if (buildOutput.length > MAX_BUILD_OUTPUT_CHARS * 2) {
          buildOutput = buildOutput.slice(-MAX_BUILD_OUTPUT_CHARS);
        }
      });

      // ── Build passed ─────────────────────────────────────────────────
      if (result.exitCode === 0) {
        const finalFiles = await readDiskFiles(filePaths);
        sendLog(`Build passed after ${attempt} attempt${attempt === 1 ? "" : "s"}.`);
        safeSend(ws, { type: "test_build_complete", nodeId: streamId, success: true, attempts: attempt, finalFiles });
        return;
      }

      // ── Build failed ─────────────────────────────────────────────────
      const exitDesc = result.timedOut ? "timed out" : `exit ${result.exitCode ?? "null"}`;
      sendLog(`Build failed (${exitDesc}).`);

      if (attempt === MAX_ATTEMPTS) break;

      sendLog("Calling model to diagnose and fix the build errors...");

      const truncatedOutput = buildOutput.length > MAX_BUILD_OUTPUT_CHARS
        ? `...(truncated)...\n${buildOutput.slice(-MAX_BUILD_OUTPUT_CHARS)}`
        : buildOutput;

      const systemPrompt = `You are a build error fixer. A set of reconciled source files has been applied to disk and the build failed.

Your job: read the relevant files, understand the errors, and write fixed versions.

Workspace: ${workspaceRoot}
Files you may modify (reconciled files only):
${filePaths.map((f) => `- ${f}`).join("\n")}

Rules:
- Only modify files from the list above.
- Write COMPLETE file contents — never partial edits or diffs.
- Do not add comments, documentation, or unrelated changes.
- Fix exactly what the build output indicates is broken, nothing more.
- If you are not sure about a fix, make the minimal safe change.`;

      const userMessage = `The build failed with the following output:

\`\`\`
${truncatedOutput}
\`\`\`

Read the affected files and fix the errors so the build passes.`;

      const readFileTool = {
        name: "read_file",
        description: "Read a file from disk.",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string", description: "Absolute or workspace-relative file path" } },
          required: ["path"],
        },
        execute: async ({ path: filePath }: { path: string }) => {
          const resolved = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
          sendLog(`Model reading: ${resolved}`);
          return await fsp.readFile(resolved, "utf-8");
        },
      };

      const filePathSet = new Set(filePaths);
      const writeFileTool = {
        name: "write_file",
        description: "Write a fixed version of a reconciled file to disk.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute or workspace-relative file path" },
            content: { type: "string", description: "The complete fixed file content" },
          },
          required: ["path", "content"],
        },
        execute: async ({ path: filePath, content }: { path: string; content: string }) => {
          const resolved = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
          if (!filePathSet.has(resolved)) {
            throw new Error(`Only reconciled files may be modified. '${resolved}' is not in scope.`);
          }
          sendLog(`Model fixing: ${resolved} (${content.length} chars)`);
          await fsp.writeFile(resolved, content, "utf-8");
          return `Fixed: ${resolved}`;
        },
      };

      await callLlmWithToolsPiStreaming({
        modelReference: model,
        customProvider,
        systemPrompt,
        userMessage,
        tools: [readFileTool, writeFileTool],
        sendLog,
        sendToken: (token) => safeSend(ws, { type: "test_build_token", nodeId: streamId, content: token }),
        maxRounds: 30,
        cwd: workspaceRoot,
        history: [],
        shouldAbort: () => ws.readyState !== WebSocket.OPEN,
      });

      sendLog("Model finished. Re-running build...");
    }

    // ── All attempts exhausted ─────────────────────────────────────────
    const finalFiles = await readDiskFiles(filePaths);
    sendLog(`Build did not pass after ${MAX_ATTEMPTS} attempts.`);
    safeSend(ws, { type: "test_build_complete", nodeId: streamId, success: false, attempts: MAX_ATTEMPTS, finalFiles });
  } catch (err: any) {
    console.error("[TestBuild] Unexpected error:", err);
    sendError(err?.message || String(err));
  }
}

async function readDiskFiles(paths: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const filePath of paths) {
    try {
      result[filePath] = await fsp.readFile(filePath, "utf-8");
    } catch {
      // File may not exist on disk yet
    }
  }
  return result;
}
