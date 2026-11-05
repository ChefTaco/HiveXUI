import { MAGNUS_NAV, visibleMagnusNav, type MagnusNavContext, type MagnusNavIcon } from '../modules/magnus/nav';
import { FLEET_PREFIX, isFleetPath } from '../modules/magnus/paths';
import type { Product } from './transport';

export type IamViewKey =
  | 'iam-overview'
  | 'iam-users'
  | 'iam-roles'
  | 'iam-service-accounts'
  | 'iam-clients'
  | 'iam-sessions'
  | 'iam-system-users'
  | 'iam-security'
  | 'iam-audit';
export type ViewKey =
  | 'account'
  | 'skills'
  | 'chat'
  | 'security'
  | 'magnus'
  | 'hive'
  | IamViewKey
  | 'workspaces'
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

export type NavIcon =
  | MagnusNavIcon
  | 'Brain'
  | 'Messages'
  | 'Radar'
  | 'ScanSearch'
  | 'Workflow';

/** What a page's own API calls need. An item with neither list belongs to the console itself. */
export interface ProductGate {
  /** Every one of these must be installed. */
  all?: readonly Product[];
  /** At least one of these must be installed. */
  any?: readonly Product[];
}
export interface NavItem {
  key: ViewKey;
  label: string;
  icon: NavIcon;
  gate?: ProductGate;
  /** A module page, for views that hold many of them. Magnus paths are console-relative. */
  path?: string;
}
export interface NavGroup {
  label: string;
  items: readonly NavItem[];
  /** The product this section belongs to, when it is not the section itself. */
  product?: string;
}
/** One sidebar heading: a product and its sections. Most products have a single section. */
export interface NavProduct {
  id: string;
  label: string;
  icon: NavIcon;
  sections: readonly NavGroup[];
}
export type ProductCheck = (product: Product) => boolean;

const OATHWEAVE: ProductGate = { all: ['oathweave'] };
const EMBERPATH: ProductGate = { all: ['emberpath'] };
const HIVEMEM: ProductGate = { all: ['hivemem'] };
const MAGNUS: ProductGate = { all: ['magnus'] };

function magnusGroups(context?: MagnusNavContext): NavGroup[] {
  return (context ? visibleMagnusNav(context) : MAGNUS_NAV).map((section) => ({
    label: section.label,
    product: 'Magnus',
    items: section.items.map((item): NavItem => ({ key: 'magnus', label: item.label, icon: item.icon, gate: MAGNUS, path: item.path })),
  }));
}

const HIVE_GROUP: NavGroup = {
  label: 'Hive',
  items: [
    { key: 'hive', label: 'Installation', icon: 'Dashboard' },
    // Correlates failures from whichever of these products is present; each source is optional.
    { key: 'incidents', label: 'Incidents', icon: 'Alert', gate: { any: ['emberpath', 'oathweave', 'hivemem'] } },
  ],
};
const PRODUCT_GROUPS: readonly NavGroup[] = [
  {
    label: 'Oathweave',
    items: [
      { key: 'iam-overview', label: 'Overview', icon: 'Dashboard', gate: OATHWEAVE },
      { key: 'account', label: 'Account security', icon: 'Key', gate: OATHWEAVE },
      { key: 'iam-users', label: 'Users', icon: 'Key', gate: OATHWEAVE },
      { key: 'iam-roles', label: 'Roles', icon: 'Scroll', gate: OATHWEAVE },
      { key: 'iam-service-accounts', label: 'Service Accounts', icon: 'Server', gate: OATHWEAVE },
      { key: 'iam-clients', label: 'Clients', icon: 'Route', gate: OATHWEAVE },
      { key: 'iam-sessions', label: 'Sessions', icon: 'Activity', gate: OATHWEAVE },
      { key: 'iam-system-users', label: 'System Users', icon: 'Settings', gate: OATHWEAVE },
      { key: 'iam-security', label: 'Security', icon: 'Shield', gate: OATHWEAVE },
      { key: 'iam-audit', label: 'Audit', icon: 'Book', gate: OATHWEAVE },
      // The browser only calls Oathweave, but every enrollment links an Emberpath key
      // and a HiveMem agent; the coordinator is unusable without both.
      { key: 'actors', label: 'Actors', icon: 'Key', gate: { all: ['oathweave', 'emberpath', 'hivemem'] } },
    ],
  },
  {
    label: 'Emberpath',
    items: [
      { key: 'routers', label: 'Routers', icon: 'Dashboard', gate: EMBERPATH },
      { key: 'providers', label: 'Providers', icon: 'Server', gate: EMBERPATH },
      { key: 'routing', label: 'Routing', icon: 'Workflow', gate: EMBERPATH },
      { key: 'testing', label: 'Testing', icon: 'Hexagon', gate: EMBERPATH },
      { key: 'traces', label: 'Traces', icon: 'Activity', gate: EMBERPATH },
      { key: 'keys', label: 'API Keys', icon: 'Key', gate: EMBERPATH },
      { key: 'audit', label: 'Audit Log', icon: 'Scroll', gate: EMBERPATH },
    ],
  },
  {
    label: 'HiveMem',
    items: [
      { key: 'memories', label: 'Memories', icon: 'Brain', gate: HIVEMEM },
      { key: 'workspaces', label: 'Workspaces', icon: 'Library', gate: HIVEMEM },
    ],
  },
  {
    label: 'HiveSkills',
    items: [{ key: 'skills', label: 'HiveSkills', icon: 'Puzzle', gate: { all: ['hiveskills'] } }],
  },
  {
    label: 'Cindertrace',
    items: [{ key: 'security', label: 'Cindertrace', icon: 'ScanSearch', gate: { all: ['cindertrace'] } }],
  },
  {
    label: 'ChatterMost',
    items: [{ key: 'chat', label: 'ChatterMost', icon: 'Messages', gate: { all: ['chattermost'] } }],
  },
];
const SYSTEM_GROUP: NavGroup = {
  label: 'System',
  items: [
    // Both show installation-level content; their Emberpath panels appear only with Emberpath.
    { key: 'docs', label: 'API Docs', icon: 'Book' },
    { key: 'settings', label: 'Settings', icon: 'Settings' },
  ],
};
/** Every group and entry, whatever is installed or ported. */
export const NAV_GROUPS: readonly NavGroup[] = [HIVE_GROUP, ...magnusGroups(), ...PRODUCT_GROUPS, SYSTEM_GROUP];

const ITEMS = new Map<string, NavItem>(
  NAV_GROUPS.flatMap((group) => group.items).map((item) => [item.key, item]),
);

function gateOpen(gate: ProductGate | undefined, installed: ProductCheck): boolean {
  return (
    (gate?.all ?? []).every(installed) &&
    (!gate?.any || gate.any.some(installed))
  );
}

/**
 * Sections an operator sees: only installed products' pages, and no empty sections. Magnus entries
 * also depend on what has been ported and on what this session's role and capabilities allow.
 */
export function visibleNavGroups(installed: ProductCheck, magnus: MagnusNavContext = {}): NavGroup[] {
  return [HIVE_GROUP, ...magnusGroups(magnus), ...PRODUCT_GROUPS, SYSTEM_GROUP].map((group) => ({
    ...group,
    items: group.items.filter((item) => gateOpen(item.gate, installed)),
  })).filter((group) => group.items.length > 0);
}

const PRODUCT_ICON: Readonly<Record<string, NavIcon>> = {
  Hive: 'Hexagon',
  Magnus: 'Radar',
  Oathweave: 'Shield',
  Emberpath: 'Route',
  HiveMem: 'Brain',
  HiveSkills: 'Puzzle',
  Cindertrace: 'ScanSearch',
  ChatterMost: 'Messages',
  System: 'Settings',
};
/** Sidebar headings: sections that belong to one product are merged into it, in order. */
export function navProducts(groups: readonly NavGroup[]): NavProduct[] {
  const products = new Map<string, NavGroup[]>();
  for (const group of groups) {
    const label = group.product ?? group.label;
    products.set(label, [...(products.get(label) ?? []), group]);
  }
  return [...products].map(([label, sections]) => ({
    id: label.toLowerCase(),
    label,
    icon: PRODUCT_ICON[label] ?? 'Hexagon',
    sections,
  }));
}
/** The id that remembers whether a section of a multi-section product is open. */
export const navSectionId = (product: NavProduct, section: NavGroup): string => `${product.id}/${section.label.toLowerCase()}`;

/** What the sidebar lights up and keeps open for a page. */
export interface ActiveNav {
  product?: NavProduct;
  section?: NavGroup;
  item?: NavItem;
}
export function findActiveNav(products: readonly NavProduct[], view: ViewKey, magnusNavPath: string | null): ActiveNav {
  for (const product of products)
    for (const section of product.sections)
      for (const item of section.items)
        if (item.key === view && (item.path === undefined || item.path === magnusNavPath)) return { product, section, item };
  return {};
}

export interface Crumb {
  label: string;
  /** A place to go. Absent for the current page and for headings that are not pages. */
  to?: { view: ViewKey; path?: string | undefined };
}
const SECURITY_PAGES: Readonly<Record<string, string>> = {
  cases: 'Cases',
  events: 'Events',
  entities: 'Entities',
  sources: 'Sources',
  evidence: 'Evidence',
  policies: 'Policies',
  audit: 'Audit',
  lab: 'Lab',
};
/**
 * The terminal breadcrumb: product, section, page. The page comes last, and `title` overrides its
 * label where a route knows better than the sidebar: a detail page keeps its list as a link.
 */
export function breadcrumbs(active: ActiveNav, fallbackTitle: string, title?: string, pathname = ''): Crumb[] {
  const { product, section, item } = active;
  if (!product || !section || !item) return [{ label: title ?? fallbackTitle }];
  const crumbs: Crumb[] = [];
  const first = product.sections[0]!.items[0]!;
  const target = (entry: NavItem): NonNullable<Crumb['to']> => ({ view: entry.key, path: entry.path });
  if (product.label !== item.label) crumbs.push({ label: product.label, to: target(first) });
  if (product.sections.length > 1) crumbs.push({ label: section.label, to: target(section.items[0]!) });
  if (item.key === 'security') {
    const [, , page, detail] = pathname.split('/');
    const known = page ? SECURITY_PAGES[page] : undefined;
    if (known) {
      crumbs.push({ label: item.label, to: { view: 'security', path: '/security-fusion' } });
      if (detail) crumbs.push({ label: known, to: { view: 'security', path: `/security-fusion/${page}` } }, { label: 'Detail' });
      else crumbs.push({ label: known });
      return crumbs;
    }
  }
  const page = title ?? item.label;
  // A detail page keeps its list as a link back.
  if (item.path !== undefined && title !== undefined && pathname !== '' && pathname !== item.path) crumbs.push({ label: item.label, to: target(item) });
  crumbs.push({ label: page });
  return crumbs;
}

/**
 * Pages that read the shared store and have no Refresh of their own. Only these show the shell's,
 * so a page never has two: everything else refreshes itself.
 */
const SHELL_REFRESH: ReadonlySet<ViewKey> = new Set<ViewKey>(['routers', 'providers', 'routing', 'testing', 'keys', 'settings', 'docs']);
export const showsShellRefresh = (view: ViewKey): boolean => SHELL_REFRESH.has(view);
/** Pages whose content comes from the shared store, where its health and age mean something. */
const SHELL_STATUS: ReadonlySet<ViewKey> = new Set<ViewKey>([...SHELL_REFRESH, 'audit', 'traces', 'incidents', 'actors']);
export const showsShellStatus = (view: ViewKey): boolean => SHELL_STATUS.has(view);

/** Every screen the command palette can open. */
export interface PaletteScreen {
  id: string;
  label: string;
  where: string;
  icon: NavIcon;
  view: ViewKey;
  path?: string;
}
const SECURITY_SCREENS: ReadonlyArray<{ page: string; icon: NavIcon }> = [
  { page: 'cases', icon: 'ScanSearch' },
  { page: 'events', icon: 'Activity' },
  { page: 'entities', icon: 'Key' },
  { page: 'sources', icon: 'Server' },
  { page: 'evidence', icon: 'FileText' },
  { page: 'policies', icon: 'Scroll' },
  { page: 'audit', icon: 'Shield' },
];
export function paletteScreens(products: readonly NavProduct[]): PaletteScreen[] {
  const screens: PaletteScreen[] = [];
  for (const product of products)
    for (const section of product.sections)
      for (const item of section.items) {
        const where = product.sections.length > 1 ? `${product.label} · ${section.label}` : product.label;
        screens.push({ id: item.path ?? item.key, label: item.label, where, icon: item.icon, view: item.key, ...(item.path !== undefined ? { path: item.path } : {}) });
        if (item.key === 'security')
          for (const { page, icon } of SECURITY_SCREENS)
            screens.push({ id: `security/${page}`, label: SECURITY_PAGES[page]!, where: product.label, icon, view: 'security', path: `/security-fusion/${page}` });
      }
  return screens;
}
/** How well one piece of text answers one word: 0 for not at all. */
function wordScore(word: string, text: string): number {
  const value = text.toLowerCase();
  if (value === word) return 100;
  if (value.startsWith(word)) return 80;
  if (value.split(/[^a-z0-9]+/).some((part) => part.startsWith(word))) return 60;
  if (value.includes(word)) return 40;
  let from = 0;
  for (const letter of word) {
    from = value.indexOf(letter, from) + 1;
    if (from === 0) return 0;
  }
  return 10;
}
/** Screens that answer the query, best first. Every word must match the name or the product. */
export function searchScreens<T extends { label: string; where: string }>(query: string, screens: readonly T[]): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...screens];
  return screens
    .map((screen, index) => {
      let score = 0;
      for (const word of words) {
        const inLabel = wordScore(word, screen.label);
        // A subsequence over "Magnus · Operations" matches nearly anything, so products need a real hit.
        const inWhere = wordScore(word, screen.where);
        const best = Math.max(inLabel * 2, inWhere >= 40 ? inWhere : 0);
        if (best === 0) return { screen, index, score: 0 };
        score += best;
      }
      return { screen, index, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.screen);
}

export function viewAvailable(view: string, installed: ProductCheck): view is ViewKey {
  const item = ITEMS.get(view);
  return !!item && gateOpen(item.gate, installed);
}

const SECURITY_PATH = /^\/security-fusion(?:\/|$)/;

/** The browser address for a Magnus page. */
export const magnusAddress = (path: string): string => (path === '/' ? FLEET_PREFIX : FLEET_PREFIX + path);

/**
 * Chooses the opening view for a bookmark. A link to a product that is not installed
 * lands on the overview, and `url` then drops the dead address from the location bar.
 */
export function resolveDeepLink(
  location: { pathname: string; search: string },
  installed: ProductCheck,
): { view: ViewKey; url: string | null } {
  // Magnus owns everything under /fleet, query included, so its pages may paginate with ?page=.
  const fleetPath = isFleetPath(location.pathname);
  if (fleetPath && viewAvailable('magnus', installed)) return { view: 'magnus', url: null };
  const page = new URLSearchParams(location.search).get('page');
  if (page === 'magnus' && viewAvailable('magnus', installed)) return { view: 'magnus', url: FLEET_PREFIX };
  if (page !== null && viewAvailable(page, installed)) return { view: page, url: null };
  const securityPath = SECURITY_PATH.test(location.pathname);
  // Cindertrace also uses ?page= for its own pagination, so its paths are honoured here.
  if (securityPath && viewAvailable('security', installed)) return { view: 'security', url: null };
  return { view: 'hive', url: page !== null || securityPath || fleetPath ? '/' : null };
}
