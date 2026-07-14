import { WebSocket } from "ws";
import { safeSend } from "../services/websocket";
import type { LlmConfig } from "../services/llm";

type ChatEntry = { role: "user" | "assistant"; content: string };

function resolveConfig(model: string, customProvider: any): LlmConfig & { apiType?: string } {
  if (customProvider?.baseUrl && customProvider?.apiKey) {
    const selected = model?.includes("/") ? model.split("/").slice(1).join("/") : model;
    return {
      baseUrl: customProvider.baseUrl.replace(/\/$/, ""),
      apiKey: customProvider.apiKey,
      model: selected || customProvider.models?.[0]?.id?.split("/").pop() || "",
      apiType: customProvider.apiType,
    };
  }
  const [provider, ...modelParts] = String(model || "").split("/");
  if (provider === "openai") return { baseUrl: "https://api.openai.com/v1", apiKey: process.env.OPENAI_API_KEY || "", model: modelParts.join("/") };
  if (provider === "anthropic") return { baseUrl: "https://api.anthropic.com/v1", apiKey: process.env.ANTHROPIC_API_KEY || "", model: modelParts.join("/"), apiType: "anthropic" };
  throw new Error("No supported model configuration is available.");
}

export async function generateTaskNodes(ws: WebSocket, data: any): Promise<void> {
  const { requestId, nodeId, model, customProvider } = data;
  try {
    const history: ChatEntry[] = Array.isArray(data.chatHistory)
      ? data.chatHistory.filter((entry: any) => (entry?.role === "user" || entry?.role === "assistant") && typeof entry.content === "string")
      : [];
    if (!history.length) throw new Error("Discuss the story in Global Chat before generating tasks.");

    const config = resolveConfig(model, customProvider);
    if (!config.apiKey || !config.model) throw new Error("The selected model is not fully configured.");
    safeSend(ws, { type: "generate_task_nodes_log", requestId, nodeId, message: `Generating task draft with ${config.model}...` });

    const system = `You extract implementation tasks from a product discussion. Return ONLY valid JSON with this shape: {"tasks":[{"title":"short action-oriented title","description":"complete implementation instructions"}]}. Tasks must be independently executable, specific, non-overlapping, ordered by dependency, and based only on decisions established in the conversation. Do not include canvas coordinates, IDs, markdown, commentary, or file changes. Return 1 to 20 tasks.`;
    const conversation = history.slice(-30).map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`).join("\n\n");
    const isAnthropic = config.apiType === "anthropic";
    const response = await fetch(isAnthropic ? `${config.baseUrl}/messages` : `${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: isAnthropic
        ? { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" }
        : { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(isAnthropic ? {
        model: config.model,
        system,
        messages: [{ role: "user", content: conversation }],
        temperature: 0.2,
        max_tokens: 5000,
      } : {
        model: config.model,
        messages: [{ role: "system", content: system }, { role: "user", content: conversation }],
        temperature: 0.2,
        max_tokens: 5000,
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) throw new Error(`Model request failed (${response.status}): ${await response.text()}`);
    const payload: any = await response.json();
    const content = isAnthropic
      ? (payload.content || []).filter((part: any) => part?.type === "text").map((part: any) => part.text).join("")
      : payload.choices?.[0]?.message?.content || "";
    const match = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match?.[0] || content);
    const tasks = (Array.isArray(parsed.tasks) ? parsed.tasks : [])
      .map((task: any) => ({ title: String(task?.title || "").trim().slice(0, 120), description: String(task?.description || "").trim().slice(0, 8000) }))
      .filter((task: any) => task.title && task.description)
      .slice(0, 20);
    if (!tasks.length) throw new Error("The model did not return any valid tasks.");
    safeSend(ws, { type: "generate_task_nodes_complete", requestId, nodeId, tasks });
  } catch (error: any) {
    safeSend(ws, { type: "generate_task_nodes_error", requestId, nodeId, error: error?.message || String(error) });
  }
}
