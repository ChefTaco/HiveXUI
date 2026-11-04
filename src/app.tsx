import { clearAccess } from './lib/transport';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
const SecurityModule = lazy(() => import('./modules/security'));
const ChatModule = lazy(() => import('./modules/chat'));
import { adminApi, ApiError } from './lib/api';
import { MfaRequired } from './lib/browser-auth';
import { browserIdentity } from './lib/runtime';
import type { AdminUser } from './lib/types';
import { StoreProvider, useStore } from './lib/store';
import { Icon, HiveSigil } from './components/icons';
import { initials, relativeTime } from './lib/format';
import { ProvidersPage } from './pages/providers';
import { RoutingPage } from './pages/routing';
import { TestingPage } from './pages/testing';
import { TracesPage } from './pages/traces';
import { KeysPage } from './pages/keys';
import { AuditPage } from './pages/audit';
import { DocsPage } from './pages/docs';
import { SettingsPage } from './pages/settings';
import { HiveOverviewPage } from './pages/hive-apps';
import { IamOperationsPage, type IamSection } from './pages/iam-operations';
import { MemoryDashboardPage } from './pages/memory-dashboard';
import { RoutersPage } from './pages/routers';
import { ActorsPage } from './pages/actors';
import { IncidentsPage } from './pages/incidents';
import type { ReactElement, SVGProps } from 'react';

type IamViewKey =
  | 'iam-overview'
  | 'iam-users'
  | 'iam-roles'
  | 'iam-service-accounts'
  | 'iam-clients'
  | 'iam-sessions'
  | 'iam-system-users'
  | 'iam-security'
  | 'iam-audit';
type ViewKey =
  | 'chat'
  | 'security'
  | 'hive'
  | IamViewKey
  | 'memories'
  | 'actors'
  | 'routers'
  | 'providers'
  | 'routing'
  | 'testing'
  | 'traces'
  | 'incidents'
  | 'keys'
  | 'audit'
  | 'docs'
  | 'settings';
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

interface NavItem {
  key: ViewKey;
  label: string;
  icon: (p: SVGProps<SVGSVGElement>) => ReactElement;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Hive:Magnus',
    items: [{ key: 'hive', label: 'Hive', icon: Icon.Hexagon }],
  },
  {
    label: 'Oathweave',
    items: [
      { key: 'iam-overview', label: 'Overview', icon: Icon.Gauge },
      { key: 'iam-users', label: 'Users', icon: Icon.Key },
      { key: 'iam-roles', label: 'Roles', icon: Icon.Scroll },
      {
        key: 'iam-service-accounts',
        label: 'Service Accounts',
        icon: Icon.Server,
      },
      { key: 'iam-clients', label: 'Clients', icon: Icon.Route },
      { key: 'iam-sessions', label: 'Sessions', icon: Icon.Activity },
      { key: 'iam-system-users', label: 'System Users', icon: Icon.Settings },
      { key: 'iam-security', label: 'Security', icon: Icon.Alert },
      { key: 'iam-audit', label: 'Audit', icon: Icon.Book },
    ],
  },
  {
    label: 'Memory',
    items: [
      { key: 'memories', label: 'Memories', icon: Icon.Activity },
      { key: 'actors', label: 'Actors', icon: Icon.Key },
    ],
  },
  {
    label: 'Emberpath',
    items: [
      { key: 'routers', label: 'Routers', icon: Icon.Gauge },
      { key: 'providers', label: 'Providers', icon: Icon.Server },
      { key: 'routing', label: 'Routing', icon: Icon.Route },
      { key: 'testing', label: 'Testing', icon: Icon.Hexagon },
    ],
  },
  {
    label: 'Observability',
    items: [
      { key: 'security', label: 'Cindertrace', icon: Icon.Alert },
      { key: 'chat', label: 'ChatterMost', icon: Icon.Activity },
      { key: 'traces', label: 'Traces', icon: Icon.Activity },
      { key: 'incidents', label: 'Incidents', icon: Icon.Alert },
      { key: 'audit', label: 'Audit Log', icon: Icon.Scroll },
    ],
  },
  {
    label: 'System',
    items: [
      { key: 'keys', label: 'API Keys', icon: Icon.Key },
      { key: 'docs', label: 'API Docs', icon: Icon.Book },
      { key: 'settings', label: 'Settings', icon: Icon.Settings },
    ],
  },
];

export function App() {
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
      <LoginScreen
        onSuccess={(loggedIn) => {
          setUser(loggedIn);
          setAuth('authed');
        }}
      />
    );
  }

  return (
    <StoreProvider onAuthExpired={handleAuthExpired}>
      <Shell user={user} onLogout={handleAuthExpired} />
    </StoreProvider>
  );
}

function Background() {
  return (
    <>
      <div className="honeycomb-bg" aria-hidden />
      <div className="atmosphere" aria-hidden />
      <div className="scanline" aria-hidden />
    </>
  );
}

/* ===================== Login ===================== */

function LoginScreen({ onSuccess }: { onSuccess: (user: AdminUser) => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<MfaRequired | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const identity = browserIdentity();
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
          <h1>Control Plane Console</h1>
          <p className="login-sub">
            Authenticate to manage identity, memory, and routing.
          </p>

          {error ? (
            <div className="error-banner">
              <Icon.Alert />
              {error}
            </div>
          ) : null}

          {!challenge ? (
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

          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? (
              <span className="spinner" />
            ) : (
              <Icon.Key className="btn-ico" />
            )}
            {challenge ? 'Verify and sign in' : 'Sign in'}
          </button>
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
  const [view, setView] = useState<ViewKey>(() => {
    const page = new URLSearchParams(location.search).get('page');
    return (
      NAV_GROUPS.flatMap((group) => group.items).find(
        (item) => item.key === page,
      )?.key ??
      (location.pathname.startsWith('/security-fusion') ? 'security' : 'hive')
    );
  });
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

  function navigate(next: ViewKey) {
    setView(next);
    setNavOpen(false);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('.topbar .title')?.focus(),
    );
    const url = new URL(location.href);
    url.searchParams.set('page', next);
    history.replaceState(null, '', url);
    setNavOpen(false);
  }

  const failures = data.telemetry?.totals.failures ?? 0;
  const displayName = user?.displayName ?? user?.username ?? 'Operator';

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

          <nav className="nav">
            {NAV_GROUPS.map((group) => (
              <div className="nav-group" key={group.label}>
                <p className="nav-group-label">{group.label}</p>
                {group.items.map((item) => {
                  const ItemIcon = item.icon;
                  const count = counts[item.key];
                  return (
                    <button
                      key={item.key}
                      className={
                        view === item.key
                          ? 'nav-item nav-item--active'
                          : 'nav-item'
                      }
                      onClick={() => navigate(item.key)}
                    >
                      <ItemIcon width={18} height={18} />
                      <span>{item.label}</span>
                      {typeof count === 'number' && count > 0 ? (
                        <span className="nav-count">{count}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="sidebar-footer">
            <div className="sidebar-user">
              <span className="user-avatar">{initials(displayName)}</span>
              <div>
                <strong>{displayName}</strong>
                <span>Administrator</span>
              </div>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={handleLogout}>
              <Icon.Logout className="btn-ico" />
              Sign out
            </button>
          </div>
        </aside>

        <main className="main">
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
            <div className="topbar-lead">
              <p className="eyebrow">Control Plane</p>
              <h1 className="title" tabIndex={-1}>
                {titleFor(view)}
              </h1>
            </div>
            <div className="topbar-meta">
              <span className={statusPipClass(error, failures)}>
                <span className="pip-dot" />
                {error
                  ? 'Sync error'
                  : failures > 0
                    ? `${failures} failures`
                    : 'Healthy'}
              </span>
              <span className="status-pip">
                <span className="pip-dot" />
                {lastSync
                  ? `Synced ${relativeTime(lastSync.toISOString())}`
                  : 'Syncing…'}
                <details>
                  <summary>Panel freshness</summary>
                  {Object.entries(resourceFreshness).map(([key, value]) => (
                    <p key={key}>
                      {key}:{' '}
                      {value?.lastSuccess
                        ? relativeTime(value.lastSuccess)
                        : 'Never loaded'}
                      {value?.error ? ' · ' + value.error : ''}
                    </p>
                  ))}
                </details>
              </span>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => void refresh()}
                disabled={refreshing}
              >
                {refreshing ? (
                  <span className="spinner" />
                ) : (
                  <Icon.Refresh className="btn-ico" />
                )}
                Refresh
              </button>
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
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => void refresh()}
                      disabled={refreshing}
                    >
                      {refreshing ? (
                        <span className="spinner" />
                      ) : (
                        <Icon.Refresh className="btn-ico" />
                      )}
                      Retry
                    </button>
                  </div>
                ) : null}
                {renderView(
                  view,
                  (next: string) => navigate(next as ViewKey),
                  user,
                )}
              </>
            )}
          </div>
        </main>
      </div>
      {navOpen ? (
        <div className="scrim scrim--nav" onClick={() => setNavOpen(false)} />
      ) : null}
    </>
  );
}

function titleFor(view: ViewKey): string {
  const map: Record<ViewKey, string> = {
    security: 'Cindertrace',
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
    'iam-audit': 'IAM Audit',
    memories: 'Memories',
    actors: 'Actors',
    routers: 'Routers',
    providers: 'Providers',
    routing: 'Routing',
    testing: 'Testing',
    traces: 'Traces',
    incidents: 'Incidents',
    keys: 'API Keys',
    audit: 'Audit Log',
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

function renderView(
  view: ViewKey,
  onNavigate: (next: string) => void,
  user: AdminUser | null,
) {
  switch (view) {
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
      return <HiveOverviewPage onNavigate={onNavigate} />;
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
    case 'memories':
      return <MemoryDashboardPage currentUser={user} />;
    case 'actors':
      return <ActorsPage currentUser={user} />;
    case 'routers':
      return <RoutersPage onNavigate={onNavigate} />;
    case 'providers':
      return <ProvidersPage currentUser={user} />;
    case 'routing':
      return <RoutingPage currentUser={user} />;
    case 'testing':
      return <TestingPage />;
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
      return <SettingsPage currentUser={user} />;
    default:
      return null;
  }
}
