import { CustomProvider } from "../store";

export interface InlineChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface InlineChatEditorContext {
  filePath: string;
  language: string;
  fileContent: string;
  selection: {
    text: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
}

interface InlineChatRequest {
  sessionId: string;
  message: string;
  model: string;
  workspaceRoot: string;
  customProvider: CustomProvider | null;
  history: InlineChatMessage[];
  context: InlineChatEditorContext;
}

interface InlineChatCallbacks {
  onToken: (token: string) => void;
  onComplete: (response: string) => void;
  onError: (error: string) => void;
}

export interface InlineChatRun {
  cancel: () => void;
}

/** WebSocket transport for editor inline chat. It contains no presentation logic. */
export const inlineChatService = {
  send(request: InlineChatRequest, callbacks: InlineChatCallbacks): InlineChatRun {
    const socket = new WebSocket("ws://localhost:4000");
    let settled = false;

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      callbacks.onError(message);
      socket.close();
    };

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "inline_chat", ...request }));
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.sessionId !== request.sessionId) return;
        if (message.type === "inline_chat_token") {
          callbacks.onToken(String(message.content || ""));
        } else if (message.type === "inline_chat_complete") {
          settled = true;
          callbacks.onComplete(String(message.response || ""));
          socket.close();
        } else if (message.type === "inline_chat_error") {
          fail(String(message.error || "Inline chat failed."));
        }
      } catch (error: any) {
        fail(error?.message || "The inline chat response was invalid.");
      }
    };

    socket.onerror = () => fail("Could not connect to the Pi sidecar on port 4000.");
    socket.onclose = () => {
      if (!settled) fail("The inline chat connection closed before a response was received.");
    };

    return {
      cancel: () => {
        if (settled) return;
        settled = true;
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "inline_chat_stop", sessionId: request.sessionId }));
        }
        socket.close();
      },
    };
  },
};
