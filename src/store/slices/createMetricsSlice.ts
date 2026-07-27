import { agentHarnessClient } from "../../services/agentHarnessClient";
import { usageMetricsService } from "../../services/usageMetricsService";
import type { WorkspaceSliceCreator } from "../sliceTypes";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
/** `usage_update` messages carry each run's cumulative total, not a delta — track the last
 * seen value per run so only the newly-added tokens are added to today's running total. */
const lastCumulativeByRun = new Map<string, number>();
let subscribedToUsageUpdates = false;

export const createMetricsSlice: WorkspaceSliceCreator = (set, get) => {
  if (!subscribedToUsageUpdates) {
    subscribedToUsageUpdates = true;
    agentHarnessClient.subscribeAll((event) => {
      if (event.type !== "usage_update") return;
      const usage = event.usage as { totalTokens?: number; input?: number; output?: number } | undefined;
      const total = usage?.totalTokens ?? (usage?.input || 0) + (usage?.output || 0);
      get().applyUsageUpdate(event.runId, total);
    });
  }

  return {
    metricsSummary: null,
    metricsTimeframe: { mode: "day", day: todayKey() },
    metricsLoading: false,
    metricsTodayTotal: 0,

    loadMetricsSummary: async () => {
      const { rootPath } = get();
      if (!rootPath) return;
      set({ metricsLoading: true });
      try {
        const summary = await usageMetricsService.loadSummary(rootPath);
        set({ metricsSummary: summary, metricsTodayTotal: usageMetricsService.todayTotal(summary) });
      } finally {
        set({ metricsLoading: false });
      }
    },

    setMetricsTimeframe: (timeframe) => set({ metricsTimeframe: timeframe }),

    /** Optimistically bumps today's running total on a live `usage_update` event, then debounces a full refresh. */
    applyUsageUpdate: (runKey, cumulativeTotal) => {
      const previous = lastCumulativeByRun.get(runKey) || 0;
      const delta = Math.max(0, cumulativeTotal - previous);
      lastCumulativeByRun.set(runKey, cumulativeTotal);
      if (delta > 0) set((state) => ({ metricsTodayTotal: state.metricsTodayTotal + delta }));
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void get().loadMetricsSummary(), 3_000);
    },
  };
};
