import { describe, expect, it, vi } from 'vitest';
import {
  breadcrumbs,
  findActiveNav,
  knownAddress,
  magnusAddress,
  NAV_GROUPS,
  navProducts,
  paletteScreens,
  resolveDeepLink,
  searchScreens,
  shellLocation,
  titleFor,
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
  it('keeps Embermend records accessible without a Magnus browser client', () => {
    const installed = only('oathweave', 'embermend');
    expect(layout(installed).Embermend).toEqual(['embermend']);
    expect(viewAvailable('embermend', installed)).toBe(true);
    expect(viewAvailable('magnus', installed)).toBe(false);
    expect(viewAvailable('embermend', only('oathweave', 'magnus'))).toBe(false);
  });

  it('shows one section per product when everything is installed', () => {
    expect(layout(ALL)).toEqual({
      Hive: ['hive', 'incidents', 'inbox'],
      Oathweave: [...IDENTITY_PAGES, 'actors'],
      Emberpath: EMBERPATH_PAGES,
      HiveMem: ['memories', 'workspaces'],
      HiveSkills: ['skills'],
      Cindertrace: Array(8).fill('security'),
      ChatterMost: ['chat'],
      System: ['docs', 'settings'],
    });
  });

  it('drops the sections of absent products from a core installation', () => {
    expect(layout(CORE)).toEqual({
      Hive: ['hive', 'incidents', 'inbox'],
      Oathweave: [...IDENTITY_PAGES, 'actors'],
      Emberpath: EMBERPATH_PAGES,
      HiveMem: ['memories', 'workspaces'],
      System: ['docs', 'settings'],
    });
  });

  it('reduces an identity-only installation to Hive, Oathweave and System', () => {
    expect(layout(IDENTITY)).toEqual({
      Hive: ['hive', 'incidents', 'inbox'],
      Oathweave: IDENTITY_PAGES,
      System: ['docs', 'settings'],
    });
  });

  it('keeps the console itself with no products and never returns an empty section', () => {
    expect(layout(only())).toEqual({ Hive: ['hive', 'inbox'], System: ['docs', 'settings'] });
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

  it('shows the Studio section only with Ardent Project Studio installed, after Magnus', () => {
    for (const installed of [ALL, only('magnus'), only()]) expect(visibleNavGroups(installed).some((group) => group.label === 'Studio')).toBe(false);
    expect(viewAvailable('studio', ALL)).toBe(false);
    const groups = visibleNavGroups(only('magnus', 'oathweave', 'ardentstudio'));
    const studio = groups.find((group) => group.label === 'Studio')!;
    expect(studio.items.map((item) => [item.label, item.key, item.path])).toEqual([
      ['Projects', 'studio', '/studio'],
      ['Gallery', 'studio', '/studio/gallery'],
    ]);
    const labels = groups.map((group) => group.product ?? group.label);
    expect(labels.indexOf('Studio')).toBe(labels.lastIndexOf('Magnus') + 1);
    expect(viewAvailable('studio', only('ardentstudio'))).toBe(true);
    expect(navProducts(groups).find((product) => product.label === 'Studio')?.sections).toHaveLength(1);
  });

  it('offers the Studio pages in the palette and never marks them current in the shell', () => {
    const products = navProducts(visibleNavGroups(only('ardentstudio')));
    expect(paletteScreens(products).filter((screen) => screen.view === 'studio').map((screen) => screen.path)).toEqual(['/studio', '/studio/gallery']);
    expect(findActiveNav(products, 'hive', null).item?.key).toBe('hive');
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
    expect(labels('skills', null)).toEqual(['HiveSkills']);
    const at = (pathname: string) => {
      const where = shellLocation('security', pathname);
      return breadcrumbs(findActiveNav(products, 'security', where.navPath), 'Fallback', titleFor('security', where.path), where.path);
    };
    // ?page=security has always opened the overview at the root address.
    expect(at('/').map((crumb) => crumb.label)).toEqual(['Cindertrace', 'Security overview']);
    expect(at('/security-fusion').map((crumb) => crumb.label)).toEqual(['Cindertrace', 'Security overview']);
    expect(at('/security-fusion/cases').map((crumb) => crumb.label)).toEqual(['Cindertrace', 'Cases']);
    const detail = at('/security-fusion/cases/abc');
    expect(detail.map((crumb) => crumb.label)).toEqual(['Cindertrace', 'Cases', 'Detail']);
    expect(detail[1]!.to).toEqual({ view: 'security', path: '/security-fusion/cases' });
    expect(at('/security-fusion/lab').map((crumb) => crumb.label)).toEqual(['Cindertrace', 'Security overview', 'Lab']);
    expect(at('/security-fusion/nope').map((crumb) => crumb.label)).toEqual(['Cindertrace']);
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

  it('leaves /studio to Studio when it is installed, and clears it when it is not', () => {
    const STUDIO = only('ardentstudio');
    expect(link('/studio', STUDIO)).toEqual({ view: 'hive', url: null });
    expect(link('/studio/p/adventure/room?c=1', STUDIO)).toEqual({ view: 'hive', url: null });
    expect(link('/studio', ALL)).toEqual({ view: 'hive', url: '/' });
    expect(link('/studio/gallery', IDENTITY)).toEqual({ view: 'hive', url: '/' });
    expect(link('/studios', STUDIO)).toEqual({ view: 'hive', url: null });
  });

  it('does not open Studio inside the shell from ?page=studio', () => {
    expect(link('/?page=studio', only('ardentstudio'))).toEqual({ view: 'hive', url: '/' });
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

describe('page names', () => {
  it('give every audit and incident screen a product-qualified, distinct name', () => {
    const everything = only('oathweave', 'emberpath', 'hivemem', 'hiveskills', 'cindertrace', 'chattermost', 'magnus');
    const labels = paletteScreens(navProducts(visibleNavGroups(everything, { role: 'ADMIN' })))
      .map((screen) => screen.label)
      .filter((label) => /audit|incident/i.test(label));
    expect(labels).toEqual(expect.arrayContaining(['Hive incidents', 'Fleet incidents', 'Identity audit', 'Routing audit', 'Fleet audit', 'Security audit']));
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.filter((label) => /^(audit|audit log|incidents)$/i.test(label))).toEqual([]);
  });
});

describe('addresses from data', () => {
  const EVERY = only('oathweave', 'emberpath', 'hivemem', 'hiveskills', 'cindertrace', 'chattermost', 'magnus', 'ardentstudio', 'embermend');
  it('follows a page the route table knows', () => {
    expect(knownAddress('/security-fusion/cases/case-1', EVERY)).toBe('/security-fusion/cases/case-1');
    expect(knownAddress('/fleet/nodes/node-1', EVERY)).toBe('/fleet/nodes/node-1');
    expect(knownAddress('/fleet/notifications', EVERY)).toBe('/fleet/notifications');
    expect(knownAddress('/fleet/ardent/profiles/node-1~lead', EVERY)).toBe('/fleet/ardent/profiles/node-1~lead');
    expect(knownAddress('/?page=embermend&plan=plan-1', EVERY)).toBe('/?page=embermend&plan=plan-1');
    expect(knownAddress('/?page=embermend&campaign=c-1', EVERY)).toBe('/?page=embermend&campaign=c-1');
    expect(knownAddress('/?page=skills', EVERY)).toBe('/?page=skills');
    expect(knownAddress('/agents/node-1~lead', EVERY)).toBe('/agents/node-1~lead');
    expect(knownAddress('/?page=embermend', EVERY)).toBe('/?page=embermend');
    expect(knownAddress('/?page=skills&tab=receipts', EVERY)).toBe('/?page=skills&tab=receipts');
    expect(knownAddress('/', EVERY)).toBe('/');
  });
  it('does not follow an address the table does not know, or a product not installed here', () => {
    for (const href of ['/security-fusion/nowhere/1/2', '/fleet/not-a-page', '/?page=nope', '/elsewhere', '/?page=magnus', '/?page=constructor'])
      expect(knownAddress(href, EVERY)).toBeNull();
    expect(knownAddress('/security-fusion/cases/case-1', only('magnus'))).toBeNull();
    expect(knownAddress('/?page=embermend', only('magnus'))).toBeNull();
  });
  it('never follows an address that leaves HiveXUI', () => {
    for (const href of ['https://example.com/x', '//example.com/x', '/\\example.com', 'javascript:alert(1)', '/security-fusion/cases/../../x', '/security-fusion/cases/%2e%2e', '/fleet/nodes/a b', 42, null])
      expect(knownAddress(href, EVERY)).toBeNull();
  });
});
