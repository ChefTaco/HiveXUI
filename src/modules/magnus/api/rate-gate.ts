// The server allows each subject 20 /hermes/* and 30 /orchestra/* requests a minute. Every request
// to those prefixes waits here for a slot, so no page, however it polls, can reach the limit.
export const HERMES_POLL_MS = 60_000;
const WINDOW_MS = 60_000;
const BUDGETS: ReadonlyArray<readonly [prefix: string, limit: number]> = [
  ['/hermes/', 18],
  ['/orchestra/', 27],
];

export function createRateGate(now: () => number = Date.now, sleep = delay) {
  const used = new Map<string, number[]>();
  // One queue per prefix, so waiters take slots in order and each counts against the window.
  const queues = new Map<string, Promise<void>>();
  return async function pass(path: string, signal?: AbortSignal): Promise<void> {
    const budget = BUDGETS.find(([prefix]) => path.startsWith(prefix));
    if (!budget) return;
    const [prefix, limit] = budget;
    const turn = (queues.get(prefix) ?? Promise.resolve()).then(async () => {
      for (;;) {
        signal?.throwIfAborted();
        const recent = (used.get(prefix) ?? []).filter((at) => now() - at < WINDOW_MS);
        if (recent.length < limit) {
          recent.push(now());
          used.set(prefix, recent);
          return;
        }
        used.set(prefix, recent);
        await sleep(WINDOW_MS - (now() - recent[0]!) + 1, signal);
      }
    });
    queues.set(prefix, turn.catch(() => {}));
    await turn;
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}
export const rateGate = createRateGate();
