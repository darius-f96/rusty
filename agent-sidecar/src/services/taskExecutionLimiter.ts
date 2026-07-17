const DEFAULT_MAX_CONCURRENT_TASKS = 4;

type QueueEntry = {
  resolve: (release: () => void) => void;
};

const configuredLimit = Number(process.env.AXIOM_MAX_CONCURRENT_TASKS);
const maxConcurrentTasks = Number.isFinite(configuredLimit) && configuredLimit > 0
  ? Math.floor(configuredLimit)
  : DEFAULT_MAX_CONCURRENT_TASKS;

let activeTasks = 0;
const queue: QueueEntry[] = [];

function createRelease(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeTasks = Math.max(0, activeTasks - 1);
    const next = queue.shift();
    if (!next) return;
    activeTasks += 1;
    next.resolve(createRelease());
  };
}

export function taskExecutionWouldQueue(): boolean {
  return activeTasks >= maxConcurrentTasks;
}

export function getTaskExecutionLimit(): number {
  return maxConcurrentTasks;
}

export function acquireTaskExecutionSlot(): Promise<() => void> {
  if (activeTasks < maxConcurrentTasks) {
    activeTasks += 1;
    return Promise.resolve(createRelease());
  }
  return new Promise((resolve) => queue.push({ resolve }));
}
