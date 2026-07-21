import { execFile, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { promisify } from "node:util";
import { importEsm } from "./esmImport";
import type { DiscoveredProviderModel } from "./llmProviders";

export const ANTHROPIC_CLAUDE_CODE_PROVIDER_ID = "anthropic-claude-code";

export interface ClaudeCodeConnectionStatus {
  state: "disconnected" | "connecting" | "connected" | "failed";
  authenticated: boolean;
  email?: string;
  planType?: string;
  authType?: string;
  message?: string;
  diagnostics?: string[];
}

type ClaudeTool = {
  name: string;
  description: string;
  inputSchema?: any;
  execute: (args: any) => Promise<any>;
};

let cachedStatus: ClaudeCodeConnectionStatus | null = null;
let cachedModels: DiscoveredProviderModel[] = [];
let probePromise: Promise<ClaudeCodeConnectionStatus> | null = null;
const execFileAsync = promisify(execFile);

function oauthAccessToken(credentials: any): string | undefined {
  const token = credentials?.claudeAiOauth?.accessToken
    || credentials?.oauth?.accessToken
    || credentials?.accessToken;
  return typeof token === "string" && token.trim() ? token.trim() : undefined;
}

async function readClaudeCodeOauthToken(): Promise<string | undefined> {
  const credentialsPath = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), ".credentials.json");
  try {
    return oauthAccessToken(JSON.parse(await fs.promises.readFile(credentialsPath, "utf8")));
  } catch {
    // Current macOS builds may keep the same JSON payload in Keychain instead.
  }
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], {
        timeout: 10_000,
      });
      return oauthAccessToken(JSON.parse(stdout));
    } catch {
      // Authentication status below provides the user-facing error.
    }
  }
  return undefined;
}

async function* keepClaudeSdkSessionOpen(signal: AbortSignal): AsyncGenerator<never> {
  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

async function readClaudeCodeSdkUsage(): Promise<any> {
  const sdk = await importEsm<any>("@anthropic-ai/claude-agent-sdk");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const session = sdk.query({
    // A streaming prompt initializes the CLI without submitting a model turn.
    prompt: keepClaudeSdkSessionOpen(controller.signal),
    options: {
      abortController: controller,
      tools: [],
      persistSession: false,
      permissionMode: "dontAsk",
    },
  });
  try {
    await session.initializationResult();
    const readUsage = session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
    if (typeof readUsage !== "function") {
      throw new Error("The installed Claude Agent SDK does not expose subscription usage.");
    }
    return await readUsage.call(session);
  } finally {
    clearTimeout(timeout);
    controller.abort();
    session.close();
  }
}

function claudeExecutable(): string {
  const explicit = process.env.AXIOM_CLAUDE_CODE_PATH || process.env.CLAUDE_CODE_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const packageByPlatform: Record<string, string> = {
    "darwin-arm64": "claude-agent-sdk-darwin-arm64",
    "darwin-x64": "claude-agent-sdk-darwin-x64",
    "linux-arm64": "claude-agent-sdk-linux-arm64",
    "linux-x64": "claude-agent-sdk-linux-x64",
    "win32-arm64": "claude-agent-sdk-win32-arm64",
    "win32-x64": "claude-agent-sdk-win32-x64",
  };
  const packageName = packageByPlatform[`${process.platform}-${process.arch}`];
  const executable = process.platform === "win32" ? "claude.exe" : "claude";
  const roots = [
    path.resolve(__dirname, "node_modules"),
    path.resolve(__dirname, "../../node_modules"),
    path.resolve(__dirname, "../../../agent-sidecar/node_modules"),
    path.resolve(process.cwd(), "node_modules"),
    path.resolve(process.cwd(), "agent-sidecar/node_modules"),
  ];
  for (const root of roots) {
    const candidate = path.join(root, "@anthropic-ai", packageName || "", executable);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`The bundled Claude Code runtime is unavailable for ${process.platform}/${process.arch}.`);
}

function normalizeModels(models: any[]): DiscoveredProviderModel[] {
  return models.map((model) => ({
    id: `${ANTHROPIC_CLAUDE_CODE_PROVIDER_ID}/${model.value}`,
    remoteId: model.value,
    name: model.displayName || model.value,
    apiType: "claude-agent-sdk",
    supported: true,
    reasoning: Boolean(model.supportsEffort || model.supportsAdaptiveThinking),
    supportedReasoningEfforts: (model.supportedEffortLevels || ["low", "medium", "high"])
      .filter((effort: string) => ["minimal", "low", "medium", "high", "xhigh"].includes(effort)),
    defaultReasoningEffort: "medium",
  }));
}

async function probe(): Promise<ClaudeCodeConnectionStatus> {
  const { stdout } = await execFileAsync(claudeExecutable(), ["auth", "status", "--json"], {
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 20_000,
  });
  const auth = JSON.parse(stdout || "{}");
  if (!auth.loggedIn && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return {
      state: "disconnected",
      authenticated: false,
      message: "Sign in with Claude Code first, or configure ANTHROPIC_API_KEY for the Agent SDK.",
    };
  }
  return {
    state: "connected",
    authenticated: true,
    email: auth.email,
    planType: auth.subscriptionType,
    authType: auth.authMethod,
    message: "Connected to Claude Code.",
  };
}

export async function getClaudeCodeConnectionStatus(force = false): Promise<ClaudeCodeConnectionStatus> {
  if (!force && cachedStatus?.authenticated) return cachedStatus;
  if (probePromise) return probePromise;
  probePromise = probe().catch((error: any) => ({
    state: "failed" as const,
    authenticated: false,
    message: error?.message || "Claude Code authentication could not be verified.",
  })).then((status) => (cachedStatus = status)).finally(() => { probePromise = null; });
  return probePromise;
}

export async function readClaudeCodeQuota(): Promise<{
  status: ClaudeCodeConnectionStatus;
  usage?: any;
  message?: string;
}> {
  const status = await getClaudeCodeConnectionStatus(true);
  if (!status.authenticated) return { status };
  let sdkError: unknown;
  try {
    const result = await readClaudeCodeSdkUsage();
    const resolvedStatus = typeof result?.subscription_type === "string" && result.subscription_type
      ? { ...status, planType: result.subscription_type }
      : status;
    if (!result?.rate_limits_available || !result?.rate_limits) {
      return {
        status: resolvedStatus,
        message: "Claude Code is connected, but subscription rate limits are unavailable for this authentication method.",
      };
    }
    return { status: resolvedStatus, usage: result.rate_limits };
  } catch (error) {
    // Older Claude runtimes do not expose the SDK usage control request.
    sdkError = error;
  }

  const token = await readClaudeCodeOauthToken();
  if (!token) {
    return {
      status,
      message: (sdkError as any)?.message
        || "Claude Code is connected, but its subscription usage could not be retrieved.",
    };
  }
  try {
    const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        accept: "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Anthropic usage request failed (${response.status}).`);
    return { status, usage: await response.json() };
  } catch (error: any) {
    return { status, message: error?.message || "Claude Code usage could not be retrieved." };
  }
}

export async function startClaudeCodeLogin(): Promise<ClaudeCodeConnectionStatus> {
  cachedStatus = null;
  const child = spawn(claudeExecutable(), ["auth", "login", "--claudeai"], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, NO_COLOR: "1" },
  });
  child.unref();
  return {
    state: "connecting",
    authenticated: false,
    message: "Complete the Claude sign-in flow in your browser.",
  };
}

export async function discoverClaudeCodeModels(): Promise<DiscoveredProviderModel[]> {
  const status = await getClaudeCodeConnectionStatus(true);
  if (!status.authenticated) throw new Error(status.message || "Claude Code sign-in is required.");
  const sdk = await importEsm<any>("@anthropic-ai/claude-agent-sdk");
  const controller = new AbortController();
  const session = sdk.query({
    prompt: "Reply with OK.",
    options: { abortController: controller, tools: [], maxTurns: 1, persistSession: false, permissionMode: "dontAsk" },
  });
  try {
    cachedModels = normalizeModels(await session.supportedModels());
  } finally {
    controller.abort();
    session.close();
  }
  return cachedModels;
}

export async function testClaudeCodeConnection(): Promise<{ modelCount: number; supportedModelCount: number }> {
  const models = await discoverClaudeCodeModels();
  return { modelCount: models.length, supportedModelCount: models.length };
}

function promptWithHistory(userMessage: string, history?: Array<{ role: string; content: string }>): string {
  const previous = (history || []).slice(-12).map((item) => `${item.role.toUpperCase()}: ${item.content}`).join("\n\n");
  return previous ? `Previous conversation:\n${previous}\n\nCurrent request:\n${userMessage}` : userMessage;
}

async function runClaudeCode(options: {
  modelId: string; systemPrompt: string; userMessage: string;
  history?: Array<{ role: string; content: string }>; tools?: ClaudeTool[];
  sendLog?: (message: string) => void; sendToken?: (token: string) => void;
  cwd?: string; reasoning?: string; maxTurns?: number; shouldAbort?: () => boolean; signal?: AbortSignal;
}): Promise<string> {
  const sdk = await importEsm<any>("@anthropic-ai/claude-agent-sdk");
  const { z } = await importEsm<any>("zod");
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const serverTools = (options.tools || []).map((entry) => sdk.tool(
    entry.name,
    entry.description,
    { input: z.record(z.string(), z.unknown()).optional() },
    async (args: any) => {
      options.sendLog?.(`Running ${entry.name}.`);
      const value = await entry.execute(args?.input || args || {});
      return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] };
    },
  ));
  const mcpServers = serverTools.length
    ? { axiom: sdk.createSdkMcpServer({ name: "axiom", version: "0.1.0", tools: serverTools, alwaysLoad: true }) }
    : undefined;
  const allowedTools = serverTools.map((entry: any) => `mcp__axiom__${entry.name}`);
  const session = sdk.query({
    prompt: promptWithHistory(options.userMessage, options.history),
    options: {
      abortController: controller,
      cwd: options.cwd,
      model: options.modelId,
      systemPrompt: options.systemPrompt,
      tools: [],
      mcpServers,
      allowedTools,
      permissionMode: "dontAsk",
      persistSession: false,
      includePartialMessages: true,
      maxTurns: options.maxTurns,
      effort: options.reasoning === "minimal" ? "low" : options.reasoning,
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "axiom/0.1.0" },
    },
  });
  let text = "";
  const timer = options.shouldAbort ? setInterval(() => { if (options.shouldAbort?.()) controller.abort(); }, 150) : undefined;
  try {
    options.sendLog?.(`Calling Claude Code model ${options.modelId}.`);
    for await (const message of session) {
      if (message.type === "stream_event" && message.event?.type === "content_block_delta" && message.event.delta?.type === "text_delta") {
        options.sendToken?.(message.event.delta.text);
      }
      if (message.type === "result") {
        if (message.subtype !== "success") throw new Error(message.errors?.join("; ") || "Claude Code request failed.");
        text = message.result || text;
      }
    }
    if (!text.trim()) throw new Error("Claude Code returned no text.");
    return text;
  } finally {
    if (timer) clearInterval(timer);
    options.signal?.removeEventListener("abort", abort);
    session.close();
  }
}

export const completeClaudeCodeText = runClaudeCode;
export const callClaudeCodeWithToolsStreaming = runClaudeCode;
