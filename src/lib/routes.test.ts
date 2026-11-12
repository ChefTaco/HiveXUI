import { describe, expect, it } from 'vitest';
import {
  findActiveNav,
  navProducts,
  resolveDeepLink,
  shellLocation,
  titleFor,
  viewAddress,
  viewAvailable,
  visibleNavGroups,
  type ProductCheck,
  type ViewKey,
} from './navigation';
import { CINDERTRACE_PAGES, linkTo, matchSubroute, ROUTES, routeFor, SECURITY_PREFIX, underPrefix } from './routes';
import { matchRoute } from '../modules/magnus/routes';

const EVERYTHING: ProductCheck = () => true;
const BASE = 'https://hive.example.com';

/** Where an address lands, the way the shell and the modules choose: view, then the page inside it. */
function land(href: string, installed: ProductCheck = EVERYTHING) {
  const { pathname, search } = new URL(href, BASE);
  const { view, url } = resolveDeepLink({ pathname, search }, installed);
  // The shell hands an address under a fullscreen prefix to that product before it ever renders.
  const fullscreen = ROUTES.find((route) => 'fullscreen' in route && underPrefix(pathname, route.prefix.path) && viewAvailable(route.id, installed));
  if (fullscreen) return { screen: fullscreen.id, url };
  const where = shellLocation(view, pathname);
  const page =
    view === 'security' ? matchSubroute(SECURITY_PREFIX, CINDERTRACE_PAGES, where.path)?.page.id
    : view === 'magnus' ? matchRoute(where.path)?.route.path
    : undefined;
  return { screen: page === undefined ? view : `${view}:${page}`, url };
}

describe('the route table', () => {
  it('keeps every view key the shell has always had', () => {
    expect(ROUTES.map((route) => route.id).sort()).toEqual(
      [
        'account', 'actors', 'audit', 'chat', 'docs', 'embermend', 'hive', 'iam-audit', 'iam-clients', 'iam-overview', 'iam-roles',
        'iam-security', 'iam-service-accounts', 'iam-sessions', 'iam-system-users', 'iam-users', 'incidents', 'keys', 'magnus',
        'memories', 'providers', 'routers', 'routing', 'security', 'settings', 'skills', 'studio', 'testing', 'traces', 'workspaces',
      ].sort(),
    );
  });

  it('keeps the top-bar titles', () => {
    expect(Object.fromEntries(ROUTES.map((route) => [route.id, titleFor(route.id)]))).toEqual({
      magnus: 'Magnus', studio: 'Studio', account: 'Account security', security: 'Cindertrace', embermend: 'Embermend', chat: 'ChatterMost',
      hive: 'Hive', 'iam-overview': 'IAM Overview', 'iam-users': 'IAM Users', 'iam-roles': 'IAM Roles', 'iam-service-accounts': 'IAM Service Accounts',
      'iam-clients': 'IAM Clients', 'iam-sessions': 'IAM Sessions', 'iam-system-users': 'IAM System Users', 'iam-security': 'IAM Security',
      'iam-audit': 'Identity audit', memories: 'Memories', workspaces: 'Workspaces', skills: 'Skills and assignments', actors: 'Actors',
      routers: 'Routers', providers: 'Providers', routing: 'Routing', testing: 'Testing', traces: 'Traces', incidents: 'Hive incidents',
      keys: 'API Keys', audit: 'Routing audit', docs: 'API Docs', settings: 'Settings',
    });
    expect(titleFor('magnus', '/nodes/abc')).toBe('Node');
    expect(titleFor('magnus', '/no-such-page')).toBe('Magnus');
    expect(titleFor('security', '/security-fusion/cases')).toBe('Cases');
  });

  it('runs the same access checks as before', () => {
    const access = Object.fromEntries(ROUTES.flatMap((route) => ('access' in route ? [[route.id, route.access]] : [])));
    expect(access).toEqual({
      incidents: { product: 'emberpath', permission: 'router:admin:read' },
      ...Object.fromEntries(['iam-overview', 'iam-users', 'iam-roles', 'iam-service-accounts', 'iam-clients', 'iam-sessions', 'iam-system-users', 'iam-security', 'iam-audit', 'actors'].map((id) => [id, { product: 'oathweave' }])),
      routers: { product: 'emberpath', permission: 'router:routing:read' },
      providers: { product: 'emberpath', permission: 'router:providers:read' },
      routing: { product: 'emberpath', permission: 'router:routing:read' },
      testing: { product: 'emberpath', permission: 'router:testing:read' },
      traces: { product: 'emberpath', permission: 'router:admin:read' },
      keys: { product: 'emberpath', permission: 'router:keys:read' },
      audit: { product: 'emberpath', permission: 'router:admin:read' },
      docs: { product: 'emberpath', permission: 'router:admin:read' },
      settings: { product: 'emberpath', permission: 'router:settings:read' },
    });
  });

  it('renders every IAM section with one component, so its forms survive moving between them', () => {
    const iam = ROUTES.filter((route) => route.id.startsWith('iam-'));
    expect(iam).toHaveLength(9);
    expect(new Set(iam.map((route) => route.component)).size).toBe(1);
  });
});

describe('existing addresses open the same screens', () => {
  // Every address HiveXUI has ever written into the location bar or a bookmark, and its screen.
  const PINNED: ReadonlyArray<[string, string, string | null]> = [
    ['/', 'hive', null],
    ['/?page=hive', 'hive', null],
    ...ROUTES.filter((route) => !('prefix' in route)).map((route): [string, string, null] => [`/?page=${route.id}`, route.id, null]),
    ['/?page=memories&actor=x', 'memories', null],
    ['/?page=chat&chatAdmin=users', 'chat', null],
    ['/?page=traces&trace=tr_1', 'traces', null],
    // Magnus: everything under /fleet, query included, and the old ?page=magnus form.
    ['/fleet', 'magnus:/', null],
    ['/fleet/', 'magnus:/', null],
    ['/fleet/nodes', 'magnus:/nodes', null],
    ['/fleet/nodes/abc', 'magnus:/nodes/:nodeId', null],
    ['/fleet/anomalies/remediation', 'magnus:/anomalies/remediation', null],
    ['/fleet/audit?page=2', 'magnus:/audit', null],
    ['/fleet/audit?page=iam-users', 'magnus:/audit', null],
    ['/?page=magnus', 'magnus:/', '/fleet'],
    // Cindertrace: its pages under /security-fusion, its own ?page= pagination, and ?page=security.
    ['/?page=security', 'security:overview', null],
    ['/security-fusion', 'security:overview', null],
    ['/security-fusion/', 'security:overview', null],
    ['/security-fusion/cases', 'security:cases', null],
    ['/security-fusion/cases/abc', 'security:case', null],
    ['/security-fusion/events', 'security:events', null],
    ['/security-fusion/events?page=2', 'security:events', null],
    ['/security-fusion/entities', 'security:entities', null],
    ['/security-fusion/sources', 'security:sources', null],
    ['/security-fusion/evidence', 'security:evidence', null],
    ['/security-fusion/policies', 'security:policies', null],
    ['/security-fusion/audit', 'security:audit', null],
    ['/security-fusion/audit?date=2026-11-01&page=3', 'security:audit', null],
    ['/security-fusion/lab', 'security:lab', null],
    // An available ?page= view has always won over the security path.
    ['/security-fusion/cases/abc?page=traces', 'traces', null],
    // Studio: fullscreen, everything under /studio; ?page=studio never opened it inside the shell.
    ['/studio', 'studio', null],
    ['/studio/gallery', 'studio', null],
    ['/studio/p/adventure/room?c=1', 'studio', null],
    ['/?page=studio', 'hive', '/'],
    // Dead and look-alike addresses.
    ['/?page=retired', 'hive', '/'],
    ['/?page=constructor', 'hive', '/'],
    ['/fleetwood', 'hive', null],
    ['/security-fusionette', 'hive', null],
    ['/studios', 'hive', null],
  ];
  it.each(PINNED)('%s opens %s', (href, screen, url) => {
    expect(land(href)).toEqual({ screen, url });
  });

  it('drops an address whose product is not installed', () => {
    const identity: ProductCheck = (product) => product === 'oathweave';
    for (const href of ['/fleet/nodes', '/security-fusion/cases/abc', '/studio/gallery', '/?page=memories', '/?page=magnus'])
      expect(land(href, identity)).toEqual({ screen: 'hive', url: '/' });
  });
});

describe('every sidebar entry', () => {
  const products = navProducts(visibleNavGroups(EVERYTHING, { role: 'ADMIN', hermes: true }));
  const items = products.flatMap((product) => product.sections.flatMap((section) => section.items));
  it('has an address that opens it and lights it again', () => {
    for (const item of items) {
      if (item.key === 'studio') continue; // Studio opens over the shell and is never lit there.
      const href = viewAddress(item.key, item.path);
      const { pathname, search } = new URL(href, BASE);
      const { view } = resolveDeepLink({ pathname, search }, EVERYTHING);
      expect(view, href).toBe(item.key);
      expect(findActiveNav(products, view, shellLocation(view, pathname).navPath).item, href).toBe(item);
    }
  });
});

describe('linkTo', () => {
  it('builds the address of any product screen', () => {
    expect(linkTo('emberpath', 'providers')).toBe('/?page=providers');
    expect(linkTo('hive', 'hive')).toBe('/?page=hive');
    expect(linkTo('hivemem', 'memories', { q: 'deploy notes' })).toBe('/?page=memories&q=deploy+notes');
    expect(linkTo('oathweave', 'iam-users')).toBe('/?page=iam-users');
    expect(linkTo('cindertrace', 'overview')).toBe('/security-fusion');
    expect(linkTo('cindertrace', 'case', { caseId: 'c 1/2' })).toBe('/security-fusion/cases/c%201%2F2');
    expect(linkTo('cindertrace', 'audit', { date: '2026-11-01', page: 2 })).toBe('/security-fusion/audit?date=2026-11-01&page=2');
    expect(linkTo('magnus', '/')).toBe('/fleet');
    expect(linkTo('magnus', '/nodes/:nodeId', { nodeId: 'n1' })).toBe('/fleet/nodes/n1');
    expect(linkTo('ardentstudio', 'gallery')).toBe('/studio/gallery');
  });

  it('opens the screen it names', () => {
    expect(land(linkTo('emberpath', 'traces', { trace: 'tr_1' }))).toEqual({ screen: 'traces', url: null });
    for (const page of CINDERTRACE_PAGES) {
      const href = linkTo('cindertrace', page.id, { caseId: 'abc' });
      expect(land(href).screen, href).toBe(`security:${page.id}`);
    }
    expect(land(linkTo('magnus', '/nodes/:nodeId', { nodeId: 'n1' })).screen).toBe('magnus:/nodes/:nodeId');
    for (const route of ROUTES.filter((entry) => !('prefix' in entry)))
      expect(land(linkTo(route.product as never, route.id as never)).screen).toBe(route.id);
  });

  it('refuses screens and parameters it does not know', () => {
    expect(() => linkTo('cindertrace', 'case')).toThrow('caseId');
    expect(() => linkTo('cindertrace', 'nope' as never)).toThrow('Unknown');
    expect(() => linkTo('emberpath', 'iam-users' as never)).toThrow('Unknown');
    expect(() => linkTo('magnus', '/no-such-page')).toThrow('Unknown Magnus page');
  });
});

// Keeps the ViewKey type honest: it is derived from the table, so this must compile.
const _view: ViewKey = 'iam-users';
void _view;
