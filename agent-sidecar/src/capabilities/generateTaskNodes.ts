import { WebSocket } from "ws";
import { safeSend } from "../services/websocket";
import { completeLlmText } from "../services/llmRuntime";

type ChatEntry = { role: "user" | "assistant"; content: string };
const activeTaskGenerations = new Map<string, AbortController>();

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

    const system = `You extract implementation tasks from a product discussion. Return ONLY valid JSON with this shape: {"tasks":[{"title":"short action-oriented title","description":"complete implementation instructions"}]}. Tasks must be independently executable, specific, non-overlapping, ordered by dependency, and based only on decisions established in the conversation. Do not include canvas coordinates, IDs, markdown, commentary, or file changes. Return 1 to 20 tasks.`;
    const conversation = history.slice(-30).map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`).join("\n\n");
    const content = await completeLlmText({
      modelReference,
      customProvider,
      systemPrompt: system,
      userMessage: conversation,
      maxTokens: 5000,
      signal: abortController.signal,
    });
    const match = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match?.[0] || content);
    const tasks = (Array.isArray(parsed.tasks) ? parsed.tasks : [])
      .map((task: any) => ({ title: String(task?.title || "").trim().slice(0, 120), description: String(task?.description || "").trim().slice(0, 8000) }))
      .filter((task: any) => task.title && task.description)
      .slice(0, 20);
    if (!tasks.length) throw new Error("The model did not return any valid tasks.");
    safeSend(ws, { type: "generate_task_nodes_complete", requestId, nodeId, tasks });
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
