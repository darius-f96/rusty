import { resolveHarness } from "./harness";
import { TokenUsageSample } from "./usageTracking";

export interface InlineChatContext {
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

interface InlineChatPiOptions {
  sessionId: string;
  message: string;
  model: string;
  workspaceRoot: string;
  customProvider?: any;
  history: Array<{ role: string; content: string }>;
  context: InlineChatContext;
  sendToken: (token: string) => void;
  onUsage?: (sample: TokenUsageSample) => void;
}

/**
 * Editor inline chat, routed through the single harness contract
 * (services/harness/) like every other model call in the sidecar. Protocol
 * concerns remain in the capability and editor/UI concerns remain in the
 * frontend; this function only builds the inline-chat-specific prompt.
 */
export async function runInlineChatWithModel(options: InlineChatPiOptions): Promise<string> {
  const selected = options.context.selection;
  const selectedContext = selected.text
    ? `Selected code (lines ${selected.startLine}-${selected.endLine}):\n\`\`\`${options.context.language}\n${selected.text}\n\`\`\``
    : `Cursor is at line ${selected.startLine}, column ${selected.startColumn}.`;
  const systemPrompt = `You are Axiom Inline Chat, a concise coding assistant embedded directly in a code editor.

Current file: ${options.context.filePath}
Language: ${options.context.language}
${selectedContext}

Current file contents:
\`\`\`${options.context.language}
${options.context.fileContent.slice(0, 120_000)}
\`\`\`

Answer only the user's focused question about this editor context. Prefer a short explanation followed by a small code example when useful. Do not use tools, delegate work, inspect unrelated files, or claim that files were changed. If the user asks for a change, provide the exact replacement code for the selected region (or the smallest relevant snippet when there is no selection).`;

  const content = await resolveHarness(options.customProvider).completeText({
    modelReference: options.model,
    customProvider: options.customProvider,
    systemPrompt,
    userMessage: options.message,
    history: options.history,
    maxTokens: 4096,
    cwd: options.workspaceRoot,
    onUsage: options.onUsage,
  });
  options.sendToken(content);
  return content;
}
