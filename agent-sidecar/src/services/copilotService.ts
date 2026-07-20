import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  CopilotClient,
  RuntimeConnection,
  type CopilotSession,
  type GetAuthStatusResponse,
  type ModelInfo,
  type Tool,
} from "@github/copilot-sdk";
import type { DiscoveredProviderModel } from "./llmProviders";

export const GITHUB_COPILOT_PROVIDER_ID = "github-copilot";

export interface CopilotConnectionStatus {
  state: "disconnected" | "connecting" | "connected" | "failed";
  authenticated: boolean;
  authType?: GetAuthStatusResponse["authType"];
  host?: string;
  login?: string;
  message?: string;
  verificationUri?: string;
  userCode?: string;
  diagnostics?: string[];
}

interface LoginAttempt {
  state: "connecting" | "connected" | "failed";
  message?: string;
  verificationUri?: string;
  userCode?: string;
}

type CopilotReasoningEffort = "low" | "medium" | "high" | "xhigh";

let client: CopilotClient | null = null;
let clientPromise: Promise<CopilotClient> | null = null;
let clientStopPromise: Promise<void> | null = null;
let loginProcess: ChildProcess | null = null;
let loginAttempt: LoginAttempt | null = null;
let loginOutputBuffer = "";
let authDiagnostics: string[] = [];
let lastAuthFingerprint = "";

function copilotHome(): string {
  return process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot");
}

function candidateNodeModuleRoots(): string[] {
  return [
    // Production: server.js and node_modules are staged together.
    path.resolve(__dirname, "node_modules"),
    // Development through ts-node from src/services.
    path.resolve(__dirname, "../../node_modules"),
    path.resolve(__dirname, "../../../agent-sidecar/node_modules"),
    path.resolve(process.cwd(), "node_modules"),
    path.resolve(process.cwd(), "agent-sidecar/node_modules"),
  ];
}

function resolveCopilotCliLoader(): string {
  for (const root of candidateNodeModuleRoots()) {
    const candidate = path.join(root, "@github", "copilot", "npm-loader.js");
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error("The bundled GitHub Copilot CLI could not be located.");
}

function keychainEnabledRuntimeConnection() {
  // Empty mode provides Axiom's required session isolation, but the SDK also sets
  // COPILOT_DISABLE_KEYTAR=1 in that mode. Launch through the bundled Node runtime
  // and remove only that flag so the CLI can read the credential it saved in the
  // current user's system keychain.
  return RuntimeConnection.forStdio({
    path: process.execPath,
    args: [
      "-e",
      'delete process.env.COPILOT_DISABLE_KEYTAR; import(require("node:url").pathToFileURL(process.argv[1]).href);',
      resolveCopilotCliLoader(),
    ],
  });
}

function sanitizedCliOutput(value: string): string {
  return value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/(?:gh[oupsr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, "[redacted]")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\^D/g, "");
}

function compactCliMessage(value: string): string {
  return sanitizedCliOutput(value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function diagnosticMessage(value: string): string {
  return compactCliMessage(value)
    .replace(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/gi, "[device-code]")
    .replace(/(Signed in successfully as)\s+.+?(?:\.|$)/i, "$1 [account].")
    .replace(copilotHome(), "$COPILOT_HOME");
}

function addAuthDiagnostic(message: string): void {
  const entry = `${new Date().toISOString()} ${diagnosticMessage(message)}`;
  authDiagnostics = [...authDiagnostics.slice(-49), entry];
  console.info(`[Copilot Auth] ${entry}`);
}

function withDiagnostics(status: CopilotConnectionStatus): CopilotConnectionStatus {
  return { ...status, diagnostics: [...authDiagnostics] };
}

function authEnvironmentSummary(): string {
  const tokenVariables = ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"]
    .filter((name) => Boolean(process.env[name]));
  return tokenVariables.length
    ? `Authentication environment variables present: ${tokenVariables.join(", ")}. Values are not logged.`
    : "No Copilot/GitHub authentication environment variables are present.";
}

function recordAuthStatus(source: string, auth: GetAuthStatusResponse, force = false): void {
  const diagnosticStatus = auth.isAuthenticated
    ? "Authenticated"
    : auth.statusMessage || "none";
  const fingerprint = JSON.stringify({
    authenticated: auth.isAuthenticated,
    authType: auth.authType || "none",
    host: auth.host || "none",
    status: auth.statusMessage || "none",
  });
  if (!force && fingerprint === lastAuthFingerprint) return;
  lastAuthFingerprint = fingerprint;
  addAuthDiagnostic(
    `${source}: authenticated=${auth.isAuthenticated}, authType=${auth.authType || "none"}, host=${auth.host || "none"}, status=${diagnosticStatus}`,
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function parseCopilotLoginOutput(value: string): Pick<LoginAttempt, "verificationUri" | "userCode"> {
  const output = sanitizedCliOutput(value);
  const instruction = output.match(
    /(?:visit|open)\s+(https:\/\/[^\s]+?)\s+(?:and\s+)?(?:then\s+)?enter\s+(?:the\s+)?code\s+([A-Z0-9]{4}(?:-[A-Z0-9]{4})+)/i,
  );
  if (instruction) {
    return {
      verificationUri: instruction[1].replace(/[),.;]+$/, ""),
      userCode: instruction[2].toUpperCase(),
    };
  }

  const verificationUri = output.match(/https:\/\/github\.com\/login\/device\b[^\s]*/i)?.[0]
    ?.replace(/[),.;]+$/, "");
  const userCode = output.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/i)?.[0]?.toUpperCase();
  return { verificationUri, userCode };
}

async function stopClient(): Promise<void> {
  if (clientStopPromise) return clientStopPromise;

  const current = client;
  const pending = clientPromise;
  client = null;
  clientPromise = null;
  clientStopPromise = (async () => {
    let target = current;
    if (!target && pending) {
      try {
        target = await pending;
      } catch {
        return;
      }
    }
    if (target) {
      if (client === target) client = null;
      const result = await Promise.race([
        target.stop()
          .then((errors) => ({ kind: "stopped" as const, errors }))
          .catch((error) => ({ kind: "failed" as const, error })),
        delay(3_000).then(() => ({ kind: "timeout" as const })),
      ]);
      if (result.kind === "stopped" && result.errors.length) {
        addAuthDiagnostic(`SDK client stopped with ${result.errors.length} cleanup error(s).`);
      } else if (result.kind === "failed") {
        addAuthDiagnostic(`SDK client stop failed: ${result.error instanceof Error ? result.error.message : String(result.error)}. Forcing shutdown.`);
        await target.forceStop().catch(() => {});
      } else if (result.kind === "timeout") {
        addAuthDiagnostic("SDK client stop exceeded three seconds; forcing shutdown.");
        await target.forceStop().catch(() => {});
      }
    }
  })();

  try {
    await clientStopPromise;
  } finally {
    clientStopPromise = null;
  }
}

async function getClient(): Promise<CopilotClient> {
  if (clientStopPromise) await clientStopPromise;
  if (client) return client;
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    addAuthDiagnostic(`Starting isolated SDK client with COPILOT_HOME=${copilotHome()} and system keychain access enabled.`);
    const created = new CopilotClient({
      mode: "empty",
      connection: keychainEnabledRuntimeConnection(),
      baseDirectory: copilotHome(),
      logLevel: "error",
      useLoggedInUser: true,
    });
    await created.start();
    client = created;
    addAuthDiagnostic("SDK client started.");
    return created;
  })();

  try {
    return await clientPromise;
  } catch (error) {
    clientPromise = null;
    addAuthDiagnostic(`SDK client failed to start: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

function statusFromAuth(auth: GetAuthStatusResponse): CopilotConnectionStatus {
  return {
    state: auth.isAuthenticated ? "connected" : "disconnected",
    authenticated: auth.isAuthenticated,
    authType: auth.authType,
    host: auth.host,
    login: auth.login,
    message: auth.statusMessage,
  };
}

export async function getCopilotConnectionStatus(): Promise<CopilotConnectionStatus> {
  if (loginAttempt?.state === "connecting") {
    return withDiagnostics({
      state: "connecting",
      authenticated: false,
      message: loginAttempt.message || "Waiting for GitHub authorization.",
      verificationUri: loginAttempt.verificationUri,
      userCode: loginAttempt.userCode,
    });
  }

  try {
    const sdk = await getClient();
    const auth = await sdk.getAuthStatus();
    recordAuthStatus("SDK status check", auth);
    const status = statusFromAuth(auth);
    if (loginAttempt?.state === "failed" && !status.authenticated) {
      return withDiagnostics({
        ...status,
        state: "failed",
        message: loginAttempt.message,
      });
    }
    return withDiagnostics(status);
  } catch (error: any) {
    addAuthDiagnostic(`SDK status check failed: ${error?.message || String(error)}`);
    return withDiagnostics({
      state: "failed",
      authenticated: false,
      message: error?.message || "Could not query GitHub Copilot authentication.",
    });
  }
}

async function finalizeSuccessfulLogin(): Promise<void> {
  loginAttempt = {
    state: "connecting",
    message: "GitHub approved the device. Verifying the stored Copilot credential…",
  };
  addAuthDiagnostic("CLI reported login success; restarting the SDK client before authentication verification.");
  await stopClient();

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    if (attempt > 1) await delay(attempt * 400);
    try {
      const sdk = await getClient();
      const auth = await sdk.getAuthStatus();
      recordAuthStatus(`Post-login SDK verification ${attempt}/4`, auth, true);
      if (auth.isAuthenticated) {
        loginAttempt = { state: "connected", message: "GitHub authorization completed." };
        addAuthDiagnostic("Authentication handoff completed successfully.");
        return;
      }
    } catch (error: any) {
      addAuthDiagnostic(`Post-login SDK verification ${attempt}/4 failed: ${error?.message || String(error)}`);
    }
    if (attempt < 4) await stopClient();
  }

  loginAttempt = {
    state: "failed",
    message: "GitHub approved the device, but the Copilot SDK could not read the saved credential. See Authentication diagnostics below.",
  };
  addAuthDiagnostic("Authentication handoff failed after four SDK verification attempts.");
}

export async function startCopilotLogin(): Promise<CopilotConnectionStatus> {
  if (loginProcess || loginAttempt?.state === "connecting") {
    return withDiagnostics({
      state: "connecting",
      authenticated: false,
      message: loginAttempt?.message || "Waiting for GitHub authorization.",
      verificationUri: loginAttempt?.verificationUri,
      userCode: loginAttempt?.userCode,
    });
  }

  authDiagnostics = [];
  lastAuthFingerprint = "";
  const loader = resolveCopilotCliLoader();
  loginAttempt = { state: "connecting", message: "Preparing GitHub authorization…" };
  loginOutputBuffer = "";
  addAuthDiagnostic("Login requested; credentials will remain in the system credential store.");
  addAuthDiagnostic(`COPILOT_HOME=${copilotHome()} (exists=${fs.existsSync(copilotHome())}).`);
  addAuthDiagnostic(authEnvironmentSummary());
  await stopClient();

  const command = process.execPath;
  const commandArgs = [loader, "login", "--host", "https://github.com"];
  addAuthDiagnostic("Starting Copilot CLI login.");
  loginAttempt.message = "Opening GitHub authorization in your browser…";
  const child = spawn(command, commandArgs, {
    env: { ...process.env, COPILOT_HOME: copilotHome(), NO_COLOR: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  loginProcess = child;
  let reportedSuccess = false;
  let reportedStorageFailure = false;

  const updateMessage = (chunk: Buffer) => {
    const cleanChunk = sanitizedCliOutput(chunk.toString("utf8"));
    loginOutputBuffer = `${loginOutputBuffer}${cleanChunk}`.slice(-4_000);
    const message = compactCliMessage(loginOutputBuffer);
    const deviceFlow = parseCopilotLoginOutput(loginOutputBuffer);
    const storageFailure = /Login succeeded, but the token was not saved/i.test(loginOutputBuffer);
    reportedSuccess ||= /Signed in successfully as/i.test(loginOutputBuffer);
    reportedStorageFailure ||= storageFailure;

    const chunkDiagnostic = diagnosticMessage(cleanChunk);
    if (chunkDiagnostic) addAuthDiagnostic(`CLI output: ${chunkDiagnostic}`);
    if (deviceFlow.userCode && !loginAttempt?.userCode) {
      addAuthDiagnostic(`CLI emitted a device code for ${deviceFlow.verificationUri || "the GitHub verification page"}.`);
    }
    if (message && loginAttempt?.state === "connecting") {
      loginAttempt = {
        ...loginAttempt,
        ...deviceFlow,
        message: storageFailure
          ? "GitHub approved the device, but macOS Keychain was unavailable and the token was not saved."
          : deviceFlow.userCode
            ? "Enter the device code below in the GitHub authorization window."
            : message,
      };
    }
  };
  child.stdout?.on("data", updateMessage);
  child.stderr?.on("data", updateMessage);

  child.once("error", (error) => {
    loginAttempt = { state: "failed", message: error.message };
    addAuthDiagnostic(`Copilot CLI process failed: ${error.message}`);
    loginOutputBuffer = "";
    loginProcess = null;
  });
  child.once("exit", (code, signal) => {
    loginProcess = null;
    addAuthDiagnostic(`Copilot CLI exited (code=${code ?? "none"}, signal=${signal || "none"}, reportedSuccess=${reportedSuccess}).`);
    if (!reportedStorageFailure && (code === 0 || reportedSuccess)) {
      void finalizeSuccessfulLogin().finally(() => {
        loginOutputBuffer = "";
      });
    } else {
      loginAttempt = {
        state: "failed",
        message: reportedStorageFailure
          ? "GitHub approved the device, but macOS Keychain was unavailable and the token was not saved."
          : loginAttempt?.message || `GitHub authorization exited with code ${code ?? "unknown"}.`,
      };
      loginOutputBuffer = "";
    }
  });

  return withDiagnostics({ state: "connecting", authenticated: false, message: loginAttempt.message });
}

export function normalizeCopilotModel(model: ModelInfo): DiscoveredProviderModel {
  const enabled = model.policy?.state !== "disabled";
  return {
    id: `${GITHUB_COPILOT_PROVIDER_ID}/${model.id}`,
    remoteId: model.id,
    name: model.name || model.id,
    apiType: "copilot-sdk",
    supported: enabled,
    capabilities: [
      "tool-calling",
      ...(model.capabilities.supports.vision ? ["vision"] : []),
      ...(model.capabilities.supports.reasoningEffort ? ["reasoning"] : []),
    ],
    reasoning: model.capabilities.supports.reasoningEffort,
    supportedReasoningEfforts: (model.supportedReasoningEfforts || []).filter((effort) =>
      effort === "low" || effort === "medium" || effort === "high" || effort === "xhigh"
    ),
    defaultReasoningEffort: model.defaultReasoningEffort === "low"
      || model.defaultReasoningEffort === "medium"
      || model.defaultReasoningEffort === "high"
      || model.defaultReasoningEffort === "xhigh"
      ? model.defaultReasoningEffort
      : undefined,
    input: model.capabilities.supports.vision ? ["text", "image"] : ["text"],
    contextWindow: model.capabilities.limits.max_context_window_tokens,
    compat: {
      policy: model.policy,
      billingMultiplier: model.billing?.multiplier,
      supportedReasoningEfforts: model.supportedReasoningEfforts,
      defaultReasoningEffort: model.defaultReasoningEffort,
    },
  };
}

export async function discoverCopilotModels(): Promise<DiscoveredProviderModel[]> {
  const sdk = await getClient();
  const auth = await sdk.getAuthStatus();
  if (!auth.isAuthenticated) {
    throw new Error("Sign in with GitHub before loading Copilot models.");
  }
  const models = await sdk.listModels();
  return models
    .map(normalizeCopilotModel)
    .sort((a, b) => Number(b.supported) - Number(a.supported) || a.name.localeCompare(b.name));
}

export async function testCopilotConnection(): Promise<{ modelCount: number; supportedModelCount: number }> {
  const models = await discoverCopilotModels();
  return {
    modelCount: models.length,
    supportedModelCount: models.filter((model) => model.supported).length,
  };
}

function historyPrompt(history: Array<{ role: string; content: string }> | undefined, userMessage: string): string {
  const previous = (history || [])
    .filter((entry) => entry?.role === "user" || entry?.role === "assistant")
    .slice(-12)
    .map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`)
    .join("\n\n");
  return previous
    ? `Previous conversation:\n${previous}\n\nCurrent request:\n${userMessage}`
    : userMessage;
}

function copilotReasoningEffort(value?: string): CopilotReasoningEffort | undefined {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh"
    ? value
    : undefined;
}

async function disconnectSession(session: CopilotSession | undefined): Promise<void> {
  if (!session) return;
  try {
    await session.disconnect();
  } catch (error) {
    console.warn("[Copilot] Failed to disconnect an ephemeral session:", error);
  }
}

export async function completeCopilotText(options: {
  modelId: string;
  systemPrompt: string;
  userMessage: string;
  history?: Array<{ role: string; content: string }>;
  reasoning?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const sdk = await getClient();
  let session: CopilotSession | undefined;
  let abortHandler: (() => void) | undefined;
  try {
    session = await sdk.createSession({
      clientName: "Axiom",
      model: options.modelId,
      reasoningEffort: copilotReasoningEffort(options.reasoning),
      streaming: false,
      systemMessage: { mode: "append", content: options.systemPrompt },
      tools: [],
      availableTools: [],
      enableSessionTelemetry: false,
      enableConfigDiscovery: false,
      skipCustomInstructions: true,
      infiniteSessions: { enabled: false },
    });
    abortHandler = () => void session?.abort();
    options.signal?.addEventListener("abort", abortHandler, { once: true });
    const response = await session.sendAndWait(historyPrompt(options.history, options.userMessage), 300_000);
    const text = response?.data.content || "";
    if (!text.trim()) throw new Error("GitHub Copilot returned no text.");
    return text;
  } finally {
    if (abortHandler) options.signal?.removeEventListener("abort", abortHandler);
    await disconnectSession(session);
  }
}

export async function callCopilotWithToolsStreaming(options: {
  modelId: string;
  systemPrompt: string;
  userMessage: string;
  tools: Array<{ name: string; description: string; inputSchema?: any; execute: (args: any) => Promise<any> }>;
  sendLog: (message: string) => void;
  sendToken: (token: string) => void;
  history?: Array<{ role: string; content: string }>;
  reasoning?: string;
  shouldAbort?: () => boolean;
}): Promise<string> {
  const sdk = await getClient();
  let session: CopilotSession | undefined;
  let abortTimer: ReturnType<typeof setInterval> | undefined;
  const tools: Tool[] = options.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema || { type: "object", properties: {}, required: [] },
    skipPermission: true,
    defer: "never",
    handler: async (args) => {
      options.sendLog(`Running ${tool.name}.`);
      const value = await tool.execute(args);
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return text.slice(0, 8_000);
    },
  }));

  try {
    session = await sdk.createSession({
      clientName: "Axiom",
      model: options.modelId,
      reasoningEffort: copilotReasoningEffort(options.reasoning),
      streaming: true,
      includeSubAgentStreamingEvents: false,
      systemMessage: { mode: "append", content: options.systemPrompt },
      tools,
      availableTools: tools.map((tool) => `custom:${tool.name}`),
      enableSessionTelemetry: false,
      enableConfigDiscovery: false,
      skipCustomInstructions: true,
      infiniteSessions: { enabled: false },
    });

    session.on("assistant.message_delta", (event) => {
      if (!event.agentId && event.data.deltaContent) options.sendToken(event.data.deltaContent);
    });
    if (options.shouldAbort) {
      abortTimer = setInterval(() => {
        if (options.shouldAbort?.()) void session?.abort();
      }, 100);
    }

    options.sendLog(`Calling GitHub Copilot model ${options.modelId}.`);
    const response = await session.sendAndWait(historyPrompt(options.history, options.userMessage), 600_000);
    if (options.shouldAbort?.()) throw new Error("Client disconnected");
    const text = response?.data.content || "";
    if (!text.trim()) throw new Error("GitHub Copilot returned no text.");
    return text;
  } finally {
    if (abortTimer) clearInterval(abortTimer);
    await disconnectSession(session);
  }
}

export async function shutdownCopilotService(): Promise<void> {
  if (loginProcess) {
    loginProcess.kill();
    loginProcess = null;
  }
  await stopClient();
}
