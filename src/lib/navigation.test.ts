import { describe, expect, it } from 'vitest';
import {
  magnusAddress,
  NAV_GROUPS,
  resolveDeepLink,
  viewAvailable,
  visibleNavGroups,
  type ProductCheck,
} from './navigation';
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

  it('shows the Magnus section only with Magnus installed', () => {
    const shown = layout(only('magnus'));
    const labels = Object.keys(shown);
    expect(labels[0]).toBe('Hive');
    expect(labels.at(-1)).toBe('System');
    // The port adds Magnus sections; only those may appear between Hive and System.
    expect(labels.slice(1, -1).length).toBeGreaterThan(0);
    for (const label of labels.slice(1, -1)) {
      expect(label).toMatch(/^Magnus/);
      expect(new Set(shown[label])).toEqual(new Set(['magnus']));
    }
    expect(shown.System).toEqual(['docs', 'settings']);
    const magnus = visibleNavGroups(only('magnus')).find((group) => group.label === 'Magnus')!;
    expect(magnus.items.map((item) => item.path)).toEqual(expect.arrayContaining(['/mission-control', '/', '/nodes']));
    expect(visibleNavGroups(ALL).some((group) => /magnus/i.test(group.label))).toBe(false);
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
