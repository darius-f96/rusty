import { WebSocket } from "ws";
import { safeSend } from "../services/websocket";
import { completeLlmText } from "../services/llmRuntime";

type ChatEntry = { role: "user" | "assistant"; content: string };
type GeneratedTask = { key: string; title: string; description: string; dependsOn: string[] };
const activeTaskGenerations = new Map<string, AbortController>();

class InvalidTaskOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTaskOutputError";
  }
}

function parseGeneratedTasks(content: string): GeneratedTask[] {
  const trimmed = content.trim();
  const match = trimmed.match(/\{[\s\S]*\}/);
  let parsed: any;
  try {
    parsed = JSON.parse(match?.[0] || trimmed);
  } catch {
    throw new InvalidTaskOutputError("The model returned malformed JSON.");
  }

  if (!Array.isArray(parsed?.tasks)) {
    throw new InvalidTaskOutputError('The model response did not contain a "tasks" array.');
  }

  const usedKeys = new Set<string>();
  const tasks: GeneratedTask[] = (parsed.tasks as any[])
    .map((task: any, index: number) => {
      const title = String(task?.title || "").trim().slice(0, 120);
      const description = String(task?.description || "").trim().slice(0, 8000);
      if (!title || !description) return null;

      const requestedKey = String(task?.key || `task-${index + 1}`).trim().slice(0, 80) || `task-${index + 1}`;
      let key = requestedKey;
      let suffix = 2;
      while (usedKeys.has(key)) key = `${requestedKey}-${suffix++}`;
      usedKeys.add(key);

      const dependsOn = Array.isArray(task?.dependsOn)
        ? task.dependsOn.map((dependency: unknown) => String(dependency).trim()).filter(Boolean)
        : [];
      return { key, title, description, dependsOn };
    })
    .filter((task: GeneratedTask | null): task is GeneratedTask => task !== null)
    .slice(0, 20);

  if (!tasks.length) {
    throw new InvalidTaskOutputError("The model did not return any valid tasks.");
  }

  const earlierKeys = new Set<string>();
  return tasks.map((task) => {
    const dependsOn = [...new Set<string>(task.dependsOn)].filter((dependency) => earlierKeys.has(dependency));
    earlierKeys.add(task.key);
    return { ...task, dependsOn };
  });
}

export function stopTaskNodeGeneration(requestId: string): boolean {
  const controller = activeTaskGenerations.get(requestId);
  if (!controller) return false;
  controller.abort();
  activeTaskGenerations.delete(requestId);
  return true;
}

export async function generateTaskNodes(ws: WebSocket, data: any): Promise<void> {
  const { requestId, nodeId, model, customProvider } = data;
  const abortController = new AbortController();
  activeTaskGenerations.set(requestId, abortController);
  try {
    const history: ChatEntry[] = Array.isArray(data.chatHistory)
      ? data.chatHistory.filter((entry: any) => (entry?.role === "user" || entry?.role === "assistant") && typeof entry.content === "string")
      : [];
    if (!history.length) throw new Error("Discuss the story in Global Chat before generating tasks.");

    const modelReference = model || customProvider?.models?.find((item: any) => item.supported !== false)?.id || "";
    if (!modelReference) throw new Error("Select a model before generating tasks.");
    safeSend(ws, { type: "generate_task_nodes_log", requestId, nodeId, message: `Generating task draft with ${modelReference}...` });

    const additionalInstructions = typeof data.additionalInstructions === "string"
      ? data.additionalInstructions.trim().slice(0, 8000)
      : "";
    const system = `You extract implementation tasks from a product discussion. Return ONLY valid JSON with this exact shape: {"tasks":[{"key":"task-1","title":"short action-oriented title","description":"complete implementation instructions","dependsOn":[]},{"key":"task-2","title":"another title","description":"complete instructions","dependsOn":["task-1"]}]}. Each key must be unique. dependsOn must contain only keys of earlier tasks whose implementation output or decisions directly influence the current task; use an empty array when no dependency exists. Tasks must be specific, non-overlapping, ordered so prerequisites appear first, and based only on decisions established in the conversation and the user's additional instructions. Do not include canvas coordinates, markdown, commentary, or file changes. Return 1 to 20 tasks.`;
    const conversation = history.slice(-30).map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`).join("\n\n");
    const userMessage = additionalInstructions
      ? `${conversation}\n\nADDITIONAL TASK-GENERATION INSTRUCTIONS:\n${additionalInstructions}`
      : conversation;

    for (let attempt = 1; attempt <= 2; attempt++) {
      const content = await completeLlmText({
        modelReference,
        customProvider,
        systemPrompt: attempt === 1
          ? system
          : `${system}\n\nYour previous response could not be parsed as the required task JSON. This is the final retry. Return exactly one JSON object that follows the schema, with no surrounding text.`,
        userMessage,
        maxTokens: 5000,
        signal: abortController.signal,
      });
      try {
        const tasks = parseGeneratedTasks(content);
        safeSend(ws, { type: "generate_task_nodes_complete", requestId, nodeId, tasks, attempts: attempt });
        return;
      } catch (error) {
        if (!(error instanceof InvalidTaskOutputError)) throw error;
        if (attempt === 1) {
          safeSend(ws, {
            type: "generate_task_nodes_log",
            requestId,
            nodeId,
            message: "The model returned invalid task JSON. Retrying once with stricter formatting instructions...",
          });
          continue;
        }
        safeSend(ws, {
          type: "generate_task_nodes_error",
          requestId,
          nodeId,
          errorCode: "INVALID_TASK_JSON",
          attempts: attempt,
          error: "The model returned invalid task JSON twice. This model may be too small to generate a reliable task plan. Switch to a more capable model and try again.",
        });
        return;
      }
    }
  } catch (error: any) {
    safeSend(ws, {
      type: abortController.signal.aborted ? "generate_task_nodes_stopped" : "generate_task_nodes_error",
      requestId,
      nodeId,
      error: abortController.signal.aborted ? "Task generation stopped." : error?.message || String(error),
    });
  } finally {
    activeTaskGenerations.delete(requestId);
  }
}
