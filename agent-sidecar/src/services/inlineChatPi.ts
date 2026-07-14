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
}

/**
 * Pi Harness adapter for editor inline chat. Protocol concerns remain in the
 * capability and editor/UI concerns remain in the frontend.
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

  const providerId = options.customProvider?.id || options.model.split("/")[0];
  const modelPrefix = `${providerId}/`;
  const model = options.model.startsWith(modelPrefix)
    ? options.model.slice(modelPrefix.length)
    : options.model.split("/").slice(1).join("/") || options.model;
  const isAnthropic = options.customProvider?.apiType === "anthropic" || providerId === "anthropic";
  const baseUrl = (options.customProvider?.baseUrl
    || (isAnthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1")).replace(/\/$/, "");
  const apiKey = options.customProvider?.apiKey
    || (isAnthropic ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY)
    || "";
  if (!apiKey) throw new Error(`No API key is configured for ${options.customProvider?.name || providerId}.`);

  const history = options.history.filter((item) => item.role === "user" || item.role === "assistant");
  const response = await fetch(`${baseUrl}/${isAnthropic ? "messages" : "chat/completions"}`, {
    method: "POST",
    headers: isAnthropic
      ? { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
      : { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(isAnthropic ? {
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [...history, { role: "user", content: options.message }],
    } : {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: options.message },
      ],
    }),
  });
  if (!response.ok) throw new Error(`LLM API error: ${response.status} - ${await response.text()}`);
  const data: any = await response.json();
  const content = isAnthropic
    ? data.content?.filter((part: any) => part.type === "text").map((part: any) => part.text).join("")
    : data.choices?.[0]?.message?.content;
  if (!content) throw new Error("The selected model returned no text.");
  options.sendToken(content);
  return content;
}
