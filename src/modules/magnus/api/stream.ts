// Reads a text/event-stream with fetch, because EventSource cannot send a bearer token. Each
// connection goes through apiFetch, so a new one carries a newly minted token: Oathweave streams
// close at token expiry and on logout, and a clean close simply reconnects.
import { apiFetch, onAccessCleared } from '../../../lib/transport';
import { apiPath, handleUnauthorized, randomId, type Query } from './client';
import { createSseParser, type SseEvent } from './sse';

export type StreamState = 'connecting' | 'open' | 'retrying' | 'stopped';
export interface StreamOptions {
  /** Relative to /api/v1: '/events/stream'. */
  path: string;
  query?: Query;
  onEvent: (event: SseEvent) => void;
  onState?: (state: StreamState, detail?: string) => void;
  /** Backoff between attempts, jittered. Defaults: 1s doubling to 60s. */
  minDelayMs?: number;
  maxDelayMs?: number;
  /** No bytes for this long means a dead connection: the server sends a keep-alive far more often. */
  idleTimeoutMs?: number;
  request?: typeof fetch;
  random?: () => number;
}
export interface StreamHandle {
  close: () => void;
}
const HEALTHY_MS = 30_000;
/** A 401 can be a token that just expired. Past this many in a row the session is gone. */
const MAX_UNAUTHORIZED = 3;

export function backoffDelay(attempt: number, minMs: number, maxMs: number, random: () => number = Math.random): number {
  const ceiling = Math.min(maxMs, minMs * 2 ** attempt);
  return ceiling / 2 + random() * (ceiling / 2);
}

export function openStream(options: StreamOptions): StreamHandle {
  const { path, query, onEvent, onState, minDelayMs = 1000, maxDelayMs = 60_000, idleTimeoutMs = 75_000, request = apiFetch, random } = options;
  const lifetime = new AbortController();
  const stop = (detail?: string) => {
    if (lifetime.signal.aborted) return;
    lifetime.abort();
    onState?.('stopped', detail);
  };
  const unsubscribe = onAccessCleared(() => stop('Signed out'));
  lifetime.signal.addEventListener('abort', unsubscribe, { once: true });

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      lifetime.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });

  async function connect(): Promise<{ healthy: boolean; retryAfterMs?: number; unauthorized?: boolean }> {
    const connection = new AbortController();
    const abortConnection = () => connection.abort();
    lifetime.signal.addEventListener('abort', abortConnection, { once: true });
    let idle: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const watch = () => {
      clearTimeout(idle);
      idle = setTimeout(abortConnection, idleTimeoutMs);
    };
    try {
      onState?.('connecting');
      watch();
      const response = await request(apiPath(path, query), {
        headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache', 'x-trace-id': randomId() },
        signal: connection.signal,
      });
      if (response.status === 401) return { healthy: false, unauthorized: true };
      if (response.status === 403 || response.status === 404) {
        stop(response.status === 403 ? 'Your Magnus role does not allow this stream' : 'This stream is not available');
        return { healthy: false };
      }
      if (response.status === 429) {
        const seconds = Number(response.headers.get('retry-after'));
        return { healthy: false, ...(seconds > 0 ? { retryAfterMs: seconds * 1000 } : {}) };
      }
      if (!response.ok || !response.body) return { healthy: false };
      onState?.('open');
      const parse = createSseParser(onEvent);
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        watch();
        parse(decoder.decode(value, { stream: true }));
      }
      return { healthy: Date.now() - startedAt >= HEALTHY_MS };
    } catch {
      return { healthy: Date.now() - startedAt >= HEALTHY_MS };
    } finally {
      clearTimeout(idle);
      lifetime.signal.removeEventListener('abort', abortConnection);
      connection.abort();
    }
  }

  void (async () => {
    let attempt = 0;
    let unauthorized = 0;
    while (!lifetime.signal.aborted) {
      const result = await connect();
      if (lifetime.signal.aborted) return;
      attempt = result.healthy ? 0 : attempt + 1;
      if (result.unauthorized) {
        // handleUnauthorized signs out if the session is really gone, and that stops this loop.
        await handleUnauthorized();
        unauthorized += 1;
        if (unauthorized >= MAX_UNAUTHORIZED) {
          stop('Sign in again to receive live updates');
          return;
        }
      } else unauthorized = 0;
      const delay = Math.max(result.retryAfterMs ?? 0, backoffDelay(attempt, minDelayMs, maxDelayMs, random));
      if (lifetime.signal.aborted) return;
      onState?.('retrying', `Reconnecting in ${Math.ceil(delay / 1000)}s`);
      await wait(delay);
    }
  })();

  return { close: () => stop() };
}
