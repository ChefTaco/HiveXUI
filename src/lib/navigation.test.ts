import { describe, expect, it, vi } from 'vitest';
import {
  breadcrumbs,
  findActiveNav,
  magnusAddress,
  NAV_GROUPS,
  navProducts,
  paletteScreens,
  resolveDeepLink,
  searchScreens,
  showsShellRefresh,
  viewAvailable,
  visibleNavGroups,
  type ProductCheck,
} from './navigation';
import { isNavOpen, readNavChoices, revealActive, toggleNavChoice, writeNavChoices } from './nav-state';
import { Icon } from '../components/icons';
import type { Product } from './transport';

const only =
  (...products: Product[]): ProductCheck =>
  (product) =>
    products.includes(product);
const ALL = only('oathweave', 'emberpath', 'hivemem', 'hiveskills', 'cindertrace', 'chattermost');
const CORE = only('oathweave', 'emberpath', 'hivemem');
const IDENTITY = only('oathweave');

const layout = (installed: ProductCheck) =>
  Object.fromEntries(
    visibleNavGroups(installed).map((group) => [group.label, group.items.map((item) => item.key)]),
  );
const IDENTITY_PAGES = [
  'iam-overview',
  'account',
  'iam-users',
  'iam-roles',
  'iam-service-accounts',
  'iam-clients',
  'iam-sessions',
  'iam-system-users',
  'iam-security',
  'iam-audit',
];
const EMBERPATH_PAGES = ['routers', 'providers', 'routing', 'testing', 'traces', 'keys', 'audit'];

describe('navigation model', () => {
  it('shows one section per product when everything is installed', () => {
    expect(layout(ALL)).toEqual({
      Hive: ['hive', 'incidents'],
      Oathweave: [...IDENTITY_PAGES, 'actors'],
      Emberpath: EMBERPATH_PAGES,
      HiveMem: ['memories', 'workspaces'],
      HiveSkills: ['skills'],
      Cindertrace: ['security'],
      ChatterMost: ['chat'],
      System: ['docs', 'settings'],
    });
  });

  it('drops the sections of absent products from a core installation', () => {
    expect(layout(CORE)).toEqual({
      Hive: ['hive', 'incidents'],
      Oathweave: [...IDENTITY_PAGES, 'actors'],
      Emberpath: EMBERPATH_PAGES,
      HiveMem: ['memories', 'workspaces'],
      System: ['docs', 'settings'],
    });
  });

  it('reduces an identity-only installation to Hive, Oathweave and System', () => {
    expect(layout(IDENTITY)).toEqual({
      Hive: ['hive', 'incidents'],
      Oathweave: IDENTITY_PAGES,
      System: ['docs', 'settings'],
    });
  });

  it('keeps the console itself with no products and never returns an empty section', () => {
    expect(layout(only())).toEqual({ Hive: ['hive'], System: ['docs', 'settings'] });
    for (const installed of [ALL, CORE, IDENTITY, only()])
      expect(visibleNavGroups(installed).every((group) => group.items.length > 0)).toBe(true);
  });

  it('shows Actors only when all three enrollment products are present', () => {
    expect(viewAvailable('actors', CORE)).toBe(true);
    expect(viewAvailable('actors', only('oathweave', 'emberpath'))).toBe(false);
    expect(viewAvailable('actors', only('oathweave', 'hivemem'))).toBe(false);
    expect(viewAvailable('actors', only('emberpath', 'hivemem'))).toBe(false);
  });

  it('shows Incidents when any failure source is present', () => {
    for (const product of ['emberpath', 'oathweave', 'hivemem'] as const)
      expect(viewAvailable('incidents', only(product))).toBe(true);
    expect(viewAvailable('incidents', only('chattermost'))).toBe(false);
  });

  it('shows the Magnus sections only with Magnus installed, right after Hive', () => {
    const groups = visibleNavGroups(only('magnus'));
    expect(groups[0]!.label).toBe('Hive');
    expect(groups.at(-1)!.label).toBe('System');
    const sections = groups.slice(1, -1);
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      expect(section.product).toBe('Magnus');
      expect(new Set(section.items.map((item) => item.key))).toEqual(new Set(['magnus']));
    }
    const fleet = groups.find((group) => group.label === 'Fleet')!;
    expect(fleet.items.map((item) => item.path)).toEqual(expect.arrayContaining(['/mission-control', '/', '/nodes']));
    expect(visibleNavGroups(ALL).some((group) => group.product === 'Magnus')).toBe(false);
    expect(visibleNavGroups(only('magnus', 'oathweave')).map((group) => group.product ?? group.label).indexOf('Magnus')).toBe(1);
  });

  it('keeps System last, whatever is installed', () => {
    expect(visibleNavGroups(only('magnus', 'oathweave')).at(-1)!.label).toBe('System');
  });

  it('labels every entry uniquely, because the console walkthrough names screenshots after them', () => {
    const labels = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.label));
    expect(labels.filter((label, index) => labels.indexOf(label) !== index)).toEqual([]);
  });

  it('uses only icons the console has', () => {
    for (const item of NAV_GROUPS.flatMap((group) => group.items)) expect(Icon[item.icon], item.label).toBeTruthy();
  });

  it('rejects unknown views', () => {
    expect(viewAvailable('nope', ALL)).toBe(false);
    expect(viewAvailable('constructor', ALL)).toBe(false);
  });
});

const MAGNUS_ALL = only('magnus', 'oathweave', 'emberpath', 'hivemem', 'hiveskills', 'cindertrace', 'chattermost');

describe('sidebar products', () => {
  const products = navProducts(visibleNavGroups(MAGNUS_ALL, { role: 'ADMIN', hermes: true }));
  it('reads Magnus as one product with sections, and everything else as itself', () => {
    expect(products.map((product) => product.label)).toEqual(['Hive', 'Magnus', 'Oathweave', 'Emberpath', 'HiveMem', 'HiveSkills', 'Cindertrace', 'ChatterMost', 'System']);
    const magnus = products.find((product) => product.label === 'Magnus')!;
    expect(magnus.sections.map((section) => section.label)).toContain('Operations');
    expect(magnus.sections.length).toBeGreaterThan(1);
    for (const product of products.filter((entry) => entry !== magnus)) expect(product.sections).toHaveLength(1);
  });
  it('gives every product an icon the console has', () => {
    for (const product of products) expect(Icon[product.icon], product.label).toBeTruthy();
  });
  it('finds the page a view and path are on', () => {
    expect(findActiveNav(products, 'routers', null).product?.label).toBe('Emberpath');
    expect(findActiveNav(products, 'magnus', '/nodes')).toMatchObject({ product: { label: 'Magnus' }, section: { label: 'Fleet' }, item: { label: 'Nodes' } });
    expect(findActiveNav(products, 'magnus', null)).toEqual({});
  });
});

describe('breadcrumbs', () => {
  const products = navProducts(visibleNavGroups(MAGNUS_ALL, { role: 'ADMIN', hermes: true }));
  const labels = (view: Parameters<typeof findActiveNav>[1], navPath: string | null, title?: string, path = '') => breadcrumbs(findActiveNav(products, view, navPath), 'Fallback', title, path).map((crumb) => crumb.label);
  it('name the product, the section of a multi-section product, and the page', () => {
    expect(labels('routers', null)).toEqual(['Emberpath', 'Routers']);
    expect(labels('magnus', '/', 'Fleet Overview', '/')).toEqual(['Magnus', 'Fleet', 'Fleet Overview']);
  });
  it('keep a list as a link above its detail page', () => {
    const crumbs = breadcrumbs(findActiveNav(products, 'magnus', '/nodes'), 'Fallback', 'Node', '/nodes/abc');
    expect(crumbs.map((crumb) => crumb.label)).toEqual(['Magnus', 'Fleet', 'Nodes', 'Node']);
    expect(crumbs[2]!.to).toEqual({ view: 'magnus', path: '/nodes' });
    expect(crumbs[3]!.to).toBeUndefined();
  });
  it('do not repeat a one-page product, and follow Cindertrace into its pages', () => {
    expect(labels('security', null, undefined, '/')).toEqual(['Cindertrace']);
    expect(labels('security', null, undefined, '/security-fusion/cases')).toEqual(['Cindertrace', 'Cases']);
    expect(labels('security', null, undefined, '/security-fusion/cases/abc')).toEqual(['Cindertrace', 'Cases', 'Detail']);
  });
  it('fall back to a title for a page the sidebar does not list', () => {
    expect(breadcrumbs({}, 'Fallback')).toEqual([{ label: 'Fallback' }]);
  });
});

describe('the shell refresh', () => {
  it('appears only on pages that read the shared store and have no refresh of their own', () => {
    for (const view of ['routers', 'providers', 'routing', 'testing', 'keys', 'settings', 'docs'] as const) expect(showsShellRefresh(view)).toBe(true);
    for (const view of ['magnus', 'audit', 'traces', 'incidents', 'memories', 'skills', 'hive', 'security', 'chat', 'actors'] as const) expect(showsShellRefresh(view)).toBe(false);
  });
});

describe('the command palette', () => {
  const screens = paletteScreens(navProducts(visibleNavGroups(MAGNUS_ALL, { role: 'ADMIN', hermes: true })));
  const search = (query: string) => searchScreens(query, screens).map((screen) => screen.label);
  it('offers every visible screen, including Cindertrace pages', () => {
    const labels = screens.map((screen) => screen.label);
    for (const label of ['Installation', 'Fleet overview', 'Commands', 'Routers', 'Memories', 'HiveSkills', 'Cases', 'ChatterMost', 'Settings']) expect(labels).toContain(label);
    expect(screens.find((screen) => screen.label === 'Cases')).toMatchObject({ view: 'security', path: '/security-fusion/cases' });
    expect(new Set(screens.map((screen) => screen.id)).size).toBe(screens.length);
  });
  it('hides what this session cannot open', () => {
    const viewer = paletteScreens(navProducts(visibleNavGroups(only('magnus'), { role: 'VIEWER' })));
    expect(viewer.map((screen) => screen.label)).not.toContain('Commands');
    expect(viewer.map((screen) => screen.label)).not.toContain('Routers');
  });
  it('ranks a name above a product, an exact name first, and needs every word', () => {
    expect(search('nodes')[0]).toBe('Nodes');
    expect(search('Routers')[0]).toBe('Routers');
    expect(search('magnus cron')).toEqual(['Cron jobs']);
    expect(search('emberpath').length).toBeGreaterThan(3);
    expect(search('cmd zzz')).toEqual([]);
    expect(search('').length).toBe(screens.length);
  });
  it('tolerates skipped letters in a name, but not in a product', () => {
    expect(search('flmap')).toEqual(['Fleet map']);
    expect(search('qqq')).toEqual([]);
  });
});

describe('remembered sidebar state', () => {
  const active = ['magnus', 'magnus/fleet'];
  it('opens only what holds the current page until someone chooses otherwise', () => {
    expect(isNavOpen({}, 'magnus', active)).toBe(true);
    expect(isNavOpen({}, 'oathweave', active)).toBe(false);
  });
  it('remembers a choice in either direction', () => {
    expect(isNavOpen(toggleNavChoice({}, 'oathweave', active), 'oathweave', active)).toBe(true);
    expect(isNavOpen(toggleNavChoice({}, 'magnus', active), 'magnus', active)).toBe(false);
  });
  it('shows the page when someone arrives in a group they closed, and keeps other choices', () => {
    const choices = { magnus: false, oathweave: true, hive: false };
    expect(revealActive(choices, active)).toEqual({ oathweave: true, hive: false });
    const untouched = { oathweave: true };
    expect(revealActive(untouched, active)).toBe(untouched);
  });
  it('survives missing, broken or blocked storage', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) });
    expect(readNavChoices()).toEqual({});
    writeNavChoices({ magnus: true });
    expect(readNavChoices()).toEqual({ magnus: true });
    store.set('hivexui-nav', '{not json');
    expect(readNavChoices()).toEqual({});
    store.set('hivexui-nav', '{"magnus":"yes","hive":false}');
    expect(readNavChoices()).toEqual({ hive: false });
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
    expect(readNavChoices()).toEqual({});
    expect(() => writeNavChoices({ magnus: true })).not.toThrow();
    vi.unstubAllGlobals();
  });
});

describe('deep links', () => {
  const link = (url: string, installed: ProductCheck) => {
    const { pathname, search } = new URL(url, 'https://console.example.com');
    return resolveDeepLink({ pathname, search }, installed);
  };

  it('keeps bookmarks when the product is installed, without touching the address', () => {
    expect(link('/?page=memories', ALL)).toEqual({ view: 'memories', url: null });
    expect(link('/?page=memories&actor=x', CORE)).toEqual({ view: 'memories', url: null });
    expect(link('/?page=iam-users', IDENTITY)).toEqual({ view: 'iam-users', url: null });
    expect(link('/?page=settings', IDENTITY)).toEqual({ view: 'settings', url: null });
    expect(link('/', ALL)).toEqual({ view: 'hive', url: null });
  });

  it('falls back to the overview for a product that is not installed and clears the address', () => {
    for (const page of ['memories', 'workspaces', 'skills', 'chat', 'security', 'providers', 'audit', 'actors'])
      expect(link('/?page=' + page, IDENTITY)).toEqual({ view: 'hive', url: '/' });
    expect(link('/?page=iam-users', only('emberpath'))).toEqual({ view: 'hive', url: '/' });
    expect(link('/?page=actors', only('oathweave', 'emberpath'))).toEqual({ view: 'hive', url: '/' });
  });

  it('falls back to the overview for an unknown page', () => {
    expect(link('/?page=retired', ALL)).toEqual({ view: 'hive', url: '/' });
  });

  it('serves security paths only when Cindertrace is installed', () => {
    expect(link('/security-fusion', ALL)).toEqual({ view: 'security', url: null });
    expect(link('/security-fusion/cases/abc', ALL)).toEqual({ view: 'security', url: null });
    expect(link('/security-fusion/cases/abc', CORE)).toEqual({ view: 'hive', url: '/' });
    expect(link('/security-fusion', IDENTITY)).toEqual({ view: 'hive', url: '/' });
    expect(link('/security-fusionette', ALL)).toEqual({ view: 'hive', url: null });
  });

  it('keeps pagination on security paths, which shares the page parameter', () => {
    expect(link('/security-fusion/events?page=2', ALL)).toEqual({ view: 'security', url: null });
    expect(link('/security-fusion/events?page=2', CORE)).toEqual({ view: 'hive', url: '/' });
  });

  it('serves /fleet deep links only when Magnus is installed', () => {
    const MAGNUS = only('magnus');
    expect(link('/fleet', MAGNUS)).toEqual({ view: 'magnus', url: null });
    expect(link('/fleet/nodes/abc', MAGNUS)).toEqual({ view: 'magnus', url: null });
    expect(link('/fleet/nodes', ALL)).toEqual({ view: 'hive', url: '/' });
    expect(link('/fleetwood', MAGNUS)).toEqual({ view: 'hive', url: null });
  });

  it('leaves the query under /fleet to the module, including its own ?page=', () => {
    const BOTH = only('magnus', 'oathweave');
    expect(link('/fleet/audit?page=2', BOTH)).toEqual({ view: 'magnus', url: null });
    expect(link('/fleet/audit?page=iam-users', BOTH)).toEqual({ view: 'magnus', url: null });
  });

  it('sends the old ?page=magnus form to /fleet', () => {
    expect(link('/?page=magnus', only('magnus'))).toEqual({ view: 'magnus', url: '/fleet' });
    expect(link('/?page=magnus', ALL)).toEqual({ view: 'hive', url: '/' });
  });

  it('builds the address for a Magnus page', () => {
    expect(magnusAddress('/')).toBe('/fleet');
    expect(magnusAddress('/nodes')).toBe('/fleet/nodes');
  });

  it('lets an available page win over the security path', () => {
    expect(link('/security-fusion/cases/abc?page=traces', ALL)).toEqual({ view: 'traces', url: null });
    expect(link('/security-fusion/cases/abc?page=traces', CORE)).toEqual({ view: 'traces', url: null });
  });
});
