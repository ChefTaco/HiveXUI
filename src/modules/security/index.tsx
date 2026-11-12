import { lazy, Suspense, useCallback, useMemo, useState, useSyncExternalStore, type ComponentType } from 'react';
import { productEnabled } from '../../lib/runtime';
import { CINDERTRACE_PAGES, matchSubroute, SECURITY_PREFIX, underPrefix, type SubRouteProps } from '../../lib/routes';
import { SecurityRefresh } from './lib/page-data';
import { EmptyState, LoadingRows } from '@ui';

// One chunk per page, made once so a page keeps its state while its address stays the same.
const PAGES = new Map<string, ComponentType<SubRouteProps>>(CINDERTRACE_PAGES.map((page) => [page.id, lazy(page.load)]));

const subscribe = (listener: () => void) => {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
};
const address = () => location.pathname + location.search;

export default function SecurityModule() {
  if (!productEnabled('cindertrace'))
    return (
      <EmptyState
        framed
        title="Cindertrace is not configured"
        message="Connect the security service to review investigations and evidence."
      />
    );
  return <ConfiguredSecurityModule />;
}

/** Cindertrace's pages, chosen from the route table by address. The shell's sidebar lists them. */
function ConfiguredSecurityModule() {
  const current = useSyncExternalStore(subscribe, address);
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((value) => value + 1), []);
  const refresh = useMemo(() => ({ revision, refresh: bump }), [revision, bump]);
  const [pathname, query = ''] = current.split('?');
  // ?page=security opens the overview at the root address.
  const match = matchSubroute(SECURITY_PREFIX, CINDERTRACE_PAGES, underPrefix(pathname!, SECURITY_PREFIX) ? pathname!.replace(/\/+$/, '') : SECURITY_PREFIX);
  const search = useMemo(() => new URLSearchParams(query), [query]);
  const Page = match ? PAGES.get(match.page.id) : undefined;
  return (
    <section className="security-module">
      {Page && match ? (
        <SecurityRefresh.Provider value={refresh}>
          <Suspense
            fallback={
              <div role="status" aria-label="Loading security information">
                <LoadingRows />
              </div>
            }
          >
            {/* A new address starts the page afresh, as following a link always has. */}
            <Page key={current} params={match.params} search={search} />
          </Suspense>
        </SecurityRefresh.Provider>
      ) : (
        <p className="error-banner" role="alert">
          This security page is unavailable
        </p>
      )}
    </section>
  );
}
