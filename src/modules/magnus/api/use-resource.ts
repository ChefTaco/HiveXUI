import { useCallback, useEffect, useRef, useState } from 'react';
import { MagnusApiError } from './errors';
import { onMagnusRefresh } from '../navigation';

export interface ResourceOptions {
  /** Refresh this often while the tab is visible. /hermes and /orchestra reads use HERMES_POLL_MS or longer. */
  pollMs?: number | undefined;
  /** False holds the request, for example until the session says the section is on. */
  enabled?: boolean | undefined;
}
export interface Resource<T> {
  data: T | undefined;
  /** The latest failure. `data` keeps the last good answer, so a brief outage does not blank a page. */
  error: unknown;
  /** True until the first answer or failure. */
  loading: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
  /** Replace the data after a mutation without waiting for a reload. */
  setData: (data: T) => void;
}

/** Load a read with `magnus.get`, abort it on unmount, keep one in flight, and back off when limited. */
export function useMagnusResource<T>(load: (signal: AbortSignal) => Promise<T>, dependencies: readonly unknown[] = [], options: ResourceOptions = {}): Resource<T> {
  const { pollMs, enabled = true } = options;
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(load);
  latest.current = load;
  const controller = useRef<AbortController | null>(null);
  const limited = useRef(1);
  // From the latest 429's Retry-After: no poll is sent before this time.
  const notBefore = useRef(0);

  const refresh = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setRefreshing(true);
    try {
      const value = await latest.current(current.signal);
      if (current.signal.aborted) return;
      limited.current = 1;
      notBefore.current = 0;
      setData(value);
      setError(undefined);
    } catch (caught) {
      if (current.signal.aborted) return;
      if (caught instanceof MagnusApiError && caught.status === 429) {
        limited.current = Math.min(limited.current * 2, 8);
        notBefore.current = Date.now() + (caught.retryAfterMs ?? 0);
      }
      setError(caught);
    } finally {
      if (!current.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void refresh();
    const unsubscribe = onMagnusRefresh(() => void refresh());
    return () => {
      unsubscribe();
      controller.current?.abort();
    };
    // Callers list what the loader reads, as with useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, refresh, ...dependencies]);

  useEffect(() => {
    if (!enabled || !pollMs) return;
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    const schedule = () => {
      timer = setTimeout(async () => {
        if (!document.hidden && Date.now() >= notBefore.current) await refresh();
        if (active) schedule();
      }, Math.max(pollMs * limited.current, notBefore.current - Date.now()));
    };
    schedule();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [enabled, pollMs, refresh]);

  return { data, error, loading, refreshing, refresh, setData };
}
