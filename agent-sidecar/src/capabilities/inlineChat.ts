import { WebSocket } from "ws";
import { safeSend } from "../services/websocket";
import { runInlineChatWithModel } from "../services/inlineChatPi";

/** WebSocket capability for a single, non-agentic inline model call. */
export async function inlineChat(ws: WebSocket, data: any): Promise<void> {
  const { sessionId, message, model, workspaceRoot, customProvider, history, context } = data;
  if (!sessionId || !message || !model || !workspaceRoot || !context?.filePath) {
    safeSend(ws, { type: "inline_chat_error", sessionId, error: "Inline chat request is incomplete." });
    return;
  }
  (ws as any).__activeAgentTabId = sessionId;

  try {
    const response = await runInlineChatWithModel({
      sessionId,
      message,
      model,
      workspaceRoot,
      customProvider,
      history: Array.isArray(history) ? history : [],
      context,
      sendToken: (content) => safeSend(ws, { type: "inline_chat_token", sessionId, content }),
    });
    safeSend(ws, { type: "inline_chat_complete", sessionId, response });
  } catch (error: any) {
    console.error(`[InlineChat:${sessionId}]`, error);
    safeSend(ws, {
      type: "inline_chat_error",
      sessionId,
      error: error?.message || "Inline chat failed.",
    });
  }
}
