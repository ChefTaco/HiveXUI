// The Studio service's browser API lives under /api/ardentstudio. Its released contract is not here
// yet, so this file only asks whether the service answers; pages say plainly what they cannot show.
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../lib/transport';

export const STUDIO_API = '/api/ardentstudio';
const PROBE_TIMEOUT_MS = 5000;
/** How often the top bar re-checks while the tab is visible. */
export const PROBE_INTERVAL_MS = 30_000;

export type StudioConnection =
  | { state: 'checking' }
  | { state: 'ready' }
  | { state: 'denied' | 'unavailable'; message: string };

/** Never rejects: every failure is a state the page explains. */
export async function probeStudio(signal?: AbortSignal, send: typeof apiFetch = apiFetch): Promise<StudioConnection> {
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  try {
    const response = await send(`${STUDIO_API}/health/ready`, {
      headers: { Accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (response.status === 401 || response.status === 403)
      return { state: 'denied', message: 'This identity is not allowed to use Ardent Project Studio.' };
    // A page served in the service's place is not an answer from it.
    if (response.ok && (response.headers.get('content-type') ?? '').includes('application/json')) return { state: 'ready' };
    return { state: 'unavailable', message: `The Studio service did not pass its readiness check (HTTP ${response.status}).` };
  } catch {
    return { state: 'unavailable', message: 'The Studio service could not be reached.' };
  }
}

/** The connection the top bar shows and every page reads, re-checked on a timer and on Retry. */
export function useStudioConnection(probe: typeof probeStudio = probeStudio): { connection: StudioConnection; retry: () => void } {
  const [connection, setConnection] = useState<StudioConnection>({ state: 'checking' });
  const controller = useRef<AbortController | null>(null);
  const check = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const next = await probe(current.signal);
    if (!current.signal.aborted) setConnection(next);
  }, [probe]);
  useEffect(() => {
    void check();
    const timer = setInterval(() => {
      if (!document.hidden) void check();
    }, PROBE_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      controller.current?.abort();
    };
  }, [check]);
  const retry = useCallback(() => {
    setConnection({ state: 'checking' });
    void check();
  }, [check]);
  return { connection, retry };
}
