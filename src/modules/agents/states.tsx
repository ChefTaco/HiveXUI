// The states every Agent 360 tab can be in besides showing data, and the load hook they share.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { EmptyState, LoadingRows, ResourceError } from '@ui';
import { HiveApiError } from '../../lib/api-error';
import type { Product } from '../../lib/transport';

export const PRODUCT_NAME: Readonly<Record<Product, string>> = {
  magnus: 'Magnus',
  hivemem: 'HiveMem',
  ardentstudio: 'Ardent Project Studio',
  cindertrace: 'Cindertrace',
  emberpath: 'Emberpath',
  hiveskills: 'HiveSkills',
  oathweave: 'Oathweave',
  chattermost: 'ChatterMost',
  embermend: 'Embermend',
};

export interface Load<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  refresh: () => void;
}

/** Runs `load` while it is given, again when a dependency changes, and aborts what it replaces. */
export function useLoad<T>(load: ((signal: AbortSignal) => Promise<T>) | null, dependencies: readonly unknown[]): Load<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(load !== null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(load);
  latest.current = load;
  const enabled = load !== null;
  useEffect(() => {
    const run = latest.current;
    if (!run) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    run(controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        setData(value);
        setLoading(false);
      },
      (caught: unknown) => {
        if (controller.signal.aborted) return;
        setData(undefined);
        setError(caught);
        setLoading(false);
      },
    );
    return () => controller.abort();
    // Callers list what the loader reads, as with useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, attempt, ...dependencies]);
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);
  return { data, error, loading, refresh };
}

/** A refusal for this person, rather than a failure to retry. */
export const isForbidden = (error: unknown): error is HiveApiError => error instanceof HiveApiError && (error.status === 401 || error.status === 403);

/** `framed` when the state fills a tab on its own rather than sitting in a panel. */
export function NotInstalled({ product, framed = false }: { product: Product; framed?: boolean }) {
  return <EmptyState framed={framed} title={`${PRODUCT_NAME[product]} is not installed`} message={`This installation has no ${PRODUCT_NAME[product]}, so it has nothing to show about this agent.`} />;
}

export function NotLinked({ children, framed = false }: { children: ReactNode; framed?: boolean }) {
  return <EmptyState framed={framed} title="Not linked to a HiveMem actor" message={children} />;
}

export function Unsupported({ product, children }: { product: Product; children: ReactNode }) {
  return <EmptyState tone="warning" title={`Needs a newer ${PRODUCT_NAME[product]}`} message={children} />;
}

export function Forbidden({ children }: { children: ReactNode }) {
  return <EmptyState tone="warning" title="Not visible to your role" message={children} />;
}

/**
 * The loading, refused and failed states of one read. Renders `children` with the data once it
 * has arrived.
 */
export function Loaded<T>({ load, product, what, children }: { load: Load<T>; product: Product; what: string; children: (data: T) => ReactNode }) {
  if (load.loading) return <LoadingRows />;
  if (isForbidden(load.error)) return <Forbidden>{`${PRODUCT_NAME[product]} does not let your account read ${what}: ${load.error.message}`}</Forbidden>;
  if (load.error !== undefined) return <ResourceError error={load.error} title={`${PRODUCT_NAME[product]} could not list ${what}`} onRetry={load.refresh} />;
  if (load.data === undefined) return <LoadingRows />;
  return <>{children(load.data)}</>;
}
