import { randomUUID } from "node:crypto";
import { validateDelegatedTask } from "./delegationValidation";

export interface DelegatedTask {
  objective: string;
  scope: string[];
  excludedScope?: string[];
  expectedOutput: "findings" | "review" | "recommendation";
  evidenceRequired: boolean;
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
  reportTool(name: string): void;
}

export interface DelegationAdapter {
  execute(
    task: DelegatedTask,
    context: DelegationExecutionContext,
  ): Promise<{
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
  type:
    | "delegation.queued"
    | "delegation.started"
    | "delegation.completed"
    | "delegation.failed"
    | "delegation.cancelled"
    | "delegation.timed_out"
    | "delegation.incorporated";
  handle: AgentHandle;
  result?: DelegationResult;
};

type ExecutionOutput = Awaited<ReturnType<DelegationAdapter["execute"]>>;

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
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new Error("Delegation concurrency must be at least one.");
    }
  }

  async spawn(
    runId: string,
    parentAgentId: string,
    task: DelegatedTask,
    adapter: DelegationAdapter,
  ): Promise<AgentHandle> {
    validateDelegatedTask(task);

    const agentId = randomUUID();
    const record = this.createRecord(agentId, runId, parentAgentId, task, adapter);

    this.records.set(agentId, record);
    this.queue.push(agentId);
    this.emit("delegation.queued", record.handle);
    this.schedule();

    return this.cloneHandle(record.handle);
  }

  async send(agentId: string, message: string): Promise<void> {
    const record = this.required(agentId);
    if (!record.adapter.send) {
      throw new Error("DELEGATION_OPERATION_UNSUPPORTED: send");
    }
    await record.adapter.send(agentId, message);
  }

  async steer(agentId: string, instruction: string): Promise<void> {
    const record = this.required(agentId);
    if (!record.adapter.steer) {
      throw new Error("DELEGATION_OPERATION_UNSUPPORTED: steer");
    }
    await record.adapter.steer(agentId, instruction);
  }

  async join(agentId: string): Promise<DelegationResult> {
    const record = this.required(agentId);
    const result = await record.promise;

    if (!record.handle.resultConsumed) {
      record.handle.resultConsumed = true;
      this.emit("delegation.incorporated", record.handle, result);
    }

    return this.cloneResult(result);
  }

  async cancel(agentId: string, reason = "Delegation cancelled."): Promise<void> {
    const record = this.required(agentId);
    if (record.settled) return;

    this.removeFromQueue(agentId);
    record.controller.abort(reason);
    await record.adapter.cancel?.(agentId, reason).catch(() => undefined);
    this.settle(record, "cancelled", "", reason);
  }

  async cancelRun(runId: string, reason?: string): Promise<void> {
    const activeHandles = this.list(runId).filter(
      (handle) => handle.status === "queued" || handle.status === "running",
    );
    await Promise.all(activeHandles.map((handle) => this.cancel(handle.agentId, reason)));
  }

  list(runId: string): AgentHandle[] {
    return [...this.records.values()]
      .filter((record) => record.handle.runId === runId)
      .map((record) => this.cloneHandle(record.handle));
  }

  private createRecord(
    agentId: string,
    runId: string,
    parentAgentId: string,
    task: DelegatedTask,
    adapter: DelegationAdapter,
  ): InternalRecord {
    let resolve!: (result: DelegationResult) => void;
    const promise = new Promise<DelegationResult>((resolveResult) => {
      resolve = resolveResult;
    });

    return {
      handle: {
        agentId,
        runId,
        parentAgentId,
        task: this.cloneTask(task),
        status: "queued",
        queuePosition: this.queue.length + 1,
        createdAt: new Date().toISOString(),
        resultConsumed: false,
      },
      adapter,
      controller: new AbortController(),
      promise,
      resolve,
      settled: false,
      toolsCalled: new Set(),
    };
  }

  private schedule(): void {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const agentId = this.queue.shift()!;
      const record = this.records.get(agentId);
      if (!record || record.settled) continue;

      this.start(record);
    }
    this.refreshQueuePositions();
  }

  private start(record: InternalRecord): void {
    this.activeCount++;
    record.handle.status = "running";
    record.handle.queuePosition = undefined;
    record.handle.startedAt = new Date().toISOString();
    this.emit("delegation.started", record.handle);

    record.timeout = setTimeout(
      () => this.handleTimeout(record),
      record.handle.task.timeoutMs,
    );

    void record.adapter
      .execute(record.handle.task, this.executionContext(record))
      .then((output) => this.handleSuccess(record, output))
      .catch((error) => this.handleFailure(record, error));
  }

  private executionContext(record: InternalRecord): DelegationExecutionContext {
    return {
      agentId: record.handle.agentId,
      signal: record.controller.signal,
      reportTool: (name) => record.toolsCalled.add(name),
    };
  }

  private handleTimeout(record: InternalRecord): void {
    if (record.settled) return;

    const reason = "Delegation timed out.";
    record.controller.abort(reason);
    void record.adapter.cancel?.(record.handle.agentId, reason).catch(() => undefined);
    this.settle(record, "timed_out", "", reason);
  }

  private handleSuccess(record: InternalRecord, output: ExecutionOutput): void {
    if (!record.settled) {
      this.settle(record, "completed", output.findings, undefined, output);
    }
  }

  private handleFailure(record: InternalRecord, error: unknown): void {
    if (record.settled) return;

    const status = record.controller.signal.aborted ? "cancelled" : "failed";
    const message = error instanceof Error ? error.message : String(error);
    this.settle(record, status, "", message);
  }

  private settle(
    record: InternalRecord,
    status: DelegationResult["status"],
    findings: string,
    error?: string,
    output?: ExecutionOutput,
  ): void {
    if (record.settled) return;

    record.settled = true;
    this.clearTimeout(record);
    this.releaseConcurrency(record);

    const completedAt = new Date().toISOString();
    record.handle.status = status;
    record.handle.completedAt = completedAt;

    const result = this.createResult(record, status, findings, completedAt, error, output);
    this.emit(this.eventTypeFor(status), record.handle, result);
    record.resolve(result);
    this.schedule();
  }

  private createResult(
    record: InternalRecord,
    status: DelegationResult["status"],
    findings: string,
    completedAt: string,
    error: string | undefined,
    output?: ExecutionOutput,
  ): DelegationResult {
    return {
      agentId: record.handle.agentId,
      status,
      findings,
      evidence: output?.evidence ?? [],
      metadata: {
        turnsUsed: output?.turnsUsed ?? 0,
        tokensUsed: output?.tokensUsed,
        toolsCalled: [...new Set([...(output?.toolsCalled ?? []), ...record.toolsCalled])],
        startedAt: record.handle.startedAt ?? record.handle.createdAt,
        completedAt,
      },
      error,
    };
  }

  private eventTypeFor(status: DelegationResult["status"]): DelegationEvent["type"] {
    if (status === "completed") return "delegation.completed";
    if (status === "cancelled") return "delegation.cancelled";
    if (status === "timed_out") return "delegation.timed_out";
    return "delegation.failed";
  }

  private clearTimeout(record: InternalRecord): void {
    if (record.timeout) clearTimeout(record.timeout);
  }

  private releaseConcurrency(record: InternalRecord): void {
    if (record.handle.status === "running") this.activeCount--;
  }

  private removeFromQueue(agentId: string): void {
    const index = this.queue.indexOf(agentId);
    if (index >= 0) this.queue.splice(index, 1);
    this.refreshQueuePositions();
  }

  private refreshQueuePositions(): void {
    this.queue.forEach((agentId, index) => {
      const record = this.records.get(agentId);
      if (record) record.handle.queuePosition = index + 1;
    });
  }

  private required(agentId: string): InternalRecord {
    const record = this.records.get(agentId);
    if (!record) throw new Error(`Unknown delegated agent: ${agentId}`);
    return record;
  }

  private cloneTask(task: DelegatedTask): DelegatedTask {
    return {
      ...task,
      scope: [...task.scope],
      excludedScope: task.excludedScope ? [...task.excludedScope] : undefined,
    };
  }

  private cloneHandle(handle: AgentHandle): AgentHandle {
    return { ...handle, task: this.cloneTask(handle.task) };
  }

  private cloneResult(result: DelegationResult): DelegationResult {
    return {
      ...result,
      evidence: result.evidence.map((item) => ({ ...item })),
      metadata: { ...result.metadata, toolsCalled: [...result.metadata.toolsCalled] },
    };
  }

  private emit(
    type: DelegationEvent["type"],
    handle: AgentHandle,
    result?: DelegationResult,
  ): void {
    this.onEvent({ type, handle: this.cloneHandle(handle), result });
  }
}
