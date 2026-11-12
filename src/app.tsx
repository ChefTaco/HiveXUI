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
const EmbermendModule = lazy(() => import('./modules/embermend'));
const SecurityModule = lazy(() => import('./modules/security'));
const MagnusModule = lazy(() => import('./modules/magnus'));
const StudioModule = lazy(() => import('./modules/studio'));
const ChatInviteRedemption = lazy(() => import('./modules/chat/invite-redemption'));
const ChatModule = lazy(() => import('./modules/chat'));
const SkillsModule = lazy(() => import('./modules/skills'));
const WorkspacesModule = lazy(() => import('./modules/workspaces'));
import { MemoryAccess } from './components/memory-access';
const AccountModule = lazy(() => import('./modules/account'));
const SuiteOverview = lazy(() => import('./modules/suite'));
const CommandPalette = lazy(() => import('./components/command-palette'));
const NotificationBell = lazy(() => import('./modules/magnus/shell/notification-bell'));
import { ProductAccess } from './components/product-access';
import { adminApi, ApiError } from './lib/api';
import { MfaRequired } from './lib/browser-auth';
import { parsePortalAuthorization } from './lib/authorization-portal';
import {
  breadcrumbs,
  findActiveNav,
  magnusAddress,
  navProducts,
  paletteScreens,
  resolveDeepLink,
  showsShellRefresh,
  showsShellStatus,
  viewAvailable,
  visibleNavGroups,
  type IamViewKey,
  type ViewKey,
} from './lib/navigation';
import { activeMagnusNavPath, type MagnusNavContext } from './modules/magnus/nav';
import { isFleetPath, toConsolePath } from './modules/magnus/paths';
import { matchRoute } from './modules/magnus/routes';
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
import { initials, relativeTime } from './lib/format';
import { ProvidersPage } from './pages/providers';
import { RoutingPage } from './pages/routing';
import { TestingPage } from './pages/testing';
import { TracesPage } from './pages/traces';
import { KeysPage } from './pages/keys';
import { AuditPage } from './pages/audit';
import { DocsPage } from './pages/docs';
import { InstallationSettingsPage, SettingsPage } from './pages/settings';
import { HiveOverviewPage } from './pages/hive-apps';
import { IamOperationsPage, type IamSection } from './pages/iam-operations';
import { MemoryDashboardPage } from './pages/memory-dashboard';
import { RoutersPage } from './pages/routers';
import { ActorsPage } from './pages/actors';
import { IncidentsPage } from './pages/incidents';
import { Button, buttonClass } from '@ui';

type AuthState = 'checking' | 'unauthed' | 'authed';

const IAM_VIEW_SECTIONS: Record<IamViewKey, IamSection> = {
  'iam-overview': 'overview',
  'iam-users': 'users',
  'iam-roles': 'roles',
  'iam-service-accounts': 'service-accounts',
  'iam-clients': 'clients',
  'iam-sessions': 'sessions',
  'iam-system-users': 'system-users',
  'iam-security': 'security',
  'iam-audit': 'audit',
};

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
 * Studio is a fullscreen page: under /studio, and only while it is installed, it replaces the shell
 * rather than rendering inside it. Every other address is the console. Each one reads its state from
 * the address when it mounts, so moving between them needs nothing else.
 */
function SignedIn({ user, onLogout }: { user: AdminUser | null; onLogout: () => void }) {
  const pathname = useSyncExternalStore(subscribeLocation, currentPath);
  // The Registry may answer late and remove Studio; this re-reads the gate when it does.
  useRegistry();
  if (isStudioPath(pathname) && viewAvailable('studio', productInstalled))
    return (
      <Suspense fallback={<><Background /><div className="center-load"><span className="spinner spinner--lg" /></div></>}>
        <StudioModule onAuthExpired={onLogout} />
      </Suspense>
    );
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
            <div className="error-banner">
              <Icon.Alert />
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
  const [magnusPath, setMagnusPath] = useState(() => toConsolePath(location.pathname));
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
  // The module's links and browser history both end here. Only movement into or out of /fleet
  // changes the view: other modules keep their own history handling, as they always have.
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const sync = () => {
      const path = location.pathname;
      setPathname(path);
      setMagnusPath(toConsolePath(path));
      if (!isFleetPath(path) && viewRef.current !== 'magnus') return;
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

  function navigate(requested: string, path?: string) {
    // Studio opens over the console and returns here when it closes.
    if (requested === 'studio' && viewAvailable('studio', productInstalled)) {
      setNavOpen(false);
      setPaletteOpen(false);
      openStudio(path);
      return;
    }
    const next: ViewKey = viewAvailable(requested, productInstalled)
      ? requested
      : 'hive';
    setView(next);
    setNavOpen(false);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('.topbar .title')?.focus(),
    );
    if (next === 'magnus') {
      history.pushState(null, '', magnusAddress(path ?? '/'));
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    if (next === 'security' && path) {
      history.pushState(null, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    const url = new URL(location.href);
    // Leaving /fleet is a real move in history: Back returns to the Magnus page.
    const leavingFleet = isFleetPath(url.pathname);
    if (leavingFleet) {
      url.pathname = '/';
      url.search = '';
      url.hash = '';
    }
    url.searchParams.set('page', next);
    if (leavingFleet) {
      history.pushState(null, '', url);
      setMagnusPath('/');
    } else history.replaceState(null, '', url);
  }

  const failures = data.telemetry?.totals.failures ?? 0;
  const displayName = user?.displayName ?? user?.username ?? 'Operator';
  const activeNav = findActiveNav(products, view, view === 'magnus' ? activeMagnusNavPath(magnusPath) : null);
  const crumbs = breadcrumbs(
    activeNav,
    titleFor(view),
    view === 'magnus' ? (matchRoute(magnusPath)?.route.title ?? 'Magnus') : undefined,
    view === 'magnus' ? magnusPath : pathname,
  );

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
                    <summary aria-label="Panel freshness">Panels</summary>
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
              <button type="button" className="topbar-search" onClick={() => setPaletteOpen(true)} aria-label="Search screens" aria-keyshortcuts="Control+K Meta+K" title="Search every screen">
                <Icon.Search aria-hidden="true" />
                <span>Search</span>
                <kbd className="key">{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl+K'}</kbd>
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
              {magnusNav.role ? (
                <Suspense fallback={null}>
                  <NotificationBell onOpenInbox={() => navigate('magnus', '/notifications')} />
                </Suspense>
              ) : null}
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
          <CommandPalette screens={screens} onNavigate={navigate} onClose={() => setPaletteOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
}

function titleFor(view: ViewKey): string {
  const map: Record<ViewKey, string> = {
    magnus: 'Magnus',
    studio: 'Studio',
    account: 'Account security',
    security: 'Cindertrace',
    embermend: 'Embermend',
    chat: 'ChatterMost',
    hive: 'Hive',
    'iam-overview': 'IAM Overview',
    'iam-users': 'IAM Users',
    'iam-roles': 'IAM Roles',
    'iam-service-accounts': 'IAM Service Accounts',
    'iam-clients': 'IAM Clients',
    'iam-sessions': 'IAM Sessions',
    'iam-system-users': 'IAM System Users',
    'iam-security': 'IAM Security',
    'iam-audit': 'Identity audit',
    memories: 'Memories',
    workspaces: 'Workspaces',
    skills: 'Skills and assignments',
    actors: 'Actors',
    routers: 'Routers',
    providers: 'Providers',
    routing: 'Routing',
    testing: 'Testing',
    traces: 'Traces',
    incidents: 'Hive incidents',
    keys: 'API Keys',
    audit: 'Routing audit',
    docs: 'API Docs',
    settings: 'Settings',
  };
  return map[view];
}

function statusPipClass(error: string | null, failures: number): string {
  if (error) return 'status-pip status-pip--err';
  if (failures > 0) return 'status-pip status-pip--warn';
  return 'status-pip status-pip--ok';
}

function ViewContent({
  view,
  onNavigate,
  user,
  onAuthExpired,
}: {
  view: ViewKey;
  onNavigate: (next: string) => void;
  user: AdminUser | null;
  onAuthExpired: () => void;
}) {
  if (view === 'magnus')
    return (
      <Suspense fallback={<p role="status">Loading Magnus…</p>}>
        <MagnusModule onAuthExpired={onAuthExpired} />
      </Suspense>
    );
  const models: Partial<Record<ViewKey, string>> = {
    routers: 'router:routing:read',
    providers: 'router:providers:read',
    routing: 'router:routing:read',
    testing: 'router:testing:read',
    traces: 'router:admin:read',
    incidents: 'router:admin:read',
    keys: 'router:keys:read',
    audit: 'router:admin:read',
    docs: 'router:admin:read',
    settings: 'router:settings:read',
  };
  // Incidents, API Docs and Settings also work without Emberpath; its access check
  // applies only where Emberpath is installed, and there a denial is a real error.
  if (models[view] && productInstalled('emberpath'))
    return (
      <ProductAccess
        product="emberpath"
        permission={models[view]}
        fallback={user}
      >
        {(principal) => renderView(view, onNavigate, principal)}
      </ProductAccess>
    );
  if (view.startsWith('iam-') || view === 'actors')
    return (
      <ProductAccess product="oathweave" fallback={user}>
        {(principal) => renderView(view, onNavigate, principal)}
      </ProductAccess>
    );
  return renderView(view, onNavigate, user);
}

function renderView(
  view: ViewKey,
  onNavigate: (next: string) => void,
  user: AdminUser | null,
) {
  switch (view) {
    case 'skills':
      return (
        <Suspense fallback={<p role="status">Loading skills…</p>}>
          <SkillsModule currentUser={user} />
        </Suspense>
      );
    case 'account':
      return (
        <Suspense fallback={<p role="status">Loading account security…</p>}>
          <AccountModule />
        </Suspense>
      );
    case 'embermend':
      return <Suspense fallback={<p role="status">Loading recommendations…</p>}><EmbermendModule /></Suspense>;
    case 'security':
      return (
        <Suspense fallback={<p role="status">Loading security…</p>}>
          <SecurityModule />
        </Suspense>
      );
    case 'chat':
      return (
        <Suspense fallback={<p role="status">Loading chat…</p>}>
          <ChatModule />
        </Suspense>
      );
    case 'hive':
      return browserIdentity() ? (
        <Suspense fallback={<p role="status">Checking products…</p>}>
          <SuiteOverview />
        </Suspense>
      ) : (
        <HiveOverviewPage onNavigate={onNavigate} />
      );
    case 'iam-overview':
    case 'iam-users':
    case 'iam-roles':
    case 'iam-service-accounts':
    case 'iam-clients':
    case 'iam-sessions':
    case 'iam-system-users':
    case 'iam-security':
    case 'iam-audit':
      return (
        <IamOperationsPage
          section={IAM_VIEW_SECTIONS[view]}
          onNavigate={onNavigate}
          currentUser={user}
        />
      );
    case 'workspaces':
      return <MemoryAccess>{profile => <WorkspacesModule profile={profile} />}</MemoryAccess>;
    case 'memories':
      return browserIdentity() ? <MemoryAccess>{profile => <MemoryDashboardPage currentUser={user} profile={profile} />}</MemoryAccess> : <MemoryDashboardPage currentUser={user} />;
    case 'actors':
      return <ActorsPage currentUser={user} />;
    case 'routers':
      return <RoutersPage onNavigate={onNavigate} />;
    case 'providers':
      return <ProvidersPage currentUser={user} />;
    case 'routing':
      return <RoutingPage currentUser={user} />;
    case 'testing':
      return <TestingPage currentUser={user} />;
    case 'traces':
      return <TracesPage />;
    case 'incidents':
      return <IncidentsPage />;
    case 'keys':
      return <KeysPage currentUser={user} />;
    case 'audit':
      return <AuditPage />;
    case 'docs':
      return <DocsPage onNavigate={onNavigate} />;
    case 'settings':
      return productInstalled('emberpath') ? (
        <SettingsPage currentUser={user} />
      ) : (
        <InstallationSettingsPage />
      );
    default:
      return null;
  }
}
