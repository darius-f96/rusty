export interface MetricSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  durations: Record<string, { count: number; totalMs: number; maxMs: number; averageMs: number }>;
}

export class HarnessTelemetry {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly durations = new Map<string, { count: number; totalMs: number; maxMs: number }>();

  increment(name: string, amount = 1): void {
    this.counters.set(name, (this.counters.get(name) || 0) + amount);
  }

  gauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  duration(name: string, elapsedMs: number): void {
    const current = this.durations.get(name) || { count: 0, totalMs: 0, maxMs: 0 };
    current.count++;
    current.totalMs += elapsedMs;
    current.maxMs = Math.max(current.maxMs, elapsedMs);
    this.durations.set(name, current);
  }

  snapshot(): MetricSnapshot {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      durations: Object.fromEntries([...this.durations].map(([name, value]) => [name, {
        ...value,
        averageMs: value.count ? value.totalMs / value.count : 0,
      }])),
    };
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.durations.clear();
  }
}

export const harnessTelemetry = new HarnessTelemetry();
