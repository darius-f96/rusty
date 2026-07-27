import { randomUUID } from "node:crypto";

export interface DelegatedTask {
  objective: string;
  scope: string[];
  excludedScope?: string[];
  expectedOutput: "findings" | "review" | "recommendation";
  evidenceRequired: boolean;
  /** Undefined means unbounded — the subagent runs until it finishes or hits timeoutMs. */
  maxTurns?: number;
  timeoutMs: number;
  benefit: "coverage" | "parallelism" | "independent_review" | "specialization";
}

export interface DelegationEvidence {
  path: string;
  line?: number;
  summary: string;
}

export interface DelegationResult {
  agentId: string;
  status: "completed" | "failed" | "cancelled" | "timed_out";
  findings: string;
  evidence: DelegationEvidence[];
  metadata: {
    turnsUsed: number;
    tokensUsed?: number;
    toolsCalled: string[];
    startedAt: string;
    completedAt: string;
  };
  error?: string;
}

export interface AgentHandle {
  agentId: string;
  runId: string;
  parentAgentId: string;
  task: DelegatedTask;
  status: "queued" | "running" | DelegationResult["status"];
  queuePosition?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  resultConsumed: boolean;
}

export interface DelegationExecutionContext {
  agentId: string;
  signal: AbortSignal;
  reportTool: (name: string) => void;
}

export interface DelegationAdapter {
  execute(task: DelegatedTask, context: DelegationExecutionContext): Promise<{
    findings: string;
    evidence?: DelegationEvidence[];
    turnsUsed?: number;
    tokensUsed?: number;
    toolsCalled?: string[];
  }>;
  send?(agentId: string, message: string): Promise<void>;
  steer?(agentId: string, instruction: string): Promise<void>;
  cancel?(agentId: string, reason?: string): Promise<void>;
}

export type DelegationEvent = {
  type: "delegation.queued" | "delegation.started" | "delegation.completed" | "delegation.failed" | "delegation.cancelled" | "delegation.timed_out" | "delegation.incorporated";
  handle: AgentHandle;
  result?: DelegationResult;
};

interface InternalRecord {
  handle: AgentHandle;
  adapter: DelegationAdapter;
  controller: AbortController;
  promise: Promise<DelegationResult>;
  resolve: (result: DelegationResult) => void;
  settled: boolean;
  timeout?: NodeJS.Timeout;
  toolsCalled: Set<string>;
}

export class DelegationManager {
  private readonly records = new Map<string, InternalRecord>();
  private readonly queue: string[] = [];
  private activeCount = 0;

  constructor(
    private readonly maxConcurrency = 3,
    private readonly onEvent: (event: DelegationEvent) => void = () => undefined,
  ) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) throw new Error("Delegation concurrency must be at least one.");
  }

  async spawn(runId: string, parentAgentId: string, task: DelegatedTask, adapter: DelegationAdapter): Promise<AgentHandle> {
    this.validateTask(task);
    const agentId = randomUUID();
    let resolveResult!: (result: DelegationResult) => void;
    const promise = new Promise<DelegationResult>((resolve) => { resolveResult = resolve; });
    const handle: AgentHandle = {
      agentId,
      runId,
      parentAgentId,
      task: { ...task, scope: [...task.scope], excludedScope: task.excludedScope ? [...task.excludedScope] : undefined },
      status: "queued",
      queuePosition: this.queue.length + 1,
      createdAt: new Date().toISOString(),
      resultConsumed: false,
    };
    this.records.set(agentId, {
      handle,
      adapter,
      controller: new AbortController(),
      promise,
      resolve: resolveResult,
      settled: false,
      toolsCalled: new Set(),
    });
    this.queue.push(agentId);
    this.emit("delegation.queued", handle);
    this.schedule();
    return this.cloneHandle(handle);
  }

  async send(agentId: string, message: string): Promise<void> {
    const record = this.required(agentId);
    if (!record.adapter.send) throw new Error("DELEGATION_OPERATION_UNSUPPORTED: send");
    await record.adapter.send(agentId, message);
  }

  async steer(agentId: string, instruction: string): Promise<void> {
    const record = this.required(agentId);
    if (!record.adapter.steer) throw new Error("DELEGATION_OPERATION_UNSUPPORTED: steer");
    await record.adapter.steer(agentId, instruction);
  }

  async join(agentId: string): Promise<DelegationResult> {
    const record = this.required(agentId);
    const result = await record.promise;
    if (!record.handle.resultConsumed) {
      record.handle.resultConsumed = true;
      this.emit("delegation.incorporated", record.handle, result);
    }
    return { ...result, evidence: result.evidence.map((item) => ({ ...item })), metadata: { ...result.metadata, toolsCalled: [...result.metadata.toolsCalled] } };
  }

  async cancel(agentId: string, reason = "Delegation cancelled."): Promise<void> {
    const record = this.required(agentId);
    if (record.settled) return;
    const queuedIndex = this.queue.indexOf(agentId);
    if (queuedIndex >= 0) this.queue.splice(queuedIndex, 1);
    record.controller.abort(reason);
    await record.adapter.cancel?.(agentId, reason).catch(() => undefined);
    this.settle(record, "cancelled", "", reason);
    this.refreshQueuePositions();
    this.schedule();
  }

  async cancelRun(runId: string, reason?: string): Promise<void> {
    await Promise.all(this.list(runId)
      .filter((handle) => handle.status === "queued" || handle.status === "running")
      .map((handle) => this.cancel(handle.agentId, reason)));
  }

  list(runId: string): AgentHandle[] {
    return [...this.records.values()]
      .filter((record) => record.handle.runId === runId)
      .map((record) => this.cloneHandle(record.handle));
  }

  private schedule(): void {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const agentId = this.queue.shift()!;
      const record = this.records.get(agentId);
      if (!record || record.settled) continue;
      this.activeCount++;
      record.handle.status = "running";
      record.handle.queuePosition = undefined;
      record.handle.startedAt = new Date().toISOString();
      this.emit("delegation.started", record.handle);
      record.timeout = setTimeout(() => {
        if (record.settled) return;
        record.controller.abort("Delegation timed out.");
        void record.adapter.cancel?.(agentId, "Delegation timed out.").catch(() => undefined);
        this.settle(record, "timed_out", "", "Delegation timed out.");
      }, record.handle.task.timeoutMs);
      void record.adapter.execute(record.handle.task, {
        agentId,
        signal: record.controller.signal,
        reportTool: (name) => record.toolsCalled.add(name),
      }).then((output) => {
        if (record.settled) return;
        this.settle(record, "completed", output.findings, undefined, {
          evidence: output.evidence,
          turnsUsed: output.turnsUsed,
          tokensUsed: output.tokensUsed,
          toolsCalled: output.toolsCalled,
        });
      }).catch((error) => {
        if (record.settled) return;
        const aborted = record.controller.signal.aborted;
        this.settle(record, aborted ? "cancelled" : "failed", "", error instanceof Error ? error.message : String(error));
      });
    }
    this.refreshQueuePositions();
  }

  private settle(
    record: InternalRecord,
    status: DelegationResult["status"],
    findings: string,
    error?: string,
    output: { evidence?: DelegationEvidence[]; turnsUsed?: number; tokensUsed?: number; toolsCalled?: string[] } = {},
  ): void {
    if (record.settled) return;
    record.settled = true;
    if (record.timeout) clearTimeout(record.timeout);
    if (record.handle.status === "running") this.activeCount--;
    const completedAt = new Date().toISOString();
    record.handle.status = status;
    record.handle.completedAt = completedAt;
    // Non-completion outcomes previously only reached the UI via subagent_update
    // — invisible from the sidecar terminal, which made a real timeout look
    // indistinguishable from "no error occurred" when reading server logs.
    if (status !== "completed") {
      const startedAt = record.handle.startedAt ? Date.parse(record.handle.startedAt) : NaN;
      const elapsedMs = Number.isFinite(startedAt) ? Date.now() - startedAt : undefined;
      console.warn(
        `[DelegationManager] agent ${record.handle.agentId} (${record.handle.task.objective}) settled as "${status}"` +
        (elapsedMs !== undefined ? ` after ${Math.round(elapsedMs / 1000)}s` : "") +
        ` (configured timeoutMs=${record.handle.task.timeoutMs}): ${error || "no error message"}`,
      );
    }
    const result: DelegationResult = {
      agentId: record.handle.agentId,
      status,
      findings,
      evidence: output.evidence || [],
      metadata: {
        turnsUsed: output.turnsUsed || 0,
        tokensUsed: output.tokensUsed,
        toolsCalled: [...new Set([...(output.toolsCalled || []), ...record.toolsCalled])],
        startedAt: record.handle.startedAt || record.handle.createdAt,
        completedAt,
      },
      error,
    };
    const eventType = status === "completed"
      ? "delegation.completed"
      : status === "cancelled"
        ? "delegation.cancelled"
        : status === "timed_out"
          ? "delegation.timed_out"
          : "delegation.failed";
    this.emit(eventType, record.handle, result);
    record.resolve(result);
    this.schedule();
  }

  private validateTask(task: DelegatedTask): void {
    if (!task.objective.trim()) throw new Error("Delegated task objective is required.");
    if (!Array.isArray(task.scope) || task.scope.length === 0) throw new Error("Delegated task scope is required.");
    if (task.maxTurns !== undefined && (!Number.isInteger(task.maxTurns) || task.maxTurns < 1)) {
      throw new Error("Delegated task maxTurns must be positive when set.");
    }
    if (!Number.isFinite(task.timeoutMs) || task.timeoutMs < 1) throw new Error("Delegated task timeoutMs must be positive.");
  }

  private required(agentId: string): InternalRecord {
    const record = this.records.get(agentId);
    if (!record) throw new Error(`Unknown delegated agent: ${agentId}`);
    return record;
  }

  private refreshQueuePositions(): void {
    this.queue.forEach((agentId, index) => {
      const record = this.records.get(agentId);
      if (record) record.handle.queuePosition = index + 1;
    });
  }

  private cloneHandle(handle: AgentHandle): AgentHandle {
    return { ...handle, task: { ...handle.task, scope: [...handle.task.scope], excludedScope: handle.task.excludedScope ? [...handle.task.excludedScope] : undefined } };
  }

  private emit(type: DelegationEvent["type"], handle: AgentHandle, result?: DelegationResult): void {
    this.onEvent({ type, handle: this.cloneHandle(handle), result });
  }
}
