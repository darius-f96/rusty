import * as fs from "node:fs/promises";
import { getPiResourceLoader } from "./piMcp";
import { importEsm } from "./esmImport";
import { installPiCommandPolicy } from "./piCommandPolicy";

interface ActivePiRun {
  stop: (reason: string) => Promise<void>;
  backgroundAgents: Set<string>;
}

const activePiRuns = new Map<string, ActivePiRun>();
const DEFAULT_SUBAGENT_MAX_TURNS = 4;
const DEFAULT_SUBAGENT_GRACE_TURNS = 1;

/** Stop the main Pi session and all background agents associated with a chat tab. */
export async function stopPiAgentRun(tabId: string, reason = "Stopped by user."): Promise<boolean> {
  const run = activePiRuns.get(tabId);
  if (!run) return false;
  await run.stop(reason);
  return true;
}

/** True while the main agent still needs to collect one or more delegated results. */
export function hasActiveBackgroundSubagents(tabId: string): boolean {
  return (activePiRuns.get(tabId)?.backgroundAgents.size ?? 0) > 0;
}

export interface PiChatTool {
  name: string;
  description: string;
  inputSchema?: any;
  execute: (args: any) => Promise<any>;
}

/**
 * Pi's SDK tools use `parameters` and a five-argument execute callback, whereas
 * the sidecar's existing tools use JSON-schema `inputSchema` and accept only
 * the parsed arguments. Keep that adapter here so every UI, search, and
 * question tool is presented to Pi in the contract it expects.
 */
function toPiSdkTool(tool: PiChatTool) {
  return {
    name: tool.name,
    label: tool.name.replace(/_/g, " "),
    description: tool.description,
    parameters: tool.inputSchema ?? { type: "object", properties: {} },
    execute: async (_toolCallId: string, params: any) => {
      try {
        const result = await tool.execute(params ?? {});
        const text = typeof result === "string" ? result : JSON.stringify(result);
        return {
          content: [{ type: "text", text }],
          details: {},
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: error?.message || String(error) }],
          details: { error: error?.message || String(error) },
          isError: true,
        };
      }
    },
  };
}

export interface DeferredUserQuestion {
  question: string;
  options: Array<{ label: string; description?: string }>;
}

export interface SubagentUpdate {
  id: string;
  previousId?: string;
  agentId?: string;
  displayName?: string;
  description: string;
  subagentType?: string;
  isAggregation?: boolean;
  status: "queued" | "running" | "background" | "completed" | "steered" | "aborted" | "stopped" | "error";
  activity?: string;
  result?: string;
  error?: string;
  outputFile?: string;
  toolUses?: number;
  tokens?: string;
  turnCount?: number;
  maxTurns?: number;
  durationMs?: number;
  appendLog?: string;
  logs?: string[];
  startedAt?: string;
  updatedAt: string;
}

interface RunPiAgentChatOptions {
  tabId: string;
  model: string;
  workspaceRoot: string;
  systemPrompt: string;
  conversationHistory: Array<{ role: string; content: string }>;
  message: string;
  tools: PiChatTool[];
  customProvider?: {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiType: string;
    models: Array<{ id: string; name: string }>;
  } | null;
  sendLog: (message: string) => void;
  sendToken: (token: string) => void;
  sendSubagentUpdate: (subagent: SubagentUpdate) => void;
  consumeDeferredQuestion?: () => DeferredUserQuestion | undefined;
  requestUserQuestion?: (question: DeferredUserQuestion) => Promise<string>;
}

function supportsPiRuntime(): boolean {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 19);
}

function textFromAssistantMessage(message: any): string {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return "";
  return message.content
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("");
}

function toolEventKey(event: any): string | undefined {
  return event?.toolCallId || event?.toolUseId || event?.toolExecutionId || event?.executionId || event?.id || event?.toolCall?.id;
}

function textFromToolResult(result: any): string | undefined {
  if (!result) return undefined;
  if (typeof result === "string") return result;
  if (typeof result.text === "string") return result.text;
  if (typeof result.content === "string") return result.content;
  if (Array.isArray(result.content)) {
    return result.content
      .filter((part: any) => part?.type === "text" && typeof part.text === "string")
      .map((part: any) => part.text)
      .join("\n")
      .trim() || undefined;
  }
  return undefined;
}

function outputFileFromText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = text.match(/^Output file:\s*(.+)$/m);
  return match?.[1]?.trim();
}

function compactLogText(text: string | undefined, maxLength = 180): string | undefined {
  const normalized = text?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

function textFromMessageContent(content: any): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  return content
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("\n")
    .trim() || undefined;
}

function describeToolInput(input: any): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const preferredKeys = ["path", "file_path", "query", "pattern", "command", "url", "description", "prompt"];
  for (const key of preferredKeys) {
    if (typeof input[key] === "string" && input[key].trim()) return compactLogText(input[key], 120);
  }
  const entries = Object.entries(input)
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .slice(0, 2)
    .map(([key, value]) => `${key}=${String(value)}`);
  return entries.length > 0 ? compactLogText(entries.join(", "), 120) : undefined;
}

function toolLogLines(content: any): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((part: any) => part?.type === "tool_use" && typeof part.name === "string")
    .map((part: any) => {
      const input = describeToolInput(part.input ?? part.arguments);
      return input ? `Tool started: ${part.name} — ${input}` : `Tool started: ${part.name}`;
    });
}

function summarizeTranscriptEntry(entry: any): string | undefined {
  const message = entry?.message;
  // The initial user entry is the parent-issued task, not live subagent work.
  // It belongs in the main agent activity stream rather than the compact card.
  if (entry?.type === "user") return undefined;

  if (entry?.type === "assistant") {
    const toolLines = toolLogLines(message?.content);
    if (toolLines.length > 0) return toolLines.join("\n");
    const text = compactLogText(textFromMessageContent(message?.content));
    return text ? `Assistant: ${text}` : "Assistant response updated.";
  }

  if (entry?.type === "toolResult") {
    const text = compactLogText(textFromMessageContent(message?.content) || textFromToolResult(message));
    return text ? `Tool result: ${text}` : "Tool result received.";
  }

  return undefined;
}

function subagentDescription(args: any, fallback = "Subagent"): string {
  return args?.description || args?.prompt?.split("\n")[0]?.slice(0, 120) || fallback;
}

function normalizeSubagentStatus(status: any, isError?: boolean): SubagentUpdate["status"] {
  if (isError) return "error";
  if (status === "queued" || status === "running" || status === "background" || status === "completed" ||
      status === "steered" || status === "aborted" || status === "stopped" || status === "error") {
    return status;
  }
  return "completed";
}

function getLiveSubagentRecord(id: string): any | undefined {
  const registry = (globalThis as any)[Symbol.for("pi-subagents:manager")];
  return registry?.getRecord?.(id);
}

/**
 * Runs Agent Tab through Pi so extension tools such as Agent/get_subagent_result
 * are first-class model tools rather than hand-written adapters.
 */
export async function runPiAgentChat(options: RunPiAgentChatOptions): Promise<string | undefined> {
  // Install before runtime-version fallback: executeNode may create a lower-level
  // Pi session afterwards, and it must inherit the same no-bypass policy.
  await installPiCommandPolicy();
  if (!supportsPiRuntime()) {
    options.sendLog(`Pi delegation requires Node 22.19+; current runtime is Node ${process.versions.node} at ${process.execPath}. Using the compatibility agent runtime.`);
    return undefined;
  }

  const [provider, ...modelParts] = options.model.split("/");
  const modelId = modelParts.join("/");
  if (!provider || !modelId) {
    options.sendLog("Pi delegation could not resolve the selected model; using the compatibility agent runtime.");
    return undefined;
  }

  const { AuthStorage, ModelRegistry, createAgentSession } = await importEsm("@earendil-works/pi-coding-agent");
  const { getModel } = await importEsm("@earendil-works/pi-ai");
  let modelRegistry: any;
  let selectedModel: any;
  if (options.customProvider) {
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(options.customProvider.id, options.customProvider.apiKey);
    modelRegistry = ModelRegistry.inMemory(authStorage);
    modelRegistry.registerProvider(options.customProvider.id, {
      name: options.customProvider.name,
      baseUrl: options.customProvider.baseUrl,
      apiKey: options.customProvider.apiKey,
      api: options.customProvider.apiType || "openai-completions",
      models: options.customProvider.models.map((model) => ({
        id: model.id.includes("/") ? model.id.split("/").slice(1).join("/") : model.id,
        name: model.name,
        api: options.customProvider!.apiType || "openai-completions",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 16_384
      }))
    });
    selectedModel = modelRegistry.find(provider, modelId);
  } else {
    selectedModel = getModel(provider as any, modelId);
  }
  if (!selectedModel) {
    options.sendLog(`Pi could not resolve ${options.model}; using the compatibility agent runtime.`);
    return undefined;
  }

  const history = options.conversationHistory
    .slice(-12)
    .map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`)
    .join("\n\n");
  const resourceLoader = await getPiResourceLoader(options.workspaceRoot, [
    options.systemPrompt,
    history ? `Previous Agent Tab conversation:\n${history}` : ""
  ].filter(Boolean));

  if (!resourceLoader) {
    options.sendLog("Pi extensions could not be loaded; using the compatibility agent runtime.");
    return undefined;
  }

  // Pi Subagents defaults to unlimited turns. Bound delegated investigations so
  // a slow provider or an overly broad prompt cannot spend tokens indefinitely.
  const { setDefaultMaxTurns, setGraceTurns } = await importEsm<any>("@tintinweb/pi-subagents/dist/agent-runner.js");
  setDefaultMaxTurns(DEFAULT_SUBAGENT_MAX_TURNS);
  setGraceTurns(DEFAULT_SUBAGENT_GRACE_TURNS);
  options.sendLog(`Subagent budget: ${DEFAULT_SUBAGENT_MAX_TURNS} turns maximum (${DEFAULT_SUBAGENT_GRACE_TURNS} final wrap-up turn).`);

  const loadedExtensions = resourceLoader.getExtensions().extensions;
  const hasWebAccessExtension = loadedExtensions.some((extension: any) =>
    typeof extension.path === "string" && extension.path.includes("pi-web-access")
  );
  const hasSubagentsExtension = loadedExtensions.some((extension: any) =>
    typeof extension.path === "string" && extension.path.includes("pi-subagents")
  );
  if (!hasWebAccessExtension) {
    options.sendLog("Pi web extension is unavailable with this Pi version; using Agent Tab's compatible web-search tool.");
  }
  if (!hasSubagentsExtension) {
    options.sendLog("Pi subagent extension did not load; using the compatibility agent runtime.");
    return undefined;
  }

  // Avoid duplicate registration only when Pi's native web extension loaded.
  const customTools = hasWebAccessExtension
    ? options.tools.filter((tool) => tool.name !== "web_search")
    : options.tools;
  const piCustomTools = customTools.map(toPiSdkTool);
  const toolNames = Array.from(new Set([
    ...customTools.map((tool) => tool.name),
    "web_search",
    "fetch_content",
    "get_search_content",
    "Agent",
    "get_subagent_result",
    "steer_subagent"
  ]));

  options.sendLog("Starting Pi agent session with web access and subagent delegation.");
  const { session } = await createAgentSession({
    cwd: options.workspaceRoot,
    model: selectedModel,
    modelRegistry,
    tools: toolNames,
    customTools: piCustomTools as any,
    resourceLoader
  });

  let latestText = "";
  let syntheticSubagentCounter = 0;
  const pendingSubagentIds = new Map<string, string>();
  const subagentDescriptions = new Map<string, string>();
  const lastActivityLog = new Map<string, string>();
  const transcriptWatchers = new Map<string, NodeJS.Timeout>();
  const transcriptLineCounts = new Map<string, number>();
  const transcriptHeartbeatAt = new Map<string, number>();
  const transcriptHeartbeatLogAt = new Map<string, number>();
  let activeSubagentToolCalls = 0;
  let hasSubagentResultForAggregation = false;
  let aggregationStarted = false;
  let aggregationWritingLogged = false;
  let keepSessionForBackgroundAgents = false;
  let disposed = false;
  const aggregationId = "main-agent-aggregation";

  const rememberDescription = (id: string, description: string | undefined) => {
    if (description) subagentDescriptions.set(id, description);
  };

  const descriptionFor = (id: string, fallback: string) => subagentDescriptions.get(id) || fallback;
  const logSubagentActivity = (id: string, message: string) => {
    // Keep verbose subagent traces in the sidecar terminal; the frontend gets
    // them through subagent_update so the main activity panel stays concise.
    console.log(`[Subagent ${id.slice(0, 8)}] ${message}`);
  };

  const appendActivityLog = (id: string, activity: string | undefined): string | undefined => {
    if (!activity) return undefined;
    const last = lastActivityLog.get(id);
    if (last === activity) return undefined;
    lastActivityLog.set(id, activity);
    return activity.startsWith("Agent ") || activity.endsWith(".") ? activity : `Activity: ${activity}`;
  };

  const sendAggregationUpdate = (
    status: SubagentUpdate["status"],
    activity: string,
    appendLog?: string
  ) => {
    options.sendSubagentUpdate({
      id: aggregationId,
      displayName: "Aggregation",
      description: "Main agent synthesis",
      subagentType: "Main agent",
      isAggregation: true,
      status,
      activity,
      appendLog,
      updatedAt: new Date().toISOString()
    });
  };

  const maybeStartAggregation = (reason: string) => {
    if (!hasSubagentResultForAggregation || activeSubagentToolCalls > 0 || aggregationStarted) return;
    aggregationStarted = true;
    aggregationWritingLogged = false;
    sendAggregationUpdate(
      "running",
      "Synthesizing subagent results.",
      reason
    );
    options.sendLog("Aggregating subagent results.");
  };

  const stopTranscriptWatcher = (id: string) => {
    const timer = transcriptWatchers.get(id);
    if (timer) clearInterval(timer);
    transcriptWatchers.delete(id);
    transcriptLineCounts.delete(id);
    transcriptHeartbeatAt.delete(id);
    transcriptHeartbeatLogAt.delete(id);
  };

  const disposeRun = async (reason?: string) => {
    if (disposed) return;
    disposed = true;
    if (reason) {
      options.sendLog(reason);
      for (const id of transcriptWatchers.keys()) {
        options.sendSubagentUpdate({
          id,
          description: descriptionFor(id, `Agent ${id}`),
          status: "stopped",
          activity: "Stopped by user.",
          appendLog: "Stop requested; cancelling subagent.",
          updatedAt: new Date().toISOString()
        });
      }
    }
    for (const id of transcriptWatchers.keys()) stopTranscriptWatcher(id);
    await session.abort().catch(() => {});
    session.dispose();
    activePiRuns.delete(options.tabId);
  };

  const backgroundAgents = new Set<string>();
  const dispatchedBackgroundAgentIds = new Set<string>();
  activePiRuns.set(options.tabId, {
    stop: async (reason) => disposeRun(reason),
    backgroundAgents,
  });

  const startTranscriptWatcher = (id: string, outputFile: string | undefined) => {
    if (!outputFile || transcriptWatchers.has(id)) return;
    const poll = async () => {
      try {
        const raw = await fs.readFile(outputFile, "utf-8");
        const lines = raw.split("\n").filter((line) => line.trim().length > 0);
        const seen = transcriptLineCounts.get(id) ?? 0;
        const record = getLiveSubagentRecord(id);
        const terminal = record && record.status !== "running" && record.status !== "queued";
        if (lines.length <= seen) {
          if (terminal) {
            const status = normalizeSubagentStatus(record.status, record.status === "error");
            backgroundAgents.delete(id);
            logSubagentActivity(id, `${status}.`);
            options.sendSubagentUpdate({
              id,
              description: descriptionFor(id, `Agent ${id}`),
              status,
              activity: status === "completed" ? "Completed." : `Finished with status: ${status}.`,
              result: record.result,
              error: record.error,
              toolUses: record.toolUses,
              durationMs: record.completedAt ? record.completedAt - record.startedAt : undefined,
              appendLog: status === "completed" ? "Subagent completed." : `Subagent ${status}.`,
              updatedAt: new Date().toISOString()
            });
            stopTranscriptWatcher(id);
            return;
          }
          const now = Date.now();
          const lastHeartbeat = transcriptHeartbeatAt.get(id) ?? 0;
          if (now - lastHeartbeat >= 3000 && transcriptWatchers.has(id)) {
            transcriptHeartbeatAt.set(id, now);
            const lastLog = transcriptHeartbeatLogAt.get(id) ?? 0;
            if (now - lastLog >= 10_000) {
              transcriptHeartbeatLogAt.set(id, now);
              logSubagentActivity(id, "Still active; awaiting the next completed step.");
            }
            options.sendSubagentUpdate({
              id,
              description: descriptionFor(id, `Agent ${id}`),
              status: "background",
              activity: "Working on delegated task — awaiting the next completed step.",
              updatedAt: new Date(now).toISOString()
            });
          }
          return;
        }

        const logs = lines
          .slice(seen)
          .map((line) => {
            try {
              return summarizeTranscriptEntry(JSON.parse(line));
            } catch {
              return undefined;
            }
          })
          .filter((line): line is string => Boolean(line));

        transcriptLineCounts.set(id, lines.length);
        if (logs.length === 0) return;
        if (!transcriptWatchers.has(id)) return;

        const latestActivity = logs[logs.length - 1];
        transcriptHeartbeatAt.set(id, Date.now());
        for (const log of logs) {
          logSubagentActivity(id, log.replace(/\n/g, " · "));
        }
        options.sendSubagentUpdate({
          id,
          description: descriptionFor(id, `Agent ${id}`),
          status: "background",
          activity: latestActivity || "Working on delegated task.",
          appendLog: appendActivityLog(id, latestActivity),
          logs,
          outputFile,
          updatedAt: new Date().toISOString()
        });
        if (terminal) {
          const status = normalizeSubagentStatus(record.status, record.status === "error");
          backgroundAgents.delete(id);
          logSubagentActivity(id, `${status}.`);
          options.sendSubagentUpdate({
            id,
            description: descriptionFor(id, `Agent ${id}`),
            status,
            activity: status === "completed" ? "Completed." : `Finished with status: ${status}.`,
            result: record.result,
            error: record.error,
            toolUses: record.toolUses,
            durationMs: record.completedAt ? record.completedAt - record.startedAt : undefined,
            appendLog: status === "completed" ? "Subagent completed." : `Subagent ${status}.`,
            updatedAt: new Date().toISOString()
          });
          stopTranscriptWatcher(id);
        }
      } catch {
        // The transcript appears asynchronously; ignore read misses.
      }
    };

    transcriptWatchers.set(id, setInterval(poll, 750));
    void poll();
  };

  const unsubscribe = session.subscribe((event: any) => {
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      latestText += event.assistantMessageEvent.delta;
      options.sendToken(event.assistantMessageEvent.delta);
      if (aggregationStarted && !aggregationWritingLogged) {
        aggregationWritingLogged = true;
        sendAggregationUpdate("running", "Writing the final synthesized response.", "Writing final response from aggregated results.");
      }
    }
    if (event.type === "tool_execution_start") {
      if (event.toolName === "Agent") {
        activeSubagentToolCalls++;
        const key = toolEventKey(event) || `agent_start_${++syntheticSubagentCounter}`;
        const id = `pending-${key}`;
        pendingSubagentIds.set(key, id);
        const description = subagentDescription(event.args);
        const subagentType = event.args?.subagent_type;
        rememberDescription(id, description);
        options.sendSubagentUpdate({
          id,
          displayName: subagentType || "Agent",
          description,
          subagentType,
          status: event.args?.run_in_background ? "background" : "running",
          activity: "Delegated; waiting for result.",
          appendLog: `Delegated ${subagentType || "Agent"} subagent.`,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      } else if (event.toolName === "get_subagent_result" && event.args?.agent_id) {
        activeSubagentToolCalls++;
        options.sendSubagentUpdate({
          id: event.args.agent_id,
          description: descriptionFor(event.args.agent_id, `Agent ${event.args.agent_id}`),
          status: "running",
          activity: event.args?.wait ? "Waiting for background result." : "Fetching background result.",
          appendLog: event.args?.wait ? "Waiting for background result." : "Fetching background result.",
          updatedAt: new Date().toISOString()
        });
      }

      const label = event.toolName === "Agent"
        ? `Delegating subagent${typeof event.args?.description === "string" ? `: ${event.args.description}` : ""}.`
        : `Running ${event.toolName}.`;
      options.sendLog(label);
    }
    if (event.type === "tool_execution_update" && event.toolName === "Agent") {
      const key = toolEventKey(event);
      const pendingId = key ? pendingSubagentIds.get(key) : undefined;
      const details = event.partialResult?.details || {};
      const id = details.agentId || pendingId || `agent-${++syntheticSubagentCounter}`;
      const description = details.description || (pendingId ? descriptionFor(pendingId, subagentDescription(event.args)) : subagentDescription(event.args));
      rememberDescription(id, description);
      if (pendingId) rememberDescription(pendingId, description);

      const activity = details.activity || textFromToolResult(event.partialResult);
      options.sendSubagentUpdate({
        id,
        previousId: details.agentId && pendingId && details.agentId !== pendingId ? pendingId : undefined,
        agentId: details.agentId,
        displayName: details.displayName,
        description,
        subagentType: details.subagentType || event.args?.subagent_type,
        status: normalizeSubagentStatus(details.status || "running", false),
        activity,
        appendLog: appendActivityLog(id, activity),
        toolUses: details.toolUses,
        tokens: details.tokens,
        turnCount: details.turnCount,
        maxTurns: details.maxTurns,
        durationMs: details.durationMs,
        updatedAt: new Date().toISOString()
      });
    }
    if (event.type === "tool_execution_end") {
      if (event.toolName === "Agent") {
        activeSubagentToolCalls = Math.max(0, activeSubagentToolCalls - 1);
        const key = toolEventKey(event);
        const pendingId = key ? pendingSubagentIds.get(key) : undefined;
        if (key) pendingSubagentIds.delete(key);
        const details = event.result?.details || {};
        const resultText = textFromToolResult(event.result);
        const id = details.agentId || pendingId || `agent-${++syntheticSubagentCounter}`;
        const status = normalizeSubagentStatus(details.status, event.isError);
        const description = details.description || subagentDescription(event.args);
        const outputFile = outputFileFromText(resultText);
        rememberDescription(id, description);
        options.sendSubagentUpdate({
          id,
          previousId: details.agentId && pendingId ? pendingId : undefined,
          agentId: details.agentId,
          displayName: details.displayName,
          description,
          subagentType: details.subagentType || event.args?.subagent_type,
          status,
          activity: details.activity,
          result: resultText,
          error: details.error || (event.isError ? resultText : undefined),
          outputFile,
          toolUses: details.toolUses,
          tokens: details.tokens,
          turnCount: details.turnCount,
          maxTurns: details.maxTurns,
          durationMs: details.durationMs,
          appendLog: event.isError
            ? `Subagent failed${details.error ? `: ${details.error}` : "."}`
            : status === "background"
              ? "Background subagent started."
              : `Subagent completed${details.toolUses ? ` after ${details.toolUses} tool use${details.toolUses === 1 ? "" : "s"}` : ""}.`,
          updatedAt: new Date().toISOString()
        });
        if (status === "background") {
          keepSessionForBackgroundAgents = true;
          backgroundAgents.add(id);
          dispatchedBackgroundAgentIds.add(id);
          startTranscriptWatcher(id, outputFile);
        } else {
          stopTranscriptWatcher(id);
        }
        if (status !== "background" && status !== "queued" && status !== "running") {
          hasSubagentResultForAggregation = true;
          maybeStartAggregation(`Subagent result incorporated: ${description}`);
        }
      } else if (event.toolName === "get_subagent_result" && event.args?.agent_id) {
        activeSubagentToolCalls = Math.max(0, activeSubagentToolCalls - 1);
        const details = event.result?.details || {};
        const resultText = textFromToolResult(event.result);
        const status = normalizeSubagentStatus(details.status, event.isError);
        const description = details.description || descriptionFor(event.args.agent_id, `Agent ${event.args.agent_id}`);
        const outputFile = outputFileFromText(resultText);
        rememberDescription(event.args.agent_id, description);
        options.sendSubagentUpdate({
          id: event.args.agent_id,
          agentId: event.args.agent_id,
          displayName: details.displayName,
          description,
          subagentType: details.subagentType,
          status,
          activity: details.activity,
          result: resultText,
          error: details.error || (event.isError ? resultText : undefined),
          outputFile,
          toolUses: details.toolUses,
          tokens: details.tokens,
          turnCount: details.turnCount,
          maxTurns: details.maxTurns,
          durationMs: details.durationMs,
          appendLog: event.isError
            ? "Failed to retrieve subagent result."
            : status === "running" || status === "background" || status === "queued"
              ? "Subagent result checked; still running."
              : "Subagent result retrieved.",
          updatedAt: new Date().toISOString()
        });
        if (status !== "background" && status !== "queued" && status !== "running") {
          backgroundAgents.delete(event.args.agent_id);
          stopTranscriptWatcher(event.args.agent_id);
          hasSubagentResultForAggregation = true;
          maybeStartAggregation(`Subagent result incorporated: ${description}`);
        }
      }
      if (event.isError) {
        const details = textFromToolResult(event.result);
        options.sendLog(`${event.toolName} failed${details ? `: ${details.slice(0, 500)}` : "."}`);
      } else {
        options.sendLog(`${event.toolName} completed.`);
      }
    }
  });

  try {
    await session.prompt(options.message);
    if (backgroundAgents.size > 0) {
      options.sendLog(`Waiting for ${backgroundAgents.size} delegated subagent${backgroundAgents.size === 1 ? "" : "s"} before aggregation.`);
      while (backgroundAgents.size > 0 && !disposed) {
        const pending = [...backgroundAgents]
          .map((id) => getLiveSubagentRecord(id)?.promise)
          .filter((promise): promise is Promise<unknown> => Boolean(promise));
        if (pending.length > 0) {
          await Promise.race(pending);
        } else {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        for (const id of [...backgroundAgents]) {
          const record = getLiveSubagentRecord(id);
          if (record && record.status !== "running" && record.status !== "queued") {
            backgroundAgents.delete(id);
          }
        }
      }
      if (!disposed) {
        const agentIds = [...dispatchedBackgroundAgentIds].join(", ");
        await session.prompt(
          `All delegated subagents have finished. Retrieve the results for these agent IDs using get_subagent_result, then synthesize them into one response: ${agentIds}. Do not ask the user any refining question until that synthesis is complete.`
        );
      }
    }
    const deferredQuestion = options.consumeDeferredQuestion?.();
    if (deferredQuestion && !disposed && options.requestUserQuestion) {
      options.sendLog("Delegated work is complete; presenting the deferred question to the user.");
      const answer = await options.requestUserQuestion(deferredQuestion);
      await session.prompt(
        `The user answered the deferred question "${deferredQuestion.question}" with: "${answer}". Incorporate this answer into the final recommendation, then respond concisely.`
      );
    }
    if (aggregationStarted) {
      sendAggregationUpdate("completed", "Final synthesized response is ready.", "Aggregation complete.");
    }
    const lastAssistant = [...session.messages].reverse().find((entry: any) => entry?.role === "assistant");
    return textFromAssistantMessage(lastAssistant) || latestText || "Agent complete.";
  } finally {
    unsubscribe();
    if (keepSessionForBackgroundAgents && backgroundAgents.size > 0 && !disposed) {
      options.sendLog("Main agent is standing by while background subagents continue. Stop remains available.");
    } else {
      await disposeRun();
    }
  }
}
