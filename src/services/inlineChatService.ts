import { CustomProvider } from "../store";
import { agentHarnessClient, RunEvent } from "./agentHarnessClient";
import { SIDECAR_PORT } from "../config/sidecar";

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

/** Shared harness transport for editor inline chat. It contains no presentation logic. */
export const inlineChatService = {
  send(request: InlineChatRequest, callbacks: InlineChatCallbacks): InlineChatRun {
    let settled = false;
    let cancelRun: (() => Promise<void>) | undefined;

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      callbacks.onError(message);
    };

    const handleEvent = (message: RunEvent) => {
      if (message.sessionId !== request.sessionId) return;
      if (message.type === "inline_chat_token") {
        callbacks.onToken(String(message.content || ""));
      } else if (message.type === "inline_chat_complete") {
        settled = true;
        unsubscribe();
        callbacks.onComplete(String(message.response || ""));
      } else if (message.type === "inline_chat_error") {
        fail(String(message.error || "Inline chat failed."));
      }
    };
    const unsubscribe = agentHarnessClient.subscribe(request.sessionId, handleEvent);

    void agentHarnessClient.startRun({
      type: "inline_chat",
      ...request,
      runId: request.sessionId,
      conversationId: request.sessionId,
    }).then((handle) => {
      cancelRun = handle.cancel;
      if (settled) void handle.cancel();
    }).catch((error: unknown) => {
      fail(error instanceof Error ? error.message : `Could not connect to the agent sidecar on port ${SIDECAR_PORT}.`);
    });

    return {
      cancel: () => {
        if (settled) return;
        settled = true;
        unsubscribe();
        if (cancelRun) void cancelRun();
      },
    };
  },
};
