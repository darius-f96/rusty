import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import type { DiscoveredProviderModel } from "./llmProviders";
import type { TokenUsageSample } from "./usageTracking";

export const OPENAI_CODEX_PROVIDER_ID = "openai-codex";

export interface CodexConnectionStatus {
  state: "disconnected" | "connecting" | "connected" | "failed";
  authenticated: boolean;
  authType?: string;
  email?: string;
  planType?: string;
  message?: string;
  verificationUri?: string;
  userCode?: string;
  diagnostics?: string[];
}

interface CodexTool {
  name: string;
  description: string;
  inputSchema?: any;
  execute: (args: any) => Promise<any>;
}

interface CodexRun {
  threadId: string;
  turnId?: string;
  text: string;
  commentaryText: string;
  messagePhases: Map<string, "commentary" | "final_answer" | null>;
  tools: Map<string, CodexTool>;
  toolCalls: number;
  maxToolCalls: number;
  sendLog: (message: string) => void;
  sendToken: (token: string) => void;
  onUsage?: (sample: TokenUsageSample) => void;
  latestTokenUsage?: TokenUsageSample;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  settled: boolean;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface LoginAttempt {
  state: "connecting" | "connected" | "failed";
  loginId?: string;
  message?: string;
  verificationUri?: string;
  userCode?: string;
}

let authDiagnostics: string[] = [];
let loginAttempt: LoginAttempt | null = null;

function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function sanitizeDiagnostic(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
    .replace(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/gi, "[device-code]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[account]")
    .replace(codexHome(), "$CODEX_HOME")
    .replace(os.homedir(), "$HOME")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

function addAuthDiagnostic(message: string): void {
  const sanitized = sanitizeDiagnostic(message);
  if (!sanitized) return;
  const entry = `${new Date().toISOString()} ${sanitized}`;
  authDiagnostics = [...authDiagnostics.slice(-59), entry];
  console.info(`[Codex Auth] ${entry}`);
}

function withDiagnostics(status: CodexConnectionStatus): CodexConnectionStatus {
  return { ...status, diagnostics: [...authDiagnostics] };
}

function candidateNodeModuleRoots(): string[] {
  return [
    path.resolve(__dirname, "node_modules"),
    path.resolve(__dirname, "../../node_modules"),
    path.resolve(__dirname, "../../../agent-sidecar/node_modules"),
    path.resolve(process.cwd(), "node_modules"),
    path.resolve(process.cwd(), "agent-sidecar/node_modules"),
  ];
}

function platformCodexPackage(): { packageName: string; target: string; executable: string } {
  const key = `${process.platform}-${process.arch}`;
  const targets: Record<string, { packageName: string; target: string; executable: string }> = {
    "darwin-arm64": { packageName: "codex-darwin-arm64", target: "aarch64-apple-darwin", executable: "codex" },
    "darwin-x64": { packageName: "codex-darwin-x64", target: "x86_64-apple-darwin", executable: "codex" },
    "linux-arm64": { packageName: "codex-linux-arm64", target: "aarch64-unknown-linux-musl", executable: "codex" },
    "linux-x64": { packageName: "codex-linux-x64", target: "x86_64-unknown-linux-musl", executable: "codex" },
    "win32-arm64": { packageName: "codex-win32-arm64", target: "aarch64-pc-windows-msvc", executable: "codex.exe" },
    "win32-x64": { packageName: "codex-win32-x64", target: "x86_64-pc-windows-msvc", executable: "codex.exe" },
  };
  const result = targets[key];
  if (!result) throw new Error(`OpenAI Codex does not support ${process.platform}/${process.arch}.`);
  return result;
}

export function resolveCodexExecutable(): string {
  const explicit = process.env.RUSTY_CODEX_PATH || process.env.CODEX_PATH;
  if (explicit) {
    if (fs.existsSync(explicit)) return explicit;
    throw new Error(`The configured Codex executable does not exist: ${explicit}`);
  }

  const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, process.platform === "win32" ? "codex.exe" : "codex");
    if (fs.existsSync(candidate)) return candidate;
  }

  if (process.platform === "darwin") {
    const desktopCandidate = "/Applications/ChatGPT.app/Contents/Resources/codex";
    if (fs.existsSync(desktopCandidate)) return desktopCandidate;
  }

  const platformPackage = platformCodexPackage();
  for (const root of candidateNodeModuleRoots()) {
    const candidate = path.join(
      root,
      "@openai",
      platformPackage.packageName,
      "vendor",
      platformPackage.target,
      "bin",
      platformPackage.executable,
    );
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error("The bundled OpenAI Codex runtime could not be located.");
}

function codexLaunch(executable: string): { command: string; args: string[] } {
  let descriptor: number | undefined;
  try {
    const resolved = fs.realpathSync(executable);
    descriptor = fs.openSync(resolved, "r");
    const headerBuffer = Buffer.alloc(160);
    const bytesRead = fs.readSync(descriptor, headerBuffer, 0, headerBuffer.length, 0);
    fs.closeSync(descriptor);
    descriptor = undefined;
    const header = headerBuffer.subarray(0, bytesRead).toString("utf8");
    if (/\.(?:c|m)?js$/i.test(resolved) || /^#!.*\bnode\b/m.test(header)) {
      return { command: process.execPath, args: [resolved, "app-server"] };
    }
  } catch {
    // Spawn will surface a clearer executable error below.
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* already closed */ }
    }
  }
  return { command: executable, args: ["app-server"] };
}

function errorFromRpc(error: any, fallback: string): Error {
  const message = typeof error?.message === "string" ? error.message : fallback;
  const details = typeof error?.data === "string" ? `: ${error.data}` : "";
  return new Error(`${message}${details}`);
}

function failRun(run: CodexRun, error: Error): void {
  if (run.settled) return;
  run.settled = true;
  run.reject(error);
}

function completeRun(run: CodexRun): void {
  if (run.settled) return;
  run.settled = true;
  if (run.latestTokenUsage) run.onUsage?.(run.latestTokenUsage);
  const result = run.text.trim() ? run.text : run.commentaryText;
  if (!result.trim()) {
    run.reject(new Error("OpenAI Codex completed the turn without returning text."));
    return;
  }
  run.resolve(result);
}

/**
 * `thread/tokenUsage/updated` reports the thread's running total, matching one
 * "turn" in Rusty's model since each turn gets its own ephemeral thread — so
 * the latest notification value is stored and reported once, on completion,
 * rather than summed across multiple notifications.
 */
function usageFromCodexNotification(params: any): TokenUsageSample | undefined {
  const breakdown = params?.tokenUsage || params?.usage;
  if (!breakdown || typeof breakdown !== "object") return undefined;
  const input = Number(breakdown.inputTokens) || 0;
  const output = Number(breakdown.outputTokens) || 0;
  const reasoning = Number(breakdown.reasoningOutputTokens);
  return {
    input,
    output,
    cacheRead: Number(breakdown.cachedInputTokens) || 0,
    cacheWrite: 0,
    reasoning: Number.isFinite(reasoning) ? reasoning : undefined,
    totalTokens: Number(breakdown.totalTokens) || input + output,
  };
}

class CodexAppServerClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private nextRequestId = 0;
  private pending = new Map<string, PendingRequest>();
  // Scoped per-instance: each CodexAppServerClient owns its own process, so
  // its runs must not be visible to (or clearable by) any other instance.
  activeRuns = new Map<string, CodexRun>();

  async start(): Promise<void> {
    if (this.process) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async startInternal(): Promise<void> {
    const executable = resolveCodexExecutable();
    addAuthDiagnostic(`Starting Codex app-server from ${executable}.`);
    const launch = codexLaunch(executable);
    const child = spawn(launch.command, launch.args, {
      cwd: process.cwd(),
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;

    readline.createInterface({ input: child.stdout }).on("line", (line) => this.handleLine(line));
    readline.createInterface({ input: child.stderr }).on("line", (line) => {
      const compact = sanitizeDiagnostic(line);
      if (compact) console.info(`[Codex App Server] ${compact}`);
    });
    child.once("error", (error) => this.handleExit(error));
    child.once("exit", (code, signal) => {
      this.handleExit(new Error(`Codex app-server exited (code=${code ?? "none"}, signal=${signal || "none"}).`));
    });

    try {
      await this.requestWithoutStart("initialize", {
        clientInfo: { name: "rusty", title: "Rusty", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      }, 20_000);
      this.notify("initialized", {});
      addAuthDiagnostic("Codex app-server initialized with dynamic-tool support.");
    } catch (error) {
      child.kill();
      if (this.process === child) this.process = null;
      throw error;
    }
  }

  async request(method: string, params: any = {}, timeoutMs = 30_000): Promise<any> {
    await this.start();
    return this.requestWithoutStart(method, params, timeoutMs);
  }

  private requestWithoutStart(method: string, params: any, timeoutMs: number): Promise<any> {
    const child = this.process;
    if (!child || child.stdin.destroyed) return Promise.reject(new Error("Codex app-server is not running."));
    const id = String(++this.nextRequestId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ method, id: Number(id), params })}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(error);
      });
    });
  }

  notify(method: string, params: any): void {
    const child = this.process;
    if (!child || child.stdin.destroyed) return;
    child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  respond(id: string | number, result?: any, error?: any): void {
    const child = this.process;
    if (!child || child.stdin.destroyed) return;
    child.stdin.write(`${JSON.stringify(error ? { id, error } : { id, result })}\n`);
  }

  private handleLine(line: string): void {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (message?.method && message?.id !== undefined) {
      void this.handleServerRequest(message);
      return;
    }
    if (message?.method) {
      handleCodexNotification(message.method, message.params || {}, this.activeRuns);
      return;
    }
    if (message?.id === undefined) return;

    const key = String(message.id);
    const pending = this.pending.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(key);
    if (message.error) pending.reject(errorFromRpc(message.error, "Codex app-server request failed."));
    else pending.resolve(message.result);
  }

  private async handleServerRequest(message: any): Promise<void> {
    if (message.method !== "item/tool/call") {
      this.respond(message.id, undefined, { code: -32601, message: `Rusty does not handle ${message.method}.` });
      return;
    }

    const params = message.params || {};
    const run = this.activeRuns.get(params.threadId);
    const tool = run?.tools.get(params.tool);
    if (!run || !tool) {
      this.respond(message.id, {
        success: false,
        contentItems: [{ type: "inputText", text: `Tool ${params.tool || "unknown"} is not available.` }],
      });
      return;
    }

    run.toolCalls += 1;
    if (run.toolCalls > run.maxToolCalls) {
      this.respond(message.id, {
        success: false,
        contentItems: [{ type: "inputText", text: `Rusty stopped after ${run.maxToolCalls} tool calls.` }],
      });
      return;
    }

    run.sendLog(`Running ${tool.name}.`);
    try {
      const value = await tool.execute(params.arguments || {});
      const text = typeof value === "string" ? value : JSON.stringify(value);
      this.respond(message.id, {
        success: true,
        contentItems: [{ type: "inputText", text: (text || "Tool completed successfully.").slice(0, 20_000) }],
      });
    } catch (error: any) {
      this.respond(message.id, {
        success: false,
        contentItems: [{ type: "inputText", text: `Error: ${error?.message || String(error)}`.slice(0, 20_000) }],
      });
    }
  }

  private handleExit(error: Error): void {
    if (!this.process) return;
    this.process = null;
    this.rejectPendingRequests(error);
    this.failActiveRuns(error);
    addAuthDiagnostic(error.message);
  }

  private rejectPendingRequests(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private failActiveRuns(error: Error): void {
    for (const run of this.activeRuns.values()) failRun(run, error);
    this.activeRuns.clear();
  }

  async stop(): Promise<void> {
    const child = this.process;
    this.process = null;
    if (!child) return;
    const error = new Error("Codex app-server stopped.");
    this.rejectPendingRequests(error);
    this.failActiveRuns(error);
    child.kill();
  }
}

const appServer = new CodexAppServerClient();

function handleCodexNotification(method: string, params: any, activeRuns: Map<string, CodexRun>): void {
  if (method === "account/login/completed" && loginAttempt?.state === "connecting") {
    if (!loginAttempt.loginId || !params.loginId || loginAttempt.loginId === params.loginId) {
      loginAttempt = params.success
        ? { state: "connected", message: "OpenAI authorization completed." }
        : { state: "failed", message: params.error || "OpenAI authorization failed." };
      addAuthDiagnostic(params.success ? "Device authorization completed successfully." : `Device authorization failed: ${params.error || "unknown error"}`);
    }
    return;
  }

  if (method === "account/updated") {
    addAuthDiagnostic(`Account updated: authMode=${params.authMode || "none"}, planType=${params.planType || "none"}.`);
    if (params.authMode) loginAttempt = { state: "connected", message: "OpenAI Codex is connected." };
    return;
  }

  const run = activeRuns.get(params.threadId);
  if (!run) return;
  if (method === "item/started" && params.item?.type === "agentMessage") {
    run.messagePhases.set(params.item.id, params.item.phase || null);
    const phase = params.item.phase;
    if (phase === "commentary") run.sendLog("Sub-agent reasoning...");
    else if (phase === "final_answer") run.sendLog("Sub-agent formulating response...");
    else run.sendLog("Sub-agent processing...");
    return;
  }
  if (method === "item/started" && params.item?.type && params.item.type !== "agentMessage") {
    run.sendLog(`Sub-agent action: ${params.item.type}`);
    return;
  }
  if (method === "item/agentMessage/delta" && typeof params.delta === "string") {
    if (run.messagePhases.get(params.itemId) === "commentary") run.commentaryText += params.delta;
    else run.text += params.delta;
    run.sendToken(params.delta);
    return;
  }
  if (method === "error" && !params.willRetry) {
    failRun(run, errorFromRpc(params.error, "OpenAI Codex turn failed."));
    return;
  }
  if (method === "thread/tokenUsage/updated") {
    const sample = usageFromCodexNotification(params);
    if (sample) run.latestTokenUsage = sample;
    return;
  }
  if (method === "turn/completed") {
    const status = params.turn?.status;
    if (status === "completed") completeRun(run);
    else if (status === "interrupted") failRun(run, new Error("OpenAI Codex request was cancelled."));
    else failRun(run, errorFromRpc(params.turn?.error, "OpenAI Codex turn failed."));
  }
}

function statusFromAccount(result: any): CodexConnectionStatus {
  const account = result?.account;
  if (!account) {
    return {
      state: "disconnected",
      authenticated: false,
      message: result?.requiresOpenaiAuth === false
        ? "Codex is configured for a provider that does not require OpenAI sign-in."
        : "Sign in with your OpenAI account to use your Codex plan.",
    };
  }
  const authType = account.type || "unknown";
  return {
    state: "connected",
    authenticated: true,
    authType,
    email: account.email || undefined,
    planType: account.planType || undefined,
    message: authType === "chatgpt"
      ? `Connected to OpenAI Codex${account.planType ? ` (${account.planType})` : ""}.`
      : `Codex is authenticated using ${authType}.`,
  };
}

export async function getCodexConnectionStatus(): Promise<CodexConnectionStatus> {
  try {
    const result = await appServer.request("account/read", { refreshToken: false }, 20_000);
    if (loginAttempt?.state === "connecting") {
      return withDiagnostics({
        state: "connecting",
        authenticated: false,
        message: loginAttempt.message || "Waiting for OpenAI authorization.",
        verificationUri: loginAttempt.verificationUri,
        userCode: loginAttempt.userCode,
      });
    }
    const status = statusFromAccount(result);
    if (status.authenticated) {
      loginAttempt = { state: "connected", message: status.message };
      return withDiagnostics(status);
    }
    if (loginAttempt?.state === "failed") {
      return withDiagnostics({ ...status, state: "failed", message: loginAttempt.message });
    }
    return withDiagnostics(status);
  } catch (error: any) {
    addAuthDiagnostic(`Account status check failed: ${error?.message || String(error)}`);
    return withDiagnostics({
      state: "failed",
      authenticated: false,
      message: error?.message || "Could not query OpenAI Codex authentication.",
    });
  }
}

export async function readCodexQuota(): Promise<{
  status: CodexConnectionStatus;
  rateLimitResult?: any;
}> {
  const status = await getCodexConnectionStatus();
  if (!status.authenticated) return { status };
  if (status.authType !== "chatgpt" && status.authType !== "personalAccessToken") {
    return { status };
  }
  try {
    const rateLimitResult = await appServer.request("account/rateLimits/read", {}, 20_000);
    return { status, rateLimitResult };
  } catch (error: any) {
    addAuthDiagnostic(`Rate-limit check failed: ${error?.message || String(error)}`);
    throw new Error(error?.message || "Could not query OpenAI Codex quota.");
  }
}

export async function startCodexLogin(): Promise<CodexConnectionStatus> {
  if (loginAttempt?.state === "connecting") {
    return withDiagnostics({
      state: "connecting",
      authenticated: false,
      message: loginAttempt.message,
      verificationUri: loginAttempt.verificationUri,
      userCode: loginAttempt.userCode,
    });
  }

  authDiagnostics = [];
  const result = await appServer.request(
    "account/login/start",
    { type: "chatgptDeviceCode" },
    30_000,
  );
  loginAttempt = {
    state: "connecting",
    loginId: result?.loginId,
    message: "Complete OpenAI authorization using the provided device code.",
    verificationUri: result?.verificationUri,
    userCode: result?.userCode,
  };
  addAuthDiagnostic("Started OpenAI device authorization.");
  return withDiagnostics({
    state: "connecting",
    authenticated: false,
    message: loginAttempt.message,
    verificationUri: loginAttempt.verificationUri,
    userCode: loginAttempt.userCode,
  });
}

export async function logoutCodex(): Promise<CodexConnectionStatus> {
  try {
    await appServer.request("account/logout", {}, 20_000);
  } catch (error: any) {
    addAuthDiagnostic(`Logout failed: ${error?.message || String(error)}`);
    throw new Error(error?.message || "Could not sign out of OpenAI Codex.");
  } finally {
    loginAttempt = null;
  }
  return withDiagnostics({
    state: "disconnected",
    authenticated: false,
    message: "Signed out of OpenAI Codex.",
  });
}

export function normalizeCodexModel(model: any): DiscoveredProviderModel {
  const remoteId = model.id || model.model;
  const reasoningEfforts = (model.supportedReasoningEfforts || [])
    .map((effort: any) => typeof effort === "string" ? effort : effort.reasoningEffort)
    .filter(Boolean);
  const capabilities = ["reasoning"];
  if ((model.inputModalities || []).includes("image")) capabilities.push("vision");

  return {
    id: `${OPENAI_CODEX_PROVIDER_ID}/${remoteId}`,
    remoteId,
    name: model.displayName || remoteId,
    apiType: "codex-app-server",
    supported: !model.hidden,
    input: model.inputModalities,
    capabilities,
    reasoning: true,
    supportedReasoningEfforts: reasoningEfforts,
    defaultReasoningEffort: model.defaultReasoningEffort,
    compat: {
      isDefault: Boolean(model.isDefault),
      defaultReasoningEffort: model.defaultReasoningEffort,
      supportedReasoningEfforts: reasoningEfforts,
    },
  };
}

export async function discoverCodexModels(): Promise<DiscoveredProviderModel[]> {
  const models: DiscoveredProviderModel[] = [];
  let cursor: string | undefined;
  do {
    const result = await appServer.request(
      "model/list",
      { cursor, limit: 100, includeHidden: false },
      30_000,
    );
    for (const model of result?.data || []) models.push(normalizeCodexModel(model));
    cursor = result?.nextCursor || result?.next_cursor;
  } while (cursor);
  return models;
}

export async function testCodexConnection(): Promise<{ modelCount: number; supportedModelCount: number }> {
  const models = await discoverCodexModels();
  return {
    modelCount: models.length,
    supportedModelCount: models.filter((model) => model.supported).length,
  };
}

export function codexDynamicTools(tools: CodexTool[]): { specs: any[]; byName: Map<string, CodexTool> } {
  const byName = new Map<string, CodexTool>();
  const toolDefinitions = tools.map((tool) => {
    const baseName = tool.name.replace(/[^A-Za-z0-9_]/g, "_");
    let name = baseName || "tool";
    let suffix = 2;
    while (byName.has(name)) name = `${baseName || "tool"}_${suffix++}`;
    byName.set(name, tool);
    return {
      name,
      description: tool.description,
      inputSchema: tool.inputSchema || { type: "object", properties: {} },
    };
  });
  return {
    specs: toolDefinitions.length ? [{
      type: "namespace",
      name: "rusty",
      description: "Rusty tools",
      tools: toolDefinitions,
    }] : [],
    byName,
  };
}

async function runCodexTurn(options: {
  modelId: string;
  systemPrompt: string;
  userMessage: string;
  history?: Array<{ role: string; content: string }>;
  tools?: CodexTool[];
  sendLog?: (message: string) => void;
  sendToken?: (token: string) => void;
  maxToolCalls?: number;
  maxRounds?: number;
  reasoning?: string;
  cwd?: string;
  shouldAbort?: () => boolean;
  signal?: AbortSignal;
  onUsage?: (sample: TokenUsageSample) => void;
}): Promise<string> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const toolSet = codexDynamicTools(options.tools || []);
  const prompt = (options.history || [])
    .slice(-12)
    .map((item) => `${item.role.toUpperCase()}: ${item.content}`)
    .concat([`USER: ${options.userMessage}`])
    .join("\n\n");
  const threadResult = await appServer.request("thread/start", { cwd: options.cwd }, 30_000);
  const threadId = threadResult?.thread?.id || threadResult?.id;
  if (!threadId) throw new Error("OpenAI Codex did not return a thread id.");

  return new Promise<string>((resolve, reject) => {
    const run: CodexRun = {
      threadId,
      text: "",
      commentaryText: "",
      messagePhases: new Map(),
      tools: toolSet.byName,
      toolCalls: 0,
      maxToolCalls: options.maxToolCalls ?? options.maxRounds ?? 20,
      sendLog: options.sendLog || (() => {}),
      sendToken: options.sendToken || (() => {}),
      onUsage: options.onUsage,
      resolve,
      reject,
      settled: false,
    };
    appServer.activeRuns.set(threadId, run);

    void appServer.request("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt }],
      model: options.modelId,
      systemPrompt: options.systemPrompt,
      cwd: options.cwd,
      effort: options.reasoning,
      dynamicTools: toolSet.specs,
    }, 30_000).catch((error) => failRun(run, error));

    const timer = options.shouldAbort
      ? setInterval(() => {
          if (options.shouldAbort?.()) controller.abort();
        }, 150)
      : undefined;

    const cleanup = () => {
      if (timer) clearInterval(timer);
      options.signal?.removeEventListener("abort", abort);
      appServer.activeRuns.delete(threadId);
    };
    const originalResolve = run.resolve;
    const originalReject = run.reject;
    run.resolve = (text) => {
      cleanup();
      originalResolve(text);
    };
    run.reject = (error) => {
      cleanup();
      originalReject(error);
    };
  });
}

export async function completeCodexText(options: Parameters<typeof runCodexTurn>[0]): Promise<string> {
  return runCodexTurn(options);
}

export async function callCodexWithToolsStreaming(options: Parameters<typeof runCodexTurn>[0]): Promise<string> {
  return runCodexTurn({
    ...options,
    maxToolCalls: options.maxToolCalls ?? options.maxRounds,
  });
}

export async function shutdownCodexService(): Promise<void> {
  await appServer.stop();
}
