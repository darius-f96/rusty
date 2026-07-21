import path from "path";
import { WebSocket } from "ws";
import { callLlmWithToolsPiStreaming } from "../services/llmRuntime";
import { request, safeSend, validateRpcResponse } from "../services/websocket";

interface ReconciliationNode {
  id: string;
  name?: string;
  prompt?: string;
  chatHistory?: unknown[];
  modifiedFiles?: string[];
  originalFileContents?: Record<string, string>;
  generatedFileContents?: Record<string, string>;
}

interface OverlappingFileContext {
  path: string;
  currentVfsContent: string;
  tasks: Array<{
    id: string;
    name: string;
    instructions: string;
    chatHistory: unknown[];
    originalContent?: string;
    generatedContent?: string;
  }>;
}

interface NormalizedWorkspaceFile {
  /** Active-workspace destination used for reconciliation ownership and Apply. */
  workspacePath: string;
  /** Exact existing VFS key used to read the task's current in-memory content. */
  vfsPath: string;
}

const MAX_TASK_INSTRUCTION_CHARS = 4_000;
const MAX_TASK_CHAT_MESSAGES = 4;
const MAX_TASK_CHAT_CHARS = 4_000;
const MAX_RECONCILIATION_CHAT_MESSAGES = 4;
const MAX_RECONCILIATION_CHAT_CHARS = 4_000;

function truncateContextText(value: unknown, maxChars: number): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[...older context truncated...]`;
}

function compactChatHistory(history: unknown[], maxMessages: number, maxChars: number): string[] {
  const messages = history.slice(-maxMessages).map((entry) => {
    if (entry && typeof entry === "object") {
      const role = "role" in entry ? String((entry as any).role || "message") : "message";
      const content = "content" in entry ? (entry as any).content : entry;
      return `${role}: ${truncateContextText(content, maxChars)}`;
    }
    return truncateContextText(entry, maxChars);
  });

  const compacted: string[] = [];
  let remaining = maxChars;
  for (let index = messages.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const message = messages[index];
    const kept = message.slice(Math.max(0, message.length - remaining));
    compacted.unshift(kept);
    remaining -= kept.length;
  }
  return compacted;
}

/** Build a context payload for exactly one overlapping file. */
function compactFileContext(file: OverlappingFileContext): Record<string, unknown> {
  const includedVersions = new Map<string, string>();
  return {
    path: file.path,
    currentVfsContent: file.currentVfsContent,
    tasks: file.tasks.map((task) => {
      let generatedVersion: Record<string, unknown>;
      if (task.generatedContent === undefined) {
        generatedVersion = { available: false };
      } else if (task.generatedContent === file.currentVfsContent) {
        generatedVersion = { available: true, sameAsCurrentVfs: true };
      } else if (includedVersions.has(task.generatedContent)) {
        generatedVersion = {
          available: true,
          sameAsTask: includedVersions.get(task.generatedContent),
        };
      } else {
        includedVersions.set(task.generatedContent, task.id);
        generatedVersion = { available: true, content: task.generatedContent };
      }

      return {
        id: task.id,
        name: task.name,
        instructions: truncateContextText(task.instructions, MAX_TASK_INSTRUCTION_CHARS),
        recentChat: compactChatHistory(task.chatHistory, MAX_TASK_CHAT_MESSAGES, MAX_TASK_CHAT_CHARS),
        generatedVersion,
      };
    }),
  };
}

/**
 * Accept an active-workspace path or a stale absolute VFS key from the same
 * project directory. Saved canvases can retain the latter after a home/workspace
 * parent directory changes, so preserve it for the VFS read while rebasing the
 * destination to the currently open workspace.
 */
function normalizeWorkspaceFile(workspaceRoot: string, filePath: string): NormalizedWorkspaceFile {
  if (!workspaceRoot?.trim()) throw new Error("No workspace root is available for reconciliation.");
  if (typeof filePath !== "string" || !filePath.trim()) throw new Error("A file path is required.");

  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, filePath);
  const relative = path.relative(root, resolved);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return { workspacePath: resolved, vfsPath: resolved };
  }

  if (path.isAbsolute(filePath)) {
    const workspaceDirectory = path.basename(root);
    const pathRoot = path.parse(resolved).root;
    const components = path.relative(pathRoot, resolved).split(path.sep).filter(Boolean);
    const workspaceIndex = components.lastIndexOf(workspaceDirectory);
    if (workspaceIndex >= 0 && workspaceIndex < components.length - 1) {
      const rebasedPath = path.resolve(root, ...components.slice(workspaceIndex + 1));
      const rebasedRelative = path.relative(root, rebasedPath);
      if (rebasedRelative && !rebasedRelative.startsWith("..") && !path.isAbsolute(rebasedRelative)) {
        return { workspacePath: rebasedPath, vfsPath: resolved };
      }
    }
  }

  throw new Error(`Reconciliation file must be inside the workspace: ${filePath}`);
}

function resolveWorkspaceFile(workspaceRoot: string, filePath: string): string {
  return normalizeWorkspaceFile(workspaceRoot, filePath).workspacePath;
}

function normalizeFileSources(
  workspaceRoot: string,
  fileSources: Record<string, string> | undefined,
): Map<string, string> {
  const normalized = new Map<string, string>();
  for (const [workspacePath, vfsPath] of Object.entries(fileSources || {})) {
    const destination = normalizeWorkspaceFile(workspaceRoot, workspacePath).workspacePath;
    const source = normalizeWorkspaceFile(workspaceRoot, vfsPath);
    if (source.workspacePath !== destination) {
      throw new Error(`VFS source does not match its active workspace file: ${vfsPath}`);
    }
    normalized.set(destination, source.vfsPath);
  }
  return normalized;
}

function normalizeDuplicateEntries(
  workspaceRoot: string,
  duplicateFiles: Record<string, string[]>,
): Array<[string, string[]]> {
  const groups = new Map<string, Set<string>>();
  for (const [filePath, taskIds] of Object.entries(duplicateFiles || {})) {
    const workspacePath = resolveWorkspaceFile(workspaceRoot, filePath);
    const owners = groups.get(workspacePath) || new Set<string>();
    for (const taskId of taskIds || []) owners.add(taskId);
    groups.set(workspacePath, owners);
  }
  return Array.from(groups, ([filePath, owners]) => [filePath, Array.from(owners)]);
}

function contentAtPath(
  contents: Record<string, string> | undefined,
  workspaceRoot: string,
  resolvedPath: string,
): string | undefined {
  for (const [filePath, content] of Object.entries(contents || {})) {
    try {
      if (resolveWorkspaceFile(workspaceRoot, filePath) === resolvedPath) return content;
    } catch {
      // Ignore stale or invalid snapshot keys; they cannot describe this overlap.
    }
  }
  return undefined;
}

/** Build the exact model input from the live VFS and each colliding task's saved version. */
export async function buildOverlappingFileContext(options: {
  workspaceRoot: string;
  duplicateFiles: Record<string, string[]>;
  nodes: ReconciliationNode[];
  fileSources?: Record<string, string>;
  readVfsFile: (absolutePath: string) => Promise<string>;
}): Promise<OverlappingFileContext[]> {
  const nodesById = new Map(options.nodes.map((node) => [node.id, node]));
  const sources = normalizeFileSources(options.workspaceRoot, options.fileSources);
  const duplicateEntries = normalizeDuplicateEntries(options.workspaceRoot, options.duplicateFiles);

  return Promise.all(duplicateEntries.map(async ([filePath, taskIds]) => {
    const resolvedPath = resolveWorkspaceFile(options.workspaceRoot, filePath);
    const currentVfsContent = await options.readVfsFile(sources.get(resolvedPath) || resolvedPath);
    const tasks = taskIds.map((taskId) => {
      const node = nodesById.get(taskId);
      return {
        id: taskId,
        name: node?.name || "Unnamed Task",
        instructions: node?.prompt || "",
        chatHistory: Array.isArray(node?.chatHistory) ? node.chatHistory : [],
        originalContent: contentAtPath(node?.originalFileContents, options.workspaceRoot, resolvedPath),
        generatedContent: contentAtPath(node?.generatedFileContents, options.workspaceRoot, resolvedPath),
      };
    });

    return { path: resolvedPath, currentVfsContent, tasks };
  }));
}

export async function reconciliateGraph(ws: WebSocket, data: any): Promise<void> {
  const { tabId, model, nodes, workspaceRoot, customProvider, duplicateFiles, fileSources, chatHistory, userMessage } = data;
  console.log(`WebSocket [Server] reconciliate_graph starting for tab: ${tabId}, userMessage: ${userMessage || "none"}`);

  const reconciliationStreamId = `__reconciliation__:${tabId}`;
  const finalizedFiles = new Set<string>();
  const modelModifiedFiles = new Set<string>();
  let activeFilePath: string | undefined;
  const sendLog = (message: string) => {
    console.log(`[ReconciliateGraph] ${message}`);
    safeSend(ws, { type: "log", nodeId: reconciliationStreamId, message });
  };

  try {
    const formattedNodes: ReconciliationNode[] = Array.isArray(nodes) ? nodes : [];
    const normalizedSources = normalizeFileSources(workspaceRoot, fileSources);
    const duplicateEntries = normalizeDuplicateEntries(workspaceRoot, duplicateFiles || {});
    const allTaskFilePaths = new Map<string, string>();
    for (const node of formattedNodes) {
      for (const filePath of node.modifiedFiles || []) {
        const normalized = normalizeWorkspaceFile(workspaceRoot, filePath);
        const source = normalizedSources.get(normalized.workspacePath) || normalized.vfsPath;
        const existingSource = allTaskFilePaths.get(normalized.workspacePath);
        if (!existingSource || source === normalized.workspacePath) {
          allTaskFilePaths.set(normalized.workspacePath, source);
        }
      }
    }
    for (const [filePath] of duplicateEntries) {
      const normalized = normalizeWorkspaceFile(workspaceRoot, filePath);
      if (!allTaskFilePaths.has(normalized.workspacePath)) {
        allTaskFilePaths.set(
          normalized.workspacePath,
          normalizedSources.get(normalized.workspacePath) || normalized.vfsPath,
        );
      }
    }
    if (allTaskFilePaths.size === 0) {
      throw new Error("No task-owned VFS files are available to reconcile.");
    }

    const requestVfsFile = async (resolvedPath: string): Promise<string> => {
      const res = await request(ws, {
        type: "read_file",
        runId: reconciliationStreamId,
        payload: { path: resolvedPath },
        validateResponse: validateRpcResponse,
      });
      if (res.error) throw new Error(String(res.error));
      return String(res.content ?? "");
    };

    const persistReconciledFile = async (resolvedPath: string, content: string): Promise<string> => {
      const res = await request(ws, {
        type: "write_file",
        runId: reconciliationStreamId,
        payload: { path: resolvedPath, content },
        validateResponse: validateRpcResponse,
      });
      if (res.error) throw new Error(String(res.error));
      finalizedFiles.add(resolvedPath);
      allTaskFilePaths.set(resolvedPath, resolvedPath);
      return `File successfully finalized under the reconciliation owner in the canvas VFS: ${resolvedPath}`;
    };

    const toolsForFile = (targetPath: string) => {
      const readVfsTool = {
        name: "read_file",
        description: "Re-read the current canvas VFS version of this one overlapping file.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "The exact supplied overlapping file path" },
          },
          required: ["path"],
        },
        execute: async ({ path: filePath }: { path: string }) => {
          const resolvedPath = resolveWorkspaceFile(workspaceRoot, filePath);
          if (resolvedPath !== targetPath) {
            throw new Error(`This reconciliation case can only read ${targetPath}`);
          }
          sendLog(`AI re-reading VFS file: ${filePath}`);
          return requestVfsFile(allTaskFilePaths.get(targetPath) || targetPath);
        },
      };

      const writeVfsTool = {
        name: "write_file",
        description: "Replace this one overlapping file in the canvas VFS with its complete reconciled content.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "The exact supplied overlapping file path" },
            content: { type: "string", description: "Complete replacement file content" },
          },
          required: ["path", "content"],
        },
        execute: async ({ path: filePath, content }: { path: string; content: string }) => {
          const resolvedPath = resolveWorkspaceFile(workspaceRoot, filePath);
          if (resolvedPath !== targetPath) {
            throw new Error(`This reconciliation case can only change ${targetPath}`);
          }

          const currentContent = await requestVfsFile(allTaskFilePaths.get(targetPath) || targetPath);
          if (currentContent === content) {
            sendLog(`AI reviewed VFS file without changing it: ${filePath}`);
            return `No write was needed because ${targetPath} already has that content.`;
          }

          sendLog(`AI modifying VFS file: ${filePath}`);
          modelModifiedFiles.add(targetPath);
          return persistReconciledFile(targetPath, content);
        },
      };

      return [readVfsTool, writeVfsTool];
    };

    const systemPrompt = `You are a code reconciliation model inside a spatial development canvas.
You receive exactly one file that was modified by multiple tasks. Reconcile only that file and fix genuine integration issues in the Virtual File System (VFS).

Your instructions:
1. Review the single supplied file. Compare its current VFS content with the available task-generated versions, instructions, and short recent chat excerpts.
2. Preserve compatible behavior from all colliding tasks. Do not choose one task's version wholesale when the implementations need to be merged.
3. If the current VFS version already satisfies all colliding task requirements and has no integration issue, do not write it.
4. If a file needs changes, call 'write_file' with the exact supplied path and the complete reconciled file. Never write a snippet, placeholder, duplicate file, or unrelated file.
5. You may call 'read_file' to re-read the current VFS version. Both tools are restricted to this one supplied path. Do not inspect any other file or the rest of the codebase.
6. Do not run builds, tests, shell commands, or modify the physical workspace. All writes must use 'write_file' and remain in the VFS.
7. Axiom tracks this collision file under a dedicated reconciliation owner. Ordinary changed files that do not collide remain TaskNode-owned and are applied separately.
8. Finish with a concise report for this file only.

Workspace root: ${workspaceRoot || "unknown"}
`;

    (ws as any).__activeAgentTabId = reconciliationStreamId;
    let response: string;
    const reviewedFiles: string[] = [];
    if (duplicateEntries.length > 0) {
      const modelReference = model || customProvider?.models?.find((item: any) => item.supported !== false)?.id || "";
      if (!modelReference) throw new Error("No model is selected. Configure one in LLM Setup.");
      sendLog(`Reviewing ${duplicateEntries.length} overlapping file${duplicateEntries.length === 1 ? "" : "s"} one at a time with ${modelReference}.`);
      const priorChat = Array.isArray(chatHistory)
        ? (userMessage ? chatHistory.slice(0, -1) : chatHistory)
        : [];
      const recentReconciliationChat = compactChatHistory(
        priorChat,
        MAX_RECONCILIATION_CHAT_MESSAGES,
        MAX_RECONCILIATION_CHAT_CHARS,
      );
      const reports: string[] = [];

      for (let index = 0; index < duplicateEntries.length; index += 1) {
        const [filePath, taskIds] = duplicateEntries[index];
        activeFilePath = filePath;
        sendLog(`Case ${index + 1}/${duplicateEntries.length}: loading only ${filePath}.`);
        const [fileContext] = await buildOverlappingFileContext({
          workspaceRoot,
          duplicateFiles: { [filePath]: taskIds },
          nodes: formattedNodes,
          fileSources,
          readVfsFile: requestVfsFile,
        });
        reviewedFiles.push(fileContext.path);
        const promptText = `${userMessage?.trim() || "Review this overlapping VFS file and reconcile it only if integration changes are required."}

${recentReconciliationChat.length > 0 ? `Recent reconciliation conversation (bounded):\n${recentReconciliationChat.join("\n\n")}\n\n` : ""}Single-file reconciliation case:
${JSON.stringify(compactFileContext(fileContext), null, 2)}`;

        try {
          const fileReport = await callLlmWithToolsPiStreaming({
            modelReference,
            customProvider,
            systemPrompt,
            userMessage: promptText,
            tools: toolsForFile(fileContext.path),
            sendLog,
            sendToken: () => {},
            maxRounds: 12,
            // A complete write is terminal for this single-file case. Avoid a
            // second provider request that would duplicate the full file in
            // the tool-call transcript and consume the context window again.
            returnAfterToolNames: ["write_file"],
            cwd: workspaceRoot,
            // Each file is an independent case. Relevant history is already
            // bounded in the prompt so provider adapters cannot re-expand it.
            history: [],
            shouldAbort: () => ws.readyState !== WebSocket.OPEN,
          });
          reports.push(`${fileContext.path}\n${truncateContextText(fileReport, 4_000)}`);
          if (!finalizedFiles.has(fileContext.path)) {
            const finalContent = await requestVfsFile(allTaskFilePaths.get(fileContext.path) || fileContext.path);
            sendLog(`Finalizing reviewed collision file: ${fileContext.path}`);
            await persistReconciledFile(fileContext.path, finalContent);
          }
          safeSend(ws, {
            type: "reconciliation_file_complete",
            tabId,
            filePath: fileContext.path,
            taskIds,
            modified: modelModifiedFiles.has(fileContext.path),
            response: truncateContextText(fileReport, 4_000),
          });
          activeFilePath = undefined;
        } catch (error: any) {
          safeSend(ws, {
            type: "reconciliation_file_error",
            tabId,
            filePath: fileContext.path,
            taskIds,
            error: error.message || String(error),
          });
          throw new Error(`Failed while reconciling ${fileContext.path}: ${error.message || String(error)}`);
        }
      }
      response = truncateContextText(reports.join("\n\n---\n\n"), 24_000);
    } else {
      response = "No unreconciled overlapping task files were supplied. Ordinary changed files remain TaskNode-owned for Apply Axiom.";
      sendLog("No pending overlap cases require model review.");
    }

    const reconciledFiles = Array.from(finalizedFiles);
    const modifiedFiles = Array.from(modelModifiedFiles);
    sendLog(modifiedFiles.length > 0
      ? `Reconciliation changed ${modifiedFiles.length} collision file${modifiedFiles.length === 1 ? "" : "s"} and recorded ${reconciledFiles.length} completed case${reconciledFiles.length === 1 ? "" : "s"}.`
      : `Reconciliation recorded ${reconciledFiles.length} completed collision case${reconciledFiles.length === 1 ? "" : "s"}; no model edits were required.`);

    safeSend(ws, {
      type: "reconciliation_graph_complete",
      tabId,
      response: String(response || "Reconciliation complete."),
      reviewedFiles,
      reconciledFiles,
      modifiedFiles,
    });
  } catch (err: any) {
    console.error("WebSocket [Server] reconciliate_graph error:", err);
    safeSend(ws, {
      type: "reconciliation_graph_error",
      tabId,
      filePath: activeFilePath,
      error: err.message,
    });
  }
}
