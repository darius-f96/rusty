/**
 * Token usage persistence. Records every completed LLM call into
 * `.rusty/metrics/` so the frontend can show per-model, per-day, and
 * all-time token consumption. Writes are serialized per workspace root
 * with an in-process queue since the sidecar is a single long-lived
 * process handling every capability for a given workspace.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export interface TokenUsageSample {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
  totalTokens: number;
}

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  calls: number;
}

export interface UsageDaySummary {
  byModel: Record<string, UsageTotals>;
  total: UsageTotals;
}

export interface UsageSummary {
  byDay: Record<string, UsageDaySummary>;
  allTime: { byModel: Record<string, UsageTotals>; total: UsageTotals };
}

export interface UsageRecordInput {
  surface: string;
  runId?: string;
  tabId?: string;
  provider?: string;
  model: string;
  usage: TokenUsageSample;
}

function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, calls: 0 };
}

function emptySummary(): UsageSummary {
  return { byDay: {}, allTime: { byModel: {}, total: emptyTotals() } };
}

function addInto(target: UsageTotals, sample: TokenUsageSample): void {
  target.input += sample.input || 0;
  target.output += sample.output || 0;
  target.cacheRead += sample.cacheRead || 0;
  target.cacheWrite += sample.cacheWrite || 0;
  target.totalTokens += sample.totalTokens || (sample.input || 0) + (sample.output || 0);
  target.calls += 1;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class UsageTracker {
  private readonly eventsDir: string;
  private readonly summaryPath: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(workspaceRoot: string) {
    const metricsRoot = path.join(workspaceRoot, ".rusty", "metrics");
    this.eventsDir = path.join(metricsRoot, "events");
    this.summaryPath = path.join(metricsRoot, "summary.json");
  }

  /** Appends the raw event and updates the rolled-up summary, serialized behind one queue. */
  record(entry: UsageRecordInput): Promise<void> {
    const queued = this.queue.then(() => this.writeEntry(entry));
    this.queue = queued.catch(() => undefined);
    return queued;
  }

  async readSummary(): Promise<UsageSummary> {
    try {
      const raw = await fs.readFile(this.summaryPath, "utf8");
      return JSON.parse(raw) as UsageSummary;
    } catch (error: any) {
      if (error?.code === "ENOENT") return emptySummary();
      throw error;
    }
  }

  private async writeEntry(entry: UsageRecordInput): Promise<void> {
    const now = new Date();
    const date = dayKey(now);
    const line = {
      ts: now.toISOString(),
      surface: entry.surface,
      runId: entry.runId,
      tabId: entry.tabId,
      provider: entry.provider,
      model: entry.model,
      ...entry.usage,
    };
    await fs.mkdir(this.eventsDir, { recursive: true });
    await fs.appendFile(
      path.join(this.eventsDir, `usage-${date}.jsonl`),
      `${JSON.stringify(line)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );

    let summary: UsageSummary;
    try {
      summary = await this.readSummary();
    } catch {
      summary = emptySummary();
    }
    const day = summary.byDay[date] || (summary.byDay[date] = { byModel: {}, total: emptyTotals() });
    const dayModel = day.byModel[entry.model] || (day.byModel[entry.model] = emptyTotals());
    addInto(dayModel, entry.usage);
    addInto(day.total, entry.usage);
    const allTimeModel = summary.allTime.byModel[entry.model] || (summary.allTime.byModel[entry.model] = emptyTotals());
    addInto(allTimeModel, entry.usage);
    addInto(summary.allTime.total, entry.usage);

    await fs.writeFile(this.summaryPath, JSON.stringify(summary, null, 2), { encoding: "utf8", mode: 0o600 });
  }
}

const trackers = new Map<string, UsageTracker>();

/** Returns the shared tracker instance for a workspace so writes to summary.json are serialized. */
export function getUsageTracker(workspaceRoot: string): UsageTracker {
  let tracker = trackers.get(workspaceRoot);
  if (!tracker) {
    tracker = new UsageTracker(workspaceRoot);
    trackers.set(workspaceRoot, tracker);
  }
  return tracker;
}
