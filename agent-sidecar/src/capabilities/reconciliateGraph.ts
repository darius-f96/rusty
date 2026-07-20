import { WebSocket } from "ws";
import path from "path";
import { safeSend, getNextId, registerPendingRequest } from "../services/websocket";
import { createListFilesTool, createSearchCodebaseTool } from "../services/tools";
import { runPiAgentChat } from "../services/piAgentChat";
import { callLlmWithToolsPiStreaming } from "../services/llmRuntime";
import { authorizeCommand } from "../services/commandPermissions";
import { normalizeCommand } from "../services/commandExecution";
import {
  detectBuildCommand,
  executeBuildWithTemporaryReconciliation,
  prepareReconciliationVerificationFiles,
  WorkspaceRollbackError,
} from "../services/reconciliationBuildVerification";

interface ReconciliationBuildVerification {
  status: "passed" | "failed" | "skipped";
  command?: { program: string; args: string[]; cwd: string };
  exitCode?: number | null;
  timedOut?: boolean;
  reason?: string;
}

function commandText(command: { program: string; args: string[] }): string {
  return [command.program, ...command.args].join(" ");
}

function verificationSummary(verification: ReconciliationBuildVerification): string {
  const command = verification.command ? ` (${commandText(verification.command)})` : "";
  if (verification.status === "passed") {
    return `Stage 2 — Build verification passed${command}. The physical workspace was restored; reconciled changes remain in the VFS until Apply Axiom.`;
  }
  if (verification.status === "failed") {
    return `Stage 2 — Build verification failed${command}: ${verification.reason || "unknown failure"}. The physical workspace was restored; reconciled changes remain available in the VFS for review.`;
  }
  return `Stage 2 — Build verification skipped${command}: ${verification.reason || "no supported build command was found"}. Reconciled changes remain in the VFS until Apply Axiom.`;
}

async function verifyReconciledBuild(options: {
  ws: WebSocket;
  sessionId: string;
  workspaceRoot: string;
  filePaths: string[];
  readVfsFile: (absolutePath: string) => Promise<string>;
  sendLog: (message: string) => void;
}): Promise<ReconciliationBuildVerification> {
  let prepared;
  try {
    prepared = await prepareReconciliationVerificationFiles(
      options.workspaceRoot,
      options.filePaths,
      options.readVfsFile,
    );
  } catch (error: any) {
    return { status: "failed", reason: `could not prepare the VFS overlay: ${error.message || String(error)}` };
  }

  if (prepared.files.length === 0) {
    return { status: "skipped", reason: "there are no reconciled VFS files to verify" };
  }

  let detectedCommand;
  try {
    detectedCommand = await detectBuildCommand(prepared.workspaceRoot, prepared.files);
  } catch (error: any) {
    return { status: "failed", reason: error.message || String(error) };
  }
  if (!detectedCommand) {
    return { status: "skipped", reason: "no supported project build command was detected" };
  }

  let command;
  try {
    command = await normalizeCommand(detectedCommand, prepared.workspaceRoot);
  } catch (error: any) {
    return { status: "failed", reason: `the detected build command is invalid: ${error.message || String(error)}` };
  }
  const publicCommand = { program: command.program, args: command.args, cwd: command.cwd };

  options.sendLog(`Stage 2: requesting approval to verify the reconciled build with: ${commandText(command)}`);
  try {
    await authorizeCommand(options.ws, options.sessionId, command);
  } catch (error: any) {
    const reason = error.message || String(error);
    if (reason.toLowerCase().includes("denied")) {
      return { status: "skipped", command: publicCommand, reason: "command permission was denied" };
    }
    return { status: "failed", command: publicCommand, reason: `command authorization failed: ${reason}` };
  }

  options.sendLog(`Stage 2: temporarily materializing ${prepared.files.length} VFS file(s) for build verification.`);
  let outcome;
  try {
    outcome = await executeBuildWithTemporaryReconciliation(
      options.sessionId,
      prepared.workspaceRoot,
      prepared.files,
      command,
      (stream, content) => safeSend(options.ws, {
        type: "command_output",
        sessionId: options.sessionId,
        stream,
        content,
      }),
    );
  } catch (error: any) {
    if (error instanceof WorkspaceRollbackError) throw error;
    safeSend(options.ws, {
      type: "command_complete",
      sessionId: options.sessionId,
      exitCode: null,
      signal: null,
      timedOut: false,
      error: error.message || String(error),
    });
    return { status: "failed", command: publicCommand, reason: error.message || String(error) };
  }

  const result = outcome.result;
  safeSend(options.ws, {
    type: "command_complete",
    sessionId: options.sessionId,
    exitCode: result?.exitCode ?? null,
    signal: result?.signal ?? null,
    timedOut: result?.timedOut ?? false,
    error: outcome.error?.message,
  });
  options.sendLog("Stage 2: physical workspace restored; VFS changes are still pending Apply Axiom.");

  if (outcome.error) {
    return { status: "failed", command: publicCommand, reason: outcome.error.message };
  }
  if (!result) {
    return { status: "failed", command: publicCommand, reason: "the build produced no result" };
  }
  if (result.timedOut) {
    return { status: "failed", command: publicCommand, exitCode: result.exitCode, timedOut: true, reason: "the build timed out" };
  }
  if (result.exitCode !== 0) {
    const reason = result.exitCode === null
      ? `the build stopped with signal ${result.signal || "unknown"}`
      : `the build exited with code ${result.exitCode}`;
    return { status: "failed", command: publicCommand, exitCode: result.exitCode, reason };
  }
  return { status: "passed", command: publicCommand, exitCode: result.exitCode, timedOut: false };
}

export async function reconciliateGraph(ws: WebSocket, data: any): Promise<void> {
  const { tabId, model, nodes, workspaceRoot, customProvider, duplicateFiles, chatHistory, userMessage } = data;
  console.log(`WebSocket [Server] reconciliate_graph starting for tab: ${tabId}, userMessage: ${userMessage || "none"}`);

  const reconciliationStreamId = `__reconciliation__:${tabId}`;
  const reconciledFiles = new Set<string>();
  const sendLog = (message: string) => {
    console.log(`[ReconciliateGraph] ${message}`);
    safeSend(ws, { type: "log", nodeId: reconciliationStreamId, message });
  };

  try {
    const requestVfsFile = (resolvedPath: string): Promise<string> => {
      return new Promise((resolve, reject) => {
        const requestId = getNextId();
        registerPendingRequest(requestId, ws, (res) => {
          if (res.error) reject(new Error(res.error));
          else resolve(String(res.content ?? ""));
        });
        safeSend(ws, { type: "read_file", requestId, path: resolvedPath });
      });
    };

    const readVfsTool = {
      name: "read_file",
      description: "Read a file from the workspace VFS.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      execute: async ({ path: filePath }: { path: string }) => {
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
        sendLog(`AI reading VFS file: ${filePath}`);
        try {
          return await requestVfsFile(resolvedPath);
        } catch (error: any) {
          const errorMsg = String(error.message || error).toLowerCase();
          if (errorMsg.includes("not found") || errorMsg.includes("no such file") || errorMsg.includes("exist")) {
            return "[File does not exist yet. You can create it by calling write_file with content.]";
          }
          throw error;
        }
      }
    };

    const writeVfsTool = {
      name: "write_file",
      description: "Write file content to the virtual workspace VFS.",
      inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
      execute: async ({ path: filePath, content }: { path: string; content: string }) => {
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
        sendLog(`AI modifying VFS file: ${filePath}`);
        return new Promise((resolve, reject) => {
          const requestId = getNextId();
          registerPendingRequest(requestId, ws, (res) => {
            if (res.error) reject(new Error(res.error));
            else {
              reconciledFiles.add(resolvedPath);
              resolve(`File successfully written to: ${resolvedPath}`);
            }
          });
          safeSend(ws, { type: "write_file", requestId, path: resolvedPath, content });
        });
      }
    };

    const formattedNodes = Array.isArray(nodes) ? nodes : [];
    const duplicateFilePaths = new Set(Object.keys(duplicateFiles || {}));
    const relevantFileVersions = (contents: Record<string, string> | undefined) => Object.fromEntries(
      Object.entries(contents || {}).filter(([filePath]) => duplicateFilePaths.has(filePath))
    );
    const tasksPromptInfo = formattedNodes.map((n: any, index: number) => `
Task ${index + 1}:
- Node ID: ${n.id}
- Name: ${n.name || "Unnamed Task"}
- Purpose/Instructions: ${n.prompt || "None"}
- Chat History: ${JSON.stringify(n.chatHistory || [])}
- Modified Files in VFS: ${Array.isArray(n.modifiedFiles) ? n.modifiedFiles.join(", ") : "None"}
- Original Filesystem Snapshot: ${JSON.stringify(relevantFileVersions(n.originalFileContents))}
- Code Generated by This Task: ${JSON.stringify(relevantFileVersions(n.generatedFileContents))}
`).join("\n---\n");

    const duplicateFilesList = Object.entries(duplicateFiles || {})
      .map(([file, taskIds]) => `- File: ${file}\n  Modified by Tasks: ${(taskIds as string[]).join(", ")}`)
      .join("\n");

    const systemPrompt = `You are a code reconciliation assistant inside a spatial development canvas.
Your job is to reconcile and align conflicting code changes made to the same files by different tasks.

Here are the tasks in the current workspace:
${tasksPromptInfo}

The following files were modified by multiple separate tasks (collisions/overlaps):
${duplicateFilesList || "No duplicate modifications detected."}

Your instructions:
1. Core Goal: Reconcile and merge conflicting or overlapping changes on files modified by multiple tasks. Each task's exact generated version is provided under "Code Generated by This Task"; compare those node-owned versions rather than assuming the shared VFS version represents every task.
2. Analyze the requirements, instructions, and conversation/chat history of all colliding tasks.
3. Merge their implementations so that the reconciled file satisfies the overlapping requirements of all tasks that modified it. You must take into context not just the files themselves, but also the requirements of each task that overlap.
4. VFS Constraints:
   - You can read files from the project using 'read_file' to understand their structure and content.
   - Any reconciliation, addition, modification, or deletion you make MUST be performed exclusively in the Virtual File System (VFS) using the 'write_file' tool.
   - Do NOT touch or make changes to the real physical filesystem directly. Any new files, edits, or deletes must be confined to the VFS.
5. CRITICAL: When writing, write complete files with all changes included. Never write partial snippets or placeholders.
6. Finally, report which files were reconciled, which new files/documentation were generated (if any), and provide a clear explanation of how they were aligned (Stage 1).
7. Do not execute physical workspace commands. After you finish Stage 1, Axiom performs Stage 2 itself by temporarily materializing the VFS files, running the detected build, and restoring the physical files.
8. If the user provides chat feedback/messages, adjust the code, write/create files, or modify documents in the VFS based on their specific requests.

Workspace root: ${workspaceRoot || "unknown"}
`;

    const promptText = userMessage || "Perform automatic reconciliation of the duplicate files across tasks.";

    const reconciliationTools = [readVfsTool, writeVfsTool, createListFilesTool(workspaceRoot), createSearchCodebaseTool(workspaceRoot)];
    (ws as any).__activeAgentTabId = reconciliationStreamId;
    const piModel = model || customProvider?.models?.find((item: any) => item.supported !== false)?.id || "";
    if (!piModel) throw new Error("No model is selected. Configure one in LLM Setup.");
    let response = await runPiAgentChat({
      tabId: reconciliationStreamId,
      model: piModel,
      workspaceRoot,
      systemPrompt: `${systemPrompt}\n\nUse Agent subagents when independent reconciliation investigations can run concurrently. Retrieve all delegated results before writing the final reconciled files.`,
      conversationHistory: chatHistory || [],
      message: promptText,
      tools: reconciliationTools,
      customProvider,
      sendLog,
      sendToken: () => {},
      sendSubagentUpdate: (subagent) => safeSend(ws, { type: "subagent_update", tabId: reconciliationStreamId, nodeId: reconciliationStreamId, subagent }),
    });
    if (response === undefined) {
      sendLog("Using the provider-compatible Pi tool runtime for reconciliation.");
      response = await callLlmWithToolsPiStreaming({
        modelReference: piModel,
        customProvider,
        systemPrompt,
        userMessage: promptText,
        tools: reconciliationTools,
        sendLog,
        sendToken: () => {},
        maxRounds: 15,
        cwd: workspaceRoot,
        history: chatHistory || [],
        shouldAbort: () => ws.readyState !== WebSocket.OPEN,
      });
    }

    const verificationFilePaths = new Set<string>([
      ...Object.keys(duplicateFiles || {}),
      ...formattedNodes.flatMap((node: any) => Array.isArray(node.modifiedFiles) ? node.modifiedFiles : []),
      ...reconciledFiles,
    ].filter((filePath): filePath is string => typeof filePath === "string" && filePath.trim().length > 0));
    const verification = await verifyReconciledBuild({
      ws,
      sessionId: reconciliationStreamId,
      workspaceRoot,
      filePaths: Array.from(verificationFilePaths),
      readVfsFile: requestVfsFile,
      sendLog,
    });
    const finalResponse = `${String(response || "Reconciliation complete.")}\n\n${verificationSummary(verification)}`;
    sendLog(verificationSummary(verification));

    safeSend(ws, {
      type: "reconciliation_graph_complete",
      tabId,
      response: finalResponse,
      verification,
    });
  } catch (err: any) {
    console.error("WebSocket [Server] reconciliate_graph error:", err);
    safeSend(ws, {
      type: "reconciliation_graph_error",
      tabId,
      error: err.message
    });
  }
}
