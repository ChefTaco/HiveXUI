// The chat WebSocket's reconnect: exponential backoff with jitter (HiveCommon's retry policy), and a
// fresh chat session before each attempt. ChatterMost refuses a socket whose cookie has expired, and
// reconnecting without minting a new one only loops on close and reconnect until the next minute.
import { backoffDelay, type RetryPolicy } from '@hivemagnus/hive-common/retry';
import { HiveApiError } from '../../lib/api-error';

/** About 1 s after the first drop, doubling to at most a minute, each wait jittered to half or more. */
export const RECONNECT_POLICY: RetryPolicy = { maxAttempts: Number.MAX_SAFE_INTEGER, baseMs: 1000, maxMs: 60_000, jitter: 'equal' };
/** A socket that stayed open this long was healthy: the next drop starts the backoff again. */
export const HEALTHY_MS = 30_000;

/** The wait before reconnect attempt `attempt` (1-based). */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  return backoffDelay(Math.max(1, attempt), RECONNECT_POLICY, { random }) ?? RECONNECT_POLICY.maxMs;
}

export interface Reconnector {
  /** The socket opened. */
  opened: () => void;
  /** The socket closed; schedule the next attempt. */
  closed: () => void;
  stop: () => void;
}

/**
 * `prepare` renews the chat session (a read through the chat API does that when it is near expiry)
 * and `connect` opens the next socket. A refusal while renewing (401 or 403) means the chat session
 * cannot be renewed: `onRefused` is told and no further attempt is made. Any other failure, such as
 * the network still being down, waits for the next attempt.
 */
export function createReconnector(options: {
  prepare: () => Promise<unknown>;
  connect: () => void;
  onRefused: (error: unknown) => void;
  random?: () => number;
  now?: () => number;
}): Reconnector {
  const now = options.now ?? Date.now;
  let attempt = 0;
  let openedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const schedule = () => {
    if (stopped) return;
    attempt += 1;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void (async () => {
        try {
          await options.prepare();
        } catch (error) {
          if (stopped) return;
          if (HiveApiError.is(error) && (error.status === 401 || error.status === 403)) {
            stopped = true;
            options.onRefused(error);
            return;
          }
          schedule();
          return;
        }
        if (!stopped) options.connect();
      })();
    }, reconnectDelay(attempt, options.random));
  };
  return {
    opened: () => {
      openedAt = now();
    },
    closed: () => {
      if (openedAt && now() - openedAt >= HEALTHY_MS) attempt = 0;
      openedAt = 0;
      schedule();
    },
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
