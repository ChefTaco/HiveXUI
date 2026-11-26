import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { adminApi } from '../lib/api';
import { cn } from '../lib/cn';
import { initials } from '../lib/format';
import { CINDERTRACE_PAGES, SECURITY_PREFIX, matchSubroute, navigateTo, underPrefix } from '../lib/routes';
import { chooseLocalSignIn, localSignInOffered } from '../lib/runtime';
import type { AdminUser } from '../lib/types';
import { Icon, HiveSigil } from './icons';
import { SkipLink } from './skip-link';
import { useDocumentTitle } from '../lib/document-title';
import { useNavigationDrawer } from '../lib/nav-drawer';
import { Button } from '@ui';

const SecurityModule = lazy(() => import('../modules/security'));

const subscribe = (listener: () => void) => {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
};
const currentPath = () => location.pathname;

const ENTRIES = CINDERTRACE_PAGES.flatMap((page) =>
  'nav' in page && page.nav ? [{ ...page.nav, href: page.path ? `${SECURITY_PREFIX}/${page.path}` : SECURITY_PREFIX }] : [],
);

/**
 * The console after Cindertrace's own sign-in: Cindertrace's pages and nothing else. No other
 * product is reachable with this session, so none is shown.
 */
export function LocalShell({ user, onLogout }: { user: AdminUser | null; onLogout: () => void }) {
  const pathname = useSyncExternalStore(subscribe, currentPath);
  const [navOpen, setNavOpen] = useState(false);
  const drawer = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const closeNav = useCallback(() => setNavOpen(false), []);
  useNavigationDrawer(navOpen, closeNav, drawer, toggle);
  const recovery = localSignInOffered();
  useEffect(() => {
    if (!underPrefix(pathname, SECURITY_PREFIX)) navigateTo(SECURITY_PREFIX, 'replace');
  }, [pathname]);
  const active = [...ENTRIES].reverse().find((entry) => underPrefix(pathname, entry.href))?.href;
  const displayName = user?.displayName ?? user?.username ?? 'Operator';
  const page = matchSubroute(SECURITY_PREFIX, CINDERTRACE_PAGES, pathname.replace(/\/+$/, ''))?.page;
  useDocumentTitle(page?.path ? `${page.title} · Cindertrace` : 'Cindertrace');

  async function signOut() {
    try {
      await adminApi.logout();
    } finally {
      onLogout();
    }
  }

  return (
    <div className="app-shell">
      <SkipLink />
      <aside id="product-navigation" ref={drawer} className={navOpen ? 'sidebar sidebar--open' : 'sidebar'}>
        <div className="brand">
          <HiveSigil className="brand-sigil" />
          <div>
            <strong>HiveXUI</strong>
            <span>{recovery ? 'Cindertrace recovery' : 'Cindertrace'}</span>
          </div>
        </div>
        <nav aria-label="Cindertrace">
          {ENTRIES.map((entry) => {
            const EntryIcon = Icon[entry.icon];
            return (
              <button
                key={entry.href}
                type="button"
                className={cn('nav-item', entry.href === active && 'nav-item--active')}
                aria-current={entry.href === active ? 'page' : undefined}
                onClick={() => {
                  setNavOpen(false);
                  navigateTo(entry.href);
                }}
              >
                <EntryIcon aria-hidden="true" />
                <span>{entry.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="user-avatar">{initials(displayName)}</span>
            <div>
              <strong>{displayName}</strong>
              <span>{user?.roles?.join(', ') || 'Signed in'}</span>
            </div>
          </div>
          <button type="button" className="topbar-icon" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}>
            <Icon.Logout aria-hidden="true" />
          </button>
        </div>
      </aside>
      <main className="main" id="main-content" tabIndex={-1}>
        <header className="topbar">
          <button
            ref={toggle}
            aria-expanded={navOpen}
            aria-controls="product-navigation"
            className="menu-toggle"
            onClick={() => setNavOpen((open) => !open)}
            aria-label="Toggle navigation"
          >
            <Icon.Menu />
          </button>
          <span className="title" tabIndex={-1}>Cindertrace</span>
        </header>
        <div className="content">
          {recovery ? (
            <div className="warning-banner" role="note">
              <span>Recovery sign-in: only Cindertrace is available with this session.</span>{' '}
              <Button variant="ghost" size="sm" onClick={() => void signOut().finally(() => chooseLocalSignIn(false))}>
                Return to Oathweave sign-in
              </Button>
            </div>
          ) : null}
          <Suspense fallback={<div className="center-load"><span className="spinner spinner--lg" /></div>}>
            <SecurityModule />
          </Suspense>
        </div>
      </main>
      {navOpen ? <div className="scrim scrim--nav" onClick={() => setNavOpen(false)} /> : null}
    </div>
  );
}
