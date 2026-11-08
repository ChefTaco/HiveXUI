// The server allows each subject 20 /hermes/*, 30 /orchestra/* and 30 /roles/* requests a minute. Every request
// to those prefixes waits here for a slot, so no page, however it polls, can reach the limit.
export const HERMES_POLL_MS = 60_000;
const WINDOW_MS = 60_000;
const BUDGETS: ReadonlyArray<readonly [prefix: string, limit: number]> = [
  ['/hermes/', 18],
  ['/roles/', 27],
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

/** Paths whose reads wait out a 429's Retry-After together: Magnus counts them in one per-person budget. */
const COOLDOWN_PREFIXES = ['/ardent/'] as const;
/** The longest a read waits for its single retry; a longer Retry-After goes to the caller as the error. */
export const READ_RETRY_MAX_MS = 30_000;
const COOLDOWN_MAX_MS = 60_000;
const COOLDOWN_DEFAULT_MS = 5_000;

/** Retry-After as milliseconds: seconds or an HTTP date, a few seconds when absent, at most a minute. */
export function retryAfterMs(header: string | null, now: () => number = () => Date.now()): number {
  const text = header?.trim() ?? '';
  const seconds = /^\d+$/.test(text) ? Number(text) * 1000 : Number.NaN;
  const date = Number.isNaN(seconds) && text ? Date.parse(text) - now() : Number.NaN;
  const value = Number.isFinite(seconds) ? seconds : Number.isFinite(date) ? date : COOLDOWN_DEFAULT_MS;
  return Math.min(Math.max(value, 1000), COOLDOWN_MAX_MS);
}

/**
 * After a 429 on a read, every read under the same prefix holds back until Retry-After has passed, so
 * a page that fans out several reads does not keep the person's budget exhausted. Mutations never wait
 * here: Magnus gives them their own budget.
 */
export function createReadCooldown(now: () => number = () => Date.now(), sleep = delay) {
  const until = new Map<string, number>();
  const prefixOf = (path: string) => COOLDOWN_PREFIXES.find((prefix) => path.startsWith(prefix));
  return {
    applies: (path: string): boolean => prefixOf(path) !== undefined,
    hold(path: string, ms: number): void {
      const prefix = prefixOf(path);
      if (prefix) until.set(prefix, Math.max(until.get(prefix) ?? 0, now() + ms));
    },
    /** Forget every hold (sign-out, tests). */
    clear: (): void => until.clear(),
    async wait(path: string, signal?: AbortSignal): Promise<void> {
      const prefix = prefixOf(path);
      if (!prefix) return;
      for (let left = (until.get(prefix) ?? 0) - now(); left > 0; left = (until.get(prefix) ?? 0) - now()) await sleep(left, signal);
    },
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
export const readCooldown = createReadCooldown();
