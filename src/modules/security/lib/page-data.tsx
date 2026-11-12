import { createContext, useContext, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { LoadingRows } from '@ui';

/** Reloads the current Cindertrace page's records, after a change or while an action runs. */
export const SecurityRefresh = createContext<{ revision: number; refresh: () => void }>({ revision: 0, refresh: () => {} });
export const useSecurityRefresh = (): (() => void) => useContext(SecurityRefresh).refresh;

/** A record that cannot be shown, such as a case that does not exist or a lab that is off. */
export class SecurityRecordUnavailable extends Error {
  constructor() {
    super('This security record is unavailable');
  }
}

export type SecurityData<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

/**
 * Loads a page's records, again whenever `key` changes or the page is refreshed. A refresh keeps
 * the records on screen until the new ones arrive, so forms and messages on the page survive it.
 */
export function useSecurityData<T>(load: () => Promise<T>, key: string): SecurityData<T> {
  const { revision } = useContext(SecurityRefresh);
  const [state, setState] = useState<{ key: string; value: SecurityData<T> }>({ key, value: { status: 'loading' } });
  useEffect(() => {
    let current = true;
    void load()
      .then((data) => current && setState({ key, value: { status: 'ready', data } }))
      .catch((reason: unknown) => current && setState({ key, value: { status: 'error', message: reason instanceof Error ? reason.message : 'Security information could not be loaded' } }));
    return () => {
      current = false;
    };
    // `load` is a new closure on every render; `key` names what it loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision]);
  return state.key === key ? state.value : { status: 'loading' };
}

/** A page's loading lines, its failure, or the page itself. */
export function SecurityPage<T>({ data, children }: { data: SecurityData<T>; children: (data: T) => ReactNode }): ReactElement {
  if (data.status === 'error')
    return (
      <p className="error-banner" role="alert">
        {data.message}
      </p>
    );
  if (data.status === 'loading')
    return (
      <div role="status" aria-label="Loading security information">
        <LoadingRows />
      </div>
    );
  return <>{children(data.data)}</>;
}
