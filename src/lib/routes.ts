// The one table of every screen HiveXUI shows. The sidebar, the command palette, the breadcrumb,
// page titles, deep links and the page renderer are all derived from it, so adding a screen means
// adding one entry here. Every component is a dynamic import, so this file adds no page code to the
// main chunk and tests can import it without loading any page.
import { lazy, type ComponentType } from 'react';
import type { AdminUser } from './types';
import type { Product } from './transport';
import { MAGNUS_NAV, visibleMagnusNav, type MagnusNavContext, type MagnusNavIcon } from '../modules/magnus/nav';
import { FLEET_PREFIX, toConsolePath } from '../modules/magnus/paths';
import { hasRoute, matchRoute } from '../modules/magnus/routes';
import { STUDIO_PREFIX } from '../modules/studio/paths';

export type NavIcon = MagnusNavIcon | 'Brain' | 'Messages' | 'Radar' | 'ScanSearch' | 'Workflow';

/** What a page's own API calls need. A route with neither list belongs to HiveXUI itself. */
export interface ProductGate {
  /** Every one of these must be installed. */
  all?: readonly Product[];
  /** At least one of these must be installed. */
  any?: readonly Product[];
}
export type ProductCheck = (product: Product) => boolean;

/** What every screen is given. A screen takes the props it needs and ignores the rest. */
export interface ScreenProps {
  /** The route id, so one component can serve several related routes and keep its state. */
  view: string;
  currentUser: AdminUser | null;
  onNavigate: (view: string, path?: string) => void;
  onAuthExpired: () => void;
}
export type Screen = ComponentType<ScreenProps>;
/** A page in its own chunk. The picker names the export; `default` for a module. */
const screen = <M>(load: () => Promise<M>, pick: (module: M) => Screen): Screen =>
  lazy(() => load().then((module) => ({ default: pick(module) })));

/** One sidebar and palette entry. `path` is in the route's own address space (see `ScreenRoute.path`). */
export interface NavEntry {
  label: string;
  icon: NavIcon;
  path?: string;
  /** A sub-heading inside the product, for products with several sections. */
  section?: string;
}

/**
 * A page inside a product that owns a path prefix. `path` is relative to the prefix, with `:name`
 * for a parameter: '' is the product's home, 'cases/:caseId' a record.
 */
export interface SubRoute {
  id: string;
  path: string;
  title: string;
  /** Shown in the sidebar and the palette. Records and pages reached from other pages have none. */
  nav?: { label: string; icon: NavIcon };
  /** The page the breadcrumb shows above this one. */
  parent?: string;
  load?: () => Promise<{ default: ComponentType<SubRouteProps> }>;
}
export interface SubRouteProps {
  params: Readonly<Record<string, string>>;
  search: URLSearchParams;
}

export interface ScreenRoute {
  /** The view key, and the `?page=` value for a page without a prefix. */
  id: string;
  /** The product whose API the screen calls, or `hive` for HiveXUI itself. Used by `linkTo`. */
  product: Product | 'hive';
  /** The top-bar title. */
  title: string;
  /** The sidebar heading the entry sits under. */
  group: string;
  icon: NavIcon;
  gate?: ProductGate;
  /** Sidebar entries. Absent: one entry named after the title. */
  nav?: readonly NavEntry[];
  /** Entries that depend on the Magnus session, replacing `nav`. */
  navFor?: (context: MagnusNavContext | undefined) => readonly NavEntry[];
  /**
   * The browser path the product owns. Without one, the screen lives at `/?page=<id>`.
   * `ownsQuery`: everything under the prefix is the product's, `?page=` included.
   */
  prefix?: { path: string; ownsQuery: boolean };
  /** Studio replaces the shell instead of rendering inside it. */
  fullscreen?: boolean;
  /** The old `?page=<id>` form moves to the prefix. */
  pageMovesToPrefix?: boolean;
  /** Pages of a prefixed product, when the table knows them. Magnus keeps its own table. */
  subroutes?: readonly SubRoute[];
  /** The route-relative path for a browser path: what nav entries and subroutes are written in. */
  path?: (pathname: string) => string;
  /** The browser address for a route-relative path. */
  address?: (path: string) => string;
  /** The top-bar title for a route-relative path, when a page knows better than the sidebar. */
  pageTitle?: (path: string) => string | undefined;
  /** Shows the shell's Refresh: the page reads the shared store and has no refresh of its own. */
  shellRefresh?: boolean;
  /** Shows the shell's sync status: the page's content comes from the shared store. */
  shellStatus?: boolean;
  /** The product access check the shell runs before rendering. */
  access?: { product: 'emberpath'; permission: string } | { product: 'oathweave' };
  component: Screen;
  /** Status text while the page's chunk loads. */
  loading?: string;
}

const OATHWEAVE: ProductGate = { all: ['oathweave'] };
const EMBERPATH: ProductGate = { all: ['emberpath'] };
const HIVEMEM: ProductGate = { all: ['hivemem'] };

const Iam = screen(() => import('../pages/iam'), (module) => module.IamOperationsPage);
const iam = (id: `iam-${string}`, title: string, label: string, icon: NavIcon) =>
  ({ id, product: 'oathweave', title, group: 'Oathweave', icon, gate: OATHWEAVE, nav: [{ label, icon }], access: { product: 'oathweave' }, component: Iam }) as const;
const emberpath = (id: string, title: string, icon: NavIcon, permission: string, component: Screen, shell: Pick<ScreenRoute, 'shellRefresh' | 'shellStatus'>) =>
  ({ id, product: 'emberpath', title, group: 'Emberpath', icon, gate: EMBERPATH, access: { product: 'emberpath', permission }, component, ...shell }) as const;

/** Cindertrace's pages. Their addresses are under /security-fusion. */
export const CINDERTRACE_PAGES = [
  { id: 'overview', path: '', title: 'Cindertrace', nav: { label: 'Security overview', icon: 'ScanSearch' }, load: () => import('../modules/security/pages/page') },
  { id: 'cases', path: 'cases', title: 'Cases', nav: { label: 'Cases', icon: 'ScanSearch' }, load: () => import('../modules/security/pages/cases/page') },
  { id: 'case', path: 'cases/:caseId', title: 'Detail', parent: 'cases', load: () => import('../modules/security/pages/cases/[caseId]/page') },
  { id: 'events', path: 'events', title: 'Events', nav: { label: 'Events', icon: 'Activity' }, load: () => import('../modules/security/pages/events/page') },
  { id: 'entities', path: 'entities', title: 'Entities', nav: { label: 'Entities', icon: 'Key' }, load: () => import('../modules/security/pages/entities/page') },
  { id: 'sources', path: 'sources', title: 'Sources', nav: { label: 'Sources', icon: 'Server' }, load: () => import('../modules/security/pages/sources/page') },
  { id: 'evidence', path: 'evidence', title: 'Evidence', nav: { label: 'Evidence', icon: 'FileText' }, load: () => import('../modules/security/pages/evidence/page') },
  { id: 'policies', path: 'policies', title: 'Policies', nav: { label: 'Policies', icon: 'Scroll' }, load: () => import('../modules/security/pages/policies/page') },
  { id: 'audit', path: 'audit', title: 'Security audit', nav: { label: 'Security audit', icon: 'Shield' }, load: () => import('../modules/security/pages/audit/page') },
  { id: 'lab', path: 'lab', title: 'Lab', parent: 'overview', load: () => import('../modules/security/pages/lab/page') },
] as const satisfies readonly SubRoute[];
export const SECURITY_PREFIX = '/security-fusion';

/** Ardent Project Studio's entry points. Studio routes everything under /studio itself. */
export const STUDIO_PAGES = [
  { id: 'projects', path: '', title: 'Projects', nav: { label: 'Projects', icon: 'Workflow' } },
  { id: 'gallery', path: 'gallery', title: 'Gallery', nav: { label: 'Gallery', icon: 'Library' } },
] as const satisfies readonly SubRoute[];

const prefixed = (prefix: string, pages: readonly SubRoute[]): NavEntry[] =>
  pages.flatMap((page) => (page.nav ? [{ ...page.nav, path: joinPath(prefix, page.path) }] : []));

export const ROUTES = [
  { id: 'hive', product: 'hive', title: 'Hive', group: 'Hive', icon: 'Dashboard', nav: [{ label: 'Installation', icon: 'Dashboard' }],
    component: screen(() => import('../modules/suite'), (module) => module.default), loading: 'Checking products…' },
  // Correlates failures from whichever of these products is present; each source is optional.
  { id: 'incidents', product: 'hive', title: 'Hive incidents', group: 'Hive', icon: 'Alert', gate: { any: ['emberpath', 'oathweave', 'hivemem'] },
    access: { product: 'emberpath', permission: 'router:admin:read' }, shellStatus: true,
    component: screen(() => import('../pages/incidents'), (module) => module.IncidentsPage) },
  { id: 'magnus', product: 'magnus', title: 'Magnus', group: 'Magnus', icon: 'Radar', gate: { all: ['magnus'] },
    prefix: { path: FLEET_PREFIX, ownsQuery: true }, pageMovesToPrefix: true,
    navFor: (context) => (context ? visibleMagnusNav(context) : MAGNUS_NAV).flatMap((section) => section.items.map((item) => ({ label: item.label, icon: item.icon, path: item.path, section: section.label }))),
    path: toConsolePath, address: (path) => (path === '/' ? FLEET_PREFIX : FLEET_PREFIX + path), pageTitle: (path) => matchRoute(path)?.route.title,
    component: screen(() => import('../modules/magnus'), (module) => module.default), loading: 'Loading Magnus…' },
  // Its entries open the fullscreen page at /studio, so they never become the current page in the shell.
  { id: 'studio', product: 'ardentstudio', title: 'Studio', group: 'Studio', icon: 'Workflow', gate: { all: ['ardentstudio'] },
    prefix: { path: STUDIO_PREFIX, ownsQuery: true }, fullscreen: true, subroutes: STUDIO_PAGES, nav: prefixed(STUDIO_PREFIX, STUDIO_PAGES),
    component: screen(() => import('../modules/studio'), (module) => module.default) },
  iam('iam-overview', 'IAM Overview', 'Overview', 'Dashboard'),
  { id: 'account', product: 'oathweave', title: 'Account security', group: 'Oathweave', icon: 'Key', gate: OATHWEAVE,
    component: screen(() => import('../modules/account'), (module) => module.default), loading: 'Loading account security…' },
  iam('iam-users', 'IAM Users', 'Users', 'Key'),
  iam('iam-roles', 'IAM Roles', 'Roles', 'Scroll'),
  iam('iam-service-accounts', 'IAM Service Accounts', 'Service Accounts', 'Server'),
  iam('iam-clients', 'IAM Clients', 'Clients', 'Route'),
  iam('iam-sessions', 'IAM Sessions', 'Sessions', 'Activity'),
  iam('iam-system-users', 'IAM System Users', 'System Users', 'Settings'),
  iam('iam-security', 'IAM Security', 'Security', 'Shield'),
  iam('iam-audit', 'Identity audit', 'Identity audit', 'Book'),
  // The browser only calls Oathweave, but every enrollment links an Emberpath key and a HiveMem
  // agent; the coordinator is unusable without both.
  { id: 'actors', product: 'oathweave', title: 'Actors', group: 'Oathweave', icon: 'Key', gate: { all: ['oathweave', 'emberpath', 'hivemem'] },
    access: { product: 'oathweave' }, shellStatus: true, component: screen(() => import('../pages/actors'), (module) => module.ActorsPage) },
  emberpath('routers', 'Routers', 'Dashboard', 'router:routing:read', screen(() => import('../pages/routers'), (module) => module.RoutersPage), { shellRefresh: true, shellStatus: true }),
  emberpath('providers', 'Providers', 'Server', 'router:providers:read', screen(() => import('../pages/providers'), (module) => module.ProvidersPage), { shellRefresh: true, shellStatus: true }),
  emberpath('routing', 'Routing', 'Workflow', 'router:routing:read', screen(() => import('../pages/routing'), (module) => module.RoutingPage), { shellRefresh: true, shellStatus: true }),
  emberpath('testing', 'Testing', 'Hexagon', 'router:testing:read', screen(() => import('../pages/testing'), (module) => module.TestingPage), { shellRefresh: true, shellStatus: true }),
  emberpath('traces', 'Traces', 'Activity', 'router:admin:read', screen(() => import('../pages/traces'), (module) => module.TracesPage), { shellStatus: true }),
  emberpath('keys', 'API Keys', 'Key', 'router:keys:read', screen(() => import('../pages/keys'), (module) => module.KeysPage), { shellRefresh: true, shellStatus: true }),
  emberpath('audit', 'Routing audit', 'Scroll', 'router:admin:read', screen(() => import('../pages/audit'), (module) => module.AuditPage), { shellStatus: true }),
  { id: 'memories', product: 'hivemem', title: 'Memories', group: 'HiveMem', icon: 'Brain', gate: HIVEMEM,
    component: screen(() => import('../pages/memory-dashboard'), (module) => module.MemoriesScreen) },
  { id: 'workspaces', product: 'hivemem', title: 'Workspaces', group: 'HiveMem', icon: 'Library', gate: HIVEMEM,
    component: screen(() => import('../modules/workspaces'), (module) => module.WorkspacesScreen) },
  { id: 'skills', product: 'hiveskills', title: 'Skills and assignments', group: 'HiveSkills', icon: 'Puzzle', gate: { all: ['hiveskills'] },
    nav: [{ label: 'HiveSkills', icon: 'Puzzle' }], component: screen(() => import('../modules/skills'), (module) => module.default), loading: 'Loading skills…' },
  { id: 'embermend', product: 'embermend', title: 'Embermend', group: 'Embermend', icon: 'Shield', gate: { all: ['embermend'] },
    nav: [{ label: 'Recommendations', icon: 'Shield' }], component: screen(() => import('../modules/embermend'), (module) => module.default), loading: 'Loading recommendations…' },
  // Cindertrace also uses ?page= for its own pagination, but an available ?page= view wins over its path.
  { id: 'security', product: 'cindertrace', title: 'Cindertrace', group: 'Cindertrace', icon: 'ScanSearch', gate: { all: ['cindertrace'] },
    prefix: { path: SECURITY_PREFIX, ownsQuery: false }, subroutes: CINDERTRACE_PAGES, nav: prefixed(SECURITY_PREFIX, CINDERTRACE_PAGES),
    // ?page=security has always opened the overview at the root address.
    path: (pathname) => (underPrefix(pathname, SECURITY_PREFIX) ? pathname.replace(/\/+$/, '') : SECURITY_PREFIX),
    pageTitle: (path) => matchSubroute(SECURITY_PREFIX, CINDERTRACE_PAGES, path)?.page.title,
    component: screen(() => import('../modules/security'), (module) => module.default), loading: 'Loading security…' },
  { id: 'chat', product: 'chattermost', title: 'ChatterMost', group: 'ChatterMost', icon: 'Messages', gate: { all: ['chattermost'] },
    component: screen(() => import('../modules/chat'), (module) => module.default), loading: 'Loading chat…' },
  // Both show installation-level content; their Emberpath panels appear only with Emberpath.
  { id: 'docs', product: 'hive', title: 'API Docs', group: 'System', icon: 'Book', access: { product: 'emberpath', permission: 'router:admin:read' },
    shellRefresh: true, shellStatus: true, component: screen(() => import('../pages/docs'), (module) => module.DocsPage) },
  { id: 'settings', product: 'hive', title: 'Settings', group: 'System', icon: 'Settings', access: { product: 'emberpath', permission: 'router:settings:read' },
    shellRefresh: true, shellStatus: true, component: screen(() => import('../pages/settings'), (module) => module.SettingsScreen) },
] as const satisfies readonly ScreenRoute[];

export type ViewKey = (typeof ROUTES)[number]['id'];
export type IamViewKey = Extract<ViewKey, `iam-${string}`>;

const BY_ID = new Map<string, ScreenRoute>(ROUTES.map((route) => [route.id, route]));
/** The route for a view key; undefined for anything else, `constructor` included. */
export const routeFor = (view: string): ScreenRoute | undefined => BY_ID.get(view);

export function gateOpen(gate: ProductGate | undefined, installed: ProductCheck): boolean {
  return (gate?.all ?? []).every(installed) && (!gate?.any || gate.any.some(installed));
}

export const underPrefix = (pathname: string, prefix: string): boolean => pathname === prefix || pathname.startsWith(prefix + '/');
/** The route-relative path of a browser path. */
export const routePath = (route: ScreenRoute, pathname: string): string => (route.path ? route.path(pathname) : pathname);
/** The browser address of a route-relative path. */
export const routeAddress = (route: ScreenRoute, path?: string): string => {
  if (path === undefined) return route.prefix ? route.prefix.path : `/?page=${route.id}`;
  return route.address ? route.address(path) : path;
};

function joinPath(prefix: string, path: string): string {
  return path ? `${prefix}/${path}` : prefix;
}
function matchPattern(pattern: string, segments: readonly string[]): Record<string, string> | null {
  const parts = pattern.split('/').filter(Boolean);
  if (parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (const [index, part] of parts.entries()) {
    const segment = segments[index]!;
    if (part.startsWith(':')) {
      try {
        params[part.slice(1)] = decodeURIComponent(segment);
      } catch {
        return null;
      }
    } else if (part !== segment) return null;
  }
  return params;
}
/** The page of a prefixed product at a browser path. Literal paths win over parameters. */
export function matchSubroute<P extends SubRoute>(prefix: string, pages: readonly P[], pathname: string): { page: P; params: Record<string, string> } | null {
  if (!underPrefix(pathname, prefix)) return null;
  const segments = pathname.slice(prefix.length).split('/').filter(Boolean);
  const ordered = [...pages.filter((page) => !page.path.includes(':')), ...pages.filter((page) => page.path.includes(':'))];
  for (const page of ordered) {
    const params = matchPattern(page.path, segments);
    if (params) return { page, params };
  }
  return null;
}

/** Screens of each product that `linkTo` can address. */
export interface LinkScreens {
  hive: Extract<(typeof ROUTES)[number], { product: 'hive' }>['id'];
  oathweave: Extract<(typeof ROUTES)[number], { product: 'oathweave' }>['id'];
  emberpath: Extract<(typeof ROUTES)[number], { product: 'emberpath' }>['id'];
  hivemem: Extract<(typeof ROUTES)[number], { product: 'hivemem' }>['id'];
  hiveskills: 'skills';
  embermend: 'embermend';
  chattermost: 'chat';
  cindertrace: (typeof CINDERTRACE_PAGES)[number]['id'];
  ardentstudio: (typeof STUDIO_PAGES)[number]['id'];
  /** A Magnus page's console path, with `:name` parameters: '/nodes/:nodeId'. */
  magnus: string;
}
export type LinkParams = Readonly<Record<string, string | number>>;

function fill(pattern: string, params: LinkParams): { path: string; rest: [string, string][] } {
  const used = new Set<string>();
  const path = pattern
    .split('/')
    .map((part) => {
      if (!part.startsWith(':')) return part;
      const name = part.slice(1);
      const value = params[name];
      if (value === undefined || value === '') throw new Error(`Missing link parameter: ${name}`);
      used.add(name);
      return encodeURIComponent(String(value));
    })
    .join('/');
  return { path, rest: Object.entries(params).filter(([name]) => !used.has(name)).map(([name, value]) => [name, String(value)]) };
}
const withQuery = (path: string, query: ReadonlyArray<[string, string]>): string =>
  query.length ? `${path}?${new URLSearchParams(query as [string, string][]).toString()}` : path;

/**
 * The address of a screen of any product, for links between products. Path parameters fill
 * `:name` segments; the rest become the query. Throws for a screen the table does not know.
 *
 *   linkTo('emberpath', 'providers')                   -> '/?page=providers'
 *   linkTo('cindertrace', 'case', { caseId: 'c1' })    -> '/security-fusion/cases/c1'
 *   linkTo('magnus', '/nodes/:nodeId', { nodeId: 'n' }) -> '/fleet/nodes/n'
 */
export function linkTo<P extends keyof LinkScreens>(product: P, screen: LinkScreens[P], params: LinkParams = {}): string {
  if (product === 'magnus') {
    if (!hasRoute(screen.replace(/:[^/]+/g, 'x'))) throw new Error(`Unknown Magnus page: ${screen}`);
    const { path, rest } = fill(screen, params);
    return withQuery(routeAddress(routeFor('magnus')!, path || '/'), rest);
  }
  const owner = ROUTES.find((route) => route.product === product && 'subroutes' in route);
  if (owner && 'subroutes' in owner) {
    const page = (owner.subroutes as readonly SubRoute[]).find((entry) => entry.id === screen);
    if (!page) throw new Error(`Unknown ${product} screen: ${screen}`);
    const { path, rest } = fill(page.path, params);
    return withQuery(joinPath(owner.prefix.path, path), rest);
  }
  const route = routeFor(screen);
  if (!route || route.product !== product) throw new Error(`Unknown ${product} screen: ${screen}`);
  if (route.prefix) return withQuery(route.prefix.path, Object.entries(params).map(([name, value]) => [name, String(value)]));
  return withQuery('/', [['page', route.id], ...Object.entries(params).map(([name, value]): [string, string] => [name, String(value)])]);
}

/** Follows an address inside HiveXUI without reloading: the shell and modules listen for popstate. */
export function navigateTo(href: string, mode: 'push' | 'replace' = 'push'): void {
  if (!href.startsWith('/') || href.startsWith('//') || /[\\\s\u0000-\u001f]/.test(href)) throw new Error('Not an address inside HiveXUI');
  if (mode === 'push') history.pushState(null, '', href);
  else history.replaceState(null, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
