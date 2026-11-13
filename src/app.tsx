import { clearAccess } from './lib/transport';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
const ChatInviteRedemption = lazy(() => import('./modules/chat/invite-redemption'));
const CommandPalette = lazy(() => import('./components/command-palette'));
const InboxBell = lazy(() => import('./modules/inbox/bell'));
import { ProductAccess } from './components/product-access';
import { adminApi, ApiError } from './lib/api';
import { MfaRequired } from './lib/browser-auth';
import { parsePortalAuthorization } from './lib/authorization-portal';
import {
  breadcrumbs,
  findActiveNav,
  navProducts,
  paletteScreens,
  resolveDeepLink,
  shellLocation,
  showsShellRefresh,
  showsShellStatus,
  titleFor,
  viewAddress,
  viewAvailable,
  visibleNavGroups,
  type ViewKey,
} from './lib/navigation';
import { navigateTo, ROUTES, routeFor, underPrefix } from './lib/routes';
import { type MagnusNavContext } from './modules/magnus/nav';
import { isStudioPath, openStudio } from './modules/studio/paths';
import {
  browserIdentity,
  productEnabled,
  productInstalled,
} from './lib/runtime';
import { useRegistry } from './lib/registry';
import type { AdminUser } from './lib/types';
import { StoreProvider, useStore } from './lib/store';
import { Icon, HiveSigil } from './components/icons';
import { AuthLimitsStrip } from './components/auth-limits-strip';
import { Breadcrumb } from './components/breadcrumb';
import { SidebarNav } from './components/sidebar-nav';
import { SetupNudge } from './components/setup-nudge';
import { initials, relativeTime } from './lib/format';
import { Button, buttonClass } from '@ui';

type AuthState = 'checking' | 'unauthed' | 'authed';

export function App() {
  if (location.pathname === '/auth/authorize') return <AuthorizationPortal />;
  // Public: the person redeeming an invite has no identity to sign in with.
  if (location.pathname === '/signup') return <Suspense fallback={<Background />}><ChatInviteRedemption /></Suspense>;
  return <ConsoleApp />;
}

function ConsoleApp() {
  const [auth, setAuth] = useState<AuthState>('checking');
  const [user, setUser] = useState<AdminUser | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await adminApi.me();
        if (active) {
          setUser(result.user);
          setAuth('authed');
        }
      } catch {
        if (active) setAuth('unauthed');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleAuthExpired = useCallback(() => {
    browserIdentity()?.invalidate();
    clearAccess();
    setUser(null);
    setAuth('unauthed');
  }, []);

  if (auth === 'checking') {
    return (
      <>
        <Background />
        <div className="center-load">
          <span className="spinner spinner--lg" />
        </div>
      </>
    );
  }

  if (auth === 'unauthed') {
    return (
      <>
        <AuthLimitsStrip />
        <LoginScreen
          onSuccess={(loggedIn) => {
            setUser(loggedIn);
            setAuth('authed');
          }}
        />
      </>
    );
  }

  return <SignedIn user={user} onLogout={handleAuthExpired} />;
}

const subscribeLocation = (listener: () => void) => {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
};
const currentPath = () => location.pathname;

/**
 * A fullscreen product (Studio, under /studio) replaces the shell rather than rendering inside it,
 * but only while it is installed. Every other address is the shell. Each one reads its state from
 * the address when it mounts, so moving between them needs nothing else.
 */
function SignedIn({ user, onLogout }: { user: AdminUser | null; onLogout: () => void }) {
  const pathname = useSyncExternalStore(subscribeLocation, currentPath);
  // The Registry may answer late and remove Studio; this re-reads the gate when it does.
  useRegistry();
  const fullscreen = ROUTES.find((route) => 'fullscreen' in route && underPrefix(pathname, route.prefix.path) && viewAvailable(route.id, productInstalled));
  if (fullscreen) {
    const Page = fullscreen.component;
    return (
      <Suspense fallback={<><Background /><div className="center-load"><span className="spinner spinner--lg" /></div></>}>
        <Page view={fullscreen.id} currentUser={user} onNavigate={() => {}} onAuthExpired={onLogout} />
      </Suspense>
    );
  }
  return (
    <StoreProvider onAuthExpired={onLogout}>
      <Shell user={user} onLogout={onLogout} />
    </StoreProvider>
  );
}

function AuthorizationPortal() {
  const [selection] = useState(() => {
    try { return { request: parsePortalAuthorization(location.search), error: '' }; }
    catch { return { request: null, error: 'This authorization request is invalid. Return to the application to start sign-in again.' }; }
  });
  const [phase, setPhase] = useState<AuthState>('checking');
  const [error, setError] = useState(selection.error);
  const identity = browserIdentity();
  useEffect(() => {
    if (!selection.request || !identity) return;
    let active = true;
    void identity.me().then(() => { if (active) setPhase('authed'); })
      .catch(() => { if (active) setPhase('unauthed'); });
    return () => { active = false; };
  }, [selection, identity]);
  useEffect(() => {
    if (phase !== 'authed' || !selection.request || !identity || error) return;
    let active = true;
    void identity.approveAuthorization(selection.request).then(approval => {
      if (active) approval.redirect(url => location.replace(url));
    }).catch(caught => {
      if (active) setError(caught instanceof Error ? caught.message : 'Authorization could not be completed');
    });
    return () => { active = false; };
  }, [phase, selection, identity, error]);
  if (!error && identity && selection.request && phase === 'unauthed')
    return <><AuthLimitsStrip /><LoginScreen authorization onSuccess={() => setPhase('authed')} /></>;
  const message = error || (!identity ? 'Oathweave sign-in is not configured for this console.' : 'Checking your sign-in and application access…');
  return <><Background /><main className="login-shell"><section className="login-card" aria-labelledby="authorization-title">
    <HiveSigil className="login-sigil" />
    <p className="login-eyebrow">Hive:Magnus</p><h1 id="authorization-title">Oathweave sign-in</h1>
    <p className="login-sub">Continue securely to your application.</p>
    <p role={error || !identity ? 'alert' : 'status'} className={error || !identity ? 'error-banner' : 'muted'}>{message}</p>
    {!error && identity && selection.request && <Button onClick={() => {
      identity.invalidate(); setError('Authorization cancelled. Return to the application to start again.');
    }}>Cancel authorization</Button>}
  </section></main></>;
}

function Background() {
  return (
    <>
      <div className="console-backdrop" aria-hidden />
      <div className="console-scanlines" aria-hidden />
    </>
  );
}

/* ===================== Login ===================== */

function LoginScreen({ onSuccess, authorization = false }: { onSuccess: (user: AdminUser) => void; authorization?: boolean }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<MfaRequired | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'sign-in' | 'recover' | 'reset'>('sign-in');
  const [email, setEmail] = useState(''),
    [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState(''),
    [confirmation, setConfirmation] = useState('');
  const [notice, setNotice] = useState('');
  function changeMode(value: typeof mode) {
    setMode(value);
    setChallenge(null);
    setPassword('');
    setCode('');
    setRecoveryCode('');
    setNewPassword('');
    setConfirmation('');
    setError(null);
    setNotice('');
  }

  async function passkey() {
    const identity = browserIdentity();
    if (!identity || !challenge) return;
    setBusy(true);
    setError(null);
    try {
      onSuccess((await identity.completePasskey(challenge.token)).user);
      setChallenge(null);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Passkey verification failed',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const identity = browserIdentity();
      if (mode === 'recover' && identity) {
        setNotice(await identity.recover(email.trim()));
        return;
      }
      if (mode === 'reset' && identity) {
        if (newPassword !== confirmation)
          throw new Error('Passwords do not match');
        await identity.resetPassword(recoveryCode.trim(), newPassword);
        changeMode('sign-in');
        setNotice('Password updated. Sign in with your new password.');
        return;
      }
      const result =
        challenge && identity
          ? await identity.completeMfa(challenge.token, code.trim())
          : await adminApi.login(username.trim(), password);
      setPassword('');
      setCode('');
      onSuccess(result.user);
    } catch (caught) {
      if (caught instanceof MfaRequired) {
        setChallenge(caught);
        setPassword('');
        return;
      }
      setPassword('');
      const message =
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : 'Login failed';
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Background />
      <div className="login-shell">
        <form className="login-card" onSubmit={submit}>
          <HiveSigil className="login-sigil" />
          <p className="login-eyebrow">Hive:Magnus</p>
          <h1>{authorization ? 'Oathweave sign-in' : 'Control Plane Console'}</h1>
          <p className="login-sub">
            {authorization ? 'Sign in to continue to your application.' : 'Authenticate to manage this installation.'}
          </p>

          {error ? (
            <div className="error-banner" role="alert">
              <Icon.Alert aria-hidden="true" />
              {error}
            </div>
          ) : null}

          {notice && <p role="status">{notice}</p>}
          {mode === 'recover' ? (
            <label className="field">
              <span className="field-label">Account email</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
          ) : mode === 'reset' ? (
            <>
              <label className="field">
                <span className="field-label">Recovery code</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={recoveryCode}
                  onChange={(event) => setRecoveryCode(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span className="field-label">New password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span className="field-label">Confirm new password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                />
              </label>
            </>
          ) : !challenge ? (
            <>
              <label className="field">
                <span className="field-label">Username</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                />
              </label>
              <label className="field">
                <span className="field-label">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
            </>
          ) : (
            <label className="field">
              <span className="field-label">
                Authenticator or recovery code
              </span>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="one-time-code"
                required
              />
            </label>
          )}

          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? (
              <span className="spinner" />
            ) : (
              <Icon.Key className="btn-ico" />
            )}
            {mode === 'recover'
              ? 'Request recovery'
              : mode === 'reset'
                ? 'Update password'
                : challenge
                  ? 'Verify and sign in'
                  : 'Sign in'}
          </Button>
          {mode === 'sign-in' && challenge?.methods.includes('webauthn') && (
            <Button
              type="button"
              onClick={() => void passkey()}
              disabled={busy}
            >
              Use passkey
            </Button>
          )}
          {browserIdentity() && (
            <div className="login-recovery-actions">
              {mode !== 'sign-in' || challenge ? (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => changeMode('sign-in')}
                >
                  Back to sign in
                </Button>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => changeMode('recover')}
                  >
                    Forgot password?
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => changeMode('reset')}
                  >
                    Use recovery code
                  </Button>
                </>
              )}
              {mode === 'recover' && (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => changeMode('reset')}
                >
                  I have a recovery code
                </Button>
              )}
            </div>
          )}
          {!authorization && productEnabled('chattermost') && mode === 'sign-in' && !challenge && (
            <a className={buttonClass({ variant: 'ghost' })} href="/signup">Have a chat invite?</a>
          )}
        </form>
      </div>
    </>
  );
}

/* ===================== Authenticated shell ===================== */

function Shell({
  user,
  onLogout,
}: {
  user: AdminUser | null;
  onLogout: () => void;
}) {
  const [deepLink] = useState(() => resolveDeepLink(location, productInstalled));
  const [view, setView] = useState<ViewKey>(deepLink.view);
  const [magnusNav, setMagnusNav] = useState<MagnusNavContext>({});
  // The sections follow the Registry, which may answer after the first paint when it is slow.
  const registry = useRegistry();
  const products = useMemo(() => navProducts(visibleNavGroups(productInstalled, magnusNav)), [magnusNav, registry]);
  const screens = useMemo(() => paletteScreens(products), [products]);
  const [pathname, setPathname] = useState(location.pathname);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    if (deepLink.url) history.replaceState(null, '', deepLink.url);
  }, [deepLink]);
  // Role and capabilities decide which Magnus entries show. The session and its contract stay in
  // the module's chunks, so this adds one dynamic import to the main chunk.
  useEffect(() => {
    if (!browserIdentity() || !productEnabled('magnus')) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void import('./modules/magnus/session-store').then(({ sessionStore }) => {
      if (!active) return;
      const update = () => {
        const state = sessionStore.get();
        setMagnusNav(state.status === 'ready' ? { role: state.session.role, hermes: state.session.capabilities.hermes } : {});
      };
      unsubscribe = sessionStore.subscribe(update);
      update();
      void sessionStore.load();
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);
  // Links inside modules, linkTo addresses and browser history all end here: the address decides
  // the view. Pages that keep their own state in the query replace the entry, so this sees only
  // real moves.
  useEffect(() => {
    const sync = () => {
      setPathname(location.pathname);
      const next = resolveDeepLink(location, productInstalled);
      if (next.url) history.replaceState(null, '', next.url);
      setView(next.view);
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  useEffect(() => {
    const open = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', open);
    return () => window.removeEventListener('keydown', open);
  }, []);
  // A late answer can remove the page on screen. Leave it the way a dead bookmark does.
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    if (viewAvailable(viewRef.current, productInstalled)) return;
    history.replaceState(null, '', '/');
    setPathname('/');
    setView('hive');
  }, [registry]);
  const [navOpen, setNavOpen] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  const navigationToggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!navOpen) return;
    if (matchMedia('(max-width: 920px)').matches)
      navigationRef.current
        ?.querySelector<HTMLButtonElement>('nav button')
        ?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNavOpen(false);
        navigationToggleRef.current?.focus();
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [navOpen]);
  const {
    data,
    loading,
    refreshing,
    error,
    loadIssues,
    lastSync,
    refresh,
    resourceFreshness,
  } = useStore();

  const counts: Partial<Record<ViewKey, number>> = {
    providers: data.providers.length,
    traces: data.traces.length,
    audit: data.audit.length,
    actors: data.actors.length,
    incidents: data.incidents.length,
    keys: data.clientKeys.length,
  };

  async function handleLogout() {
    try {
      await adminApi.logout();
    } finally {
      onLogout();
    }
  }

  /** Follows an address from the route table, such as a search result. */
  function openAddress(href: string) {
    setNavOpen(false);
    if (isStudioPath(href.split(/[?#]/, 1)[0]!)) {
      setPaletteOpen(false);
      openStudio(href);
      return;
    }
    navigateTo(href);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.topbar .title')?.focus());
  }

  function navigate(requested: string, path?: string) {
    const target = viewAvailable(requested, productInstalled) ? routeFor(requested)! : routeFor('hive')!;
    setNavOpen(false);
    // Studio opens over the shell and returns here when it closes.
    if (target.fullscreen) {
      setPaletteOpen(false);
      openStudio(path);
      return;
    }
    const next = target.id as ViewKey;
    setView(next);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('.topbar .title')?.focus(),
    );
    // A product with its own addresses is a real move in history.
    if (target.prefix) {
      history.pushState(null, '', viewAddress(next, path));
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    const url = new URL(location.href);
    // Leaving a product's addresses is a real move too: Back returns to its page.
    const leaving = ROUTES.some((route) => 'prefix' in route && underPrefix(url.pathname, route.prefix.path));
    if (leaving) {
      url.pathname = '/';
      url.search = '';
      url.hash = '';
    }
    url.searchParams.set('page', next);
    if (leaving) {
      history.pushState(null, '', url);
      setPathname('/');
    } else history.replaceState(null, '', url);
  }

  const failures = data.telemetry?.totals.failures ?? 0;
  const displayName = user?.displayName ?? user?.username ?? 'Operator';
  const where = shellLocation(view, pathname);
  const activeNav = findActiveNav(products, view, where.navPath);
  const crumbs = breadcrumbs(activeNav, titleFor(view), where.path ? titleFor(view, where.path) : undefined, where.path);

  return (
    <>
      <Background />
      <div className="app-shell">
        <aside
          id="product-navigation"
          ref={navigationRef}
          className={navOpen ? 'sidebar sidebar--open' : 'sidebar'}
        >
          <div className="brand">
            <HiveSigil className="brand-sigil" />
            <div>
              <strong>HiveXUI</strong>
              <span>Unified Control</span>
            </div>
          </div>

          <SidebarNav products={products} active={activeNav} counts={counts} onNavigate={navigate} />

          <div className="sidebar-footer">
            <div className="sidebar-user">
              <span className="user-avatar">{initials(displayName)}</span>
              <div>
                <strong>{displayName}</strong>
                <span>{user?.roles?.join(', ') || 'Signed in'}</span>
              </div>
            </div>
            <button type="button" className="topbar-icon" aria-label="Sign out" title="Sign out" onClick={handleLogout}>
              <Icon.Logout aria-hidden="true" />
            </button>
          </div>
        </aside>

        <main className="main">
          <AuthLimitsStrip />
          <header className="topbar">
            <button
              ref={navigationToggleRef}
              aria-expanded={navOpen}
              aria-controls="product-navigation"
              className="menu-toggle"
              onClick={() => setNavOpen((open) => !open)}
              aria-label="Toggle navigation"
            >
              <Icon.Menu />
            </button>
            <Breadcrumb crumbs={crumbs} onNavigate={navigate} />
            <div className="topbar-meta">
              {showsShellStatus(view) ? (
                <span className={statusPipClass(error, failures)}>
                  <span className="pip-dot" />
                  {error ? 'Sync error' : failures > 0 ? `${failures} failures` : 'Healthy'}
                  <span aria-hidden="true">·</span>
                  {lastSync ? `Synced ${relativeTime(lastSync.toISOString())}` : 'Syncing…'}
                  <details>
                    <summary>Panels<span className="sr-only"> freshness</span></summary>
                    <div className="status-pip__panel">
                      {Object.entries(resourceFreshness).map(([key, value]) => (
                        <p key={key}>
                          {key}:{' '}
                          {value?.lastSuccess ? relativeTime(value.lastSuccess) : 'Never loaded'}
                          {value?.error ? ' · ' + value.error : ''}
                        </p>
                      ))}
                    </div>
                  </details>
                </span>
              ) : null}
              <button type="button" className="topbar-search" onClick={() => setPaletteOpen(true)} aria-keyshortcuts="Control+K Meta+K" title="Search every screen">
                <Icon.Search aria-hidden="true" />
                <span>Search<span className="sr-only"> screens</span></span>
                <kbd className="key" aria-hidden="true">{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl+K'}</kbd>
              </button>
              {showsShellRefresh(view) ? (
                <button
                  type="button"
                  className="topbar-icon"
                  aria-label="Refresh"
                  title="Refresh"
                  onClick={() => {
                    browserIdentity()?.retryConsent();
                    void refresh();
                  }}
                  disabled={refreshing}
                >
                  {refreshing ? <span className="spinner" /> : <Icon.Refresh aria-hidden="true" />}
                </button>
              ) : null}
              <SetupNudge user={user} onOpen={() => navigate('setup')} />
              <Suspense fallback={null}>
                <InboxBell subject={user?.id || 'operator'} onOpenInbox={() => navigate('inbox')} />
              </Suspense>
            </div>
          </header>

          <div className="content">
            {loading ? (
              <div className="center-load">
                <span className="spinner spinner--lg" />
              </div>
            ) : (
              <>
                {error ? (
                  <div className="sync-warning">
                    <Icon.Alert />
                    <div>
                      <strong>{error}</strong>
                      {loadIssues.length > 0 ? (
                        <span>{loadIssues.slice(0, 3).join(' · ')}</span>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => {
                        browserIdentity()?.retryConsent();
                        void refresh();
                      }}
                      disabled={refreshing}
                    >
                      {refreshing ? (
                        <span className="spinner" />
                      ) : (
                        <Icon.Refresh className="btn-ico" />
                      )}
                      Retry
                    </Button>
                  </div>
                ) : null}
                <ViewContent
                  view={view}
                  onNavigate={navigate}
                  user={user}
                  onAuthExpired={onLogout}
                />
              </>
            )}
          </div>
        </main>
        {navOpen ? (
          <div className="scrim scrim--nav" onClick={() => setNavOpen(false)} />
        ) : null}
      </div>
      {paletteOpen ? (
        <Suspense fallback={null}>
          <CommandPalette screens={screens} user={user} onNavigate={navigate} onOpen={openAddress} onClose={() => setPaletteOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
}

function statusPipClass(error: string | null, failures: number): string {
  if (error) return 'status-pip status-pip--err';
  if (failures > 0) return 'status-pip status-pip--warn';
  return 'status-pip status-pip--ok';
}

/** The page for a view, behind the product access check its route names. */
function ViewContent({
  view,
  onNavigate,
  user,
  onAuthExpired,
}: {
  view: ViewKey;
  onNavigate: (next: string, path?: string) => void;
  user: AdminUser | null;
  onAuthExpired: () => void;
}) {
  const route = routeFor(view)!;
  const Page = route.component;
  const page = (principal: AdminUser | null) => (
    <Suspense fallback={<p role="status">{route.loading ?? `Loading ${route.title}…`}</p>}>
      <Page view={view} currentUser={principal} onNavigate={onNavigate} onAuthExpired={onAuthExpired} />
    </Suspense>
  );
  // Emberpath's check applies only where Emberpath is installed, and there a denial is a real
  // error: Incidents, API Docs and Settings also work without it.
  if (route.access?.product === 'emberpath' && productInstalled('emberpath'))
    return (
      <ProductAccess product="emberpath" permission={route.access.permission} fallback={user}>
        {page}
      </ProductAccess>
    );
  if (route.access?.product === 'oathweave')
    return (
      <ProductAccess product="oathweave" fallback={user}>
        {page}
      </ProductAccess>
    );
  return page(user);
}
