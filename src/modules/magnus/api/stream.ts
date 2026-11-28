// Reads a text/event-stream with HiveCommon's followSse(), because EventSource cannot send a bearer
// token. Each connection goes through apiFetch, so a new one carries a newly minted token: Oathweave
// streams close at token expiry and on logout, and a clean close simply reconnects.
import { followSse, SseEventTooLargeError, SseStatusError, type SseEvent } from '@hivemagnus/hive-common/sse';
import { sleepAbortable } from '@hivemagnus/hive-common/retry';
import { apiFetch, onAccessCleared } from '../../../lib/transport';
import { apiPath, handleUnauthorized, randomId, type Query } from './client';

export type { SseEvent };
export type StreamState = 'connecting' | 'open' | 'retrying' | 'stopped';
export interface StreamOptions {
  /** Relative to /api/v1: '/events/stream'. */
  path: string;
  query?: Query;
  /**
   * The full API path, read again for every connection, for a stream outside Magnus or one that
   * resumes from a cursor. When set, path and query are not used.
   */
  url?: () => string;
  /** Shown when the stream answers 403. */
  deniedMessage?: string;
  onEvent: (event: SseEvent) => void;
  onState?: (state: StreamState, detail?: string) => void;
  /**
   * Backoff between failed connections, jittered: 2 x minDelayMs after the first failure, doubling
   * to maxDelayMs. minDelayMs is also the least time between two connections. Defaults 1s and 60s.
   */
  minDelayMs?: number;
  maxDelayMs?: number;
  /** No bytes for this long means a dead connection: the server sends a keep-alive far more often. */
  idleTimeoutMs?: number;
  /** The largest event read, in bytes. 4 MiB, the limit Ardent Studio uses for the same Magnus streams. */
  maxEventBytes?: number;
  request?: typeof fetch;
}
export interface StreamHandle {
  close: () => void;
}

export const MAX_STREAM_EVENT_BYTES = 4 * 1024 * 1024;
export const STREAM_SIGNED_OUT = 'Sign in again to receive live updates';
export const STREAM_UNAVAILABLE = 'This stream is not available';

/** Why a follow ended, for the operator. */
function stopDetail(error: unknown, deniedMessage: string): string | undefined {
  if (error instanceof SseStatusError) return error.status === 401 ? STREAM_SIGNED_OUT : error.status === 403 ? deniedMessage : STREAM_UNAVAILABLE;
  if (error instanceof SseEventTooLargeError) return 'The stream sent an event too large to read';
  return 'Live updates stopped';
}

export function openStream(options: StreamOptions): StreamHandle {
  const { path, query, url, deniedMessage = 'Your Magnus role does not allow this stream', onEvent, onState, minDelayMs = 1000, maxDelayMs = 60_000, idleTimeoutMs = 75_000, maxEventBytes = MAX_STREAM_EVENT_BYTES, request = apiFetch } = options;
  const lifetime = new AbortController();
  const report = (state: StreamState, detail?: string) => {
    // A page's state callback must not end the stream it is watching.
    try {
      onState?.(state, detail);
    } catch (error) {
      console.warn('A stream state handler failed:', error instanceof Error ? error.message : error);
    }
  };
  const stop = (detail?: string) => {
    if (lifetime.signal.aborted) return;
    lifetime.abort();
    report('stopped', detail);
  };
  const unsubscribe = onAccessCleared(() => stop('Signed out'));
  lifetime.signal.addEventListener('abort', unsubscribe, { once: true });

  // followSse reconnects at once after a connection that delivered events. A server that answers
  // and closes straight away (a token about to expire) must not turn that into a tight loop.
  let lastStart = Number.NEGATIVE_INFINITY;
  const untilNextStart = () => Math.max(0, lastStart + minDelayMs - Date.now());

  // With url() set, the path below is only a placeholder: the fetch reads url() for every connection.
  void followSse(apiPath(path, query), {
    signal: lifetime.signal,
    fetch: async (target, init) => {
      const spacing = untilNextStart();
      if (spacing > 0) await sleepAbortable(spacing, init.signal ?? undefined);
      lastStart = Date.now();
      const headers = new Headers(init.headers);
      // The cursor, where a stream has one, is the caller's: url() carries it. Without one a
      // stream starts at the present, as it always has.
      headers.delete('last-event-id');
      return request(url ? url() : target, { ...init, headers });
    },
    headers: () => ({ 'Cache-Control': 'no-cache', 'x-trace-id': randomId() }),
    // A 401 can be a token that just expired. handleUnauthorized signs out if the session is really
    // gone, and that stops this stream; otherwise reconnect once with a fresh token.
    onUnauthorized: async () => {
      await handleUnauthorized();
      return true;
    },
    onStateChange: ({ state, delayMs = 0 }) => {
      if (lifetime.signal.aborted) return;
      if (state !== 'retrying') return report(state);
      report('retrying', `Reconnecting in ${Math.ceil(Math.max(delayMs, untilNextStart()) / 1000)}s`);
    },
    onEvent: (event) => {
      // A page's handler that throws on one event must not end the live stream it is showing.
      try {
        onEvent(event);
      } catch (error) {
        console.warn(`A stream event handler failed on '${event.event}':`, error instanceof Error ? error.message : error);
      }
    },
    policy: { maxAttempts: Number.MAX_SAFE_INTEGER, baseMs: 2 * minDelayMs, maxMs: maxDelayMs, jitter: 'equal' },
    maxFailures: Number.POSITIVE_INFINITY,
    idleTimeoutMs,
    maxEventBytes,
  }).then(
    () => stop(),
    (error: unknown) => {
      if (!lifetime.signal.aborted) stop(stopDetail(error, deniedMessage));
    },
  );

  return { close: () => stop() };
}
