import { MAGNUS_NAV, visibleMagnusNav, type MagnusNavContext } from '../modules/magnus/nav';
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
  | 'Activity'
  | 'Alert'
  | 'Book'
  | 'Gauge'
  | 'Hexagon'
  | 'Key'
  | 'Route'
  | 'Scroll'
  | 'Server'
  | 'Settings';

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
}
export type ProductCheck = (product: Product) => boolean;

const OATHWEAVE: ProductGate = { all: ['oathweave'] };
const EMBERPATH: ProductGate = { all: ['emberpath'] };
const HIVEMEM: ProductGate = { all: ['hivemem'] };
const MAGNUS: ProductGate = { all: ['magnus'] };

function magnusGroups(context?: MagnusNavContext): NavGroup[] {
  return (context ? visibleMagnusNav(context) : MAGNUS_NAV).map((section) => ({
    label: section.label,
    items: section.items.map((item): NavItem => ({ key: 'magnus', label: item.label, icon: item.icon, gate: MAGNUS, path: item.path })),
  }));
}

const PRODUCT_GROUPS: readonly NavGroup[] = [
  {
    label: 'Hive',
    items: [
      { key: 'hive', label: 'Hive', icon: 'Hexagon' },
      // Correlates failures from whichever of these products is present; each source is optional.
      { key: 'incidents', label: 'Incidents', icon: 'Alert', gate: { any: ['emberpath', 'oathweave', 'hivemem'] } },
    ],
  },
  {
    label: 'Oathweave',
    items: [
      { key: 'iam-overview', label: 'Overview', icon: 'Gauge', gate: OATHWEAVE },
      { key: 'account', label: 'Account security', icon: 'Key', gate: OATHWEAVE },
      { key: 'iam-users', label: 'Users', icon: 'Key', gate: OATHWEAVE },
      { key: 'iam-roles', label: 'Roles', icon: 'Scroll', gate: OATHWEAVE },
      { key: 'iam-service-accounts', label: 'Service Accounts', icon: 'Server', gate: OATHWEAVE },
      { key: 'iam-clients', label: 'Clients', icon: 'Route', gate: OATHWEAVE },
      { key: 'iam-sessions', label: 'Sessions', icon: 'Activity', gate: OATHWEAVE },
      { key: 'iam-system-users', label: 'System Users', icon: 'Settings', gate: OATHWEAVE },
      { key: 'iam-security', label: 'Security', icon: 'Alert', gate: OATHWEAVE },
      { key: 'iam-audit', label: 'Audit', icon: 'Book', gate: OATHWEAVE },
      // The browser only calls Oathweave, but every enrollment links an Emberpath key
      // and a HiveMem agent; the coordinator is unusable without both.
      { key: 'actors', label: 'Actors', icon: 'Key', gate: { all: ['oathweave', 'emberpath', 'hivemem'] } },
    ],
  },
  {
    label: 'Emberpath',
    items: [
      { key: 'routers', label: 'Routers', icon: 'Gauge', gate: EMBERPATH },
      { key: 'providers', label: 'Providers', icon: 'Server', gate: EMBERPATH },
      { key: 'routing', label: 'Routing', icon: 'Route', gate: EMBERPATH },
      { key: 'testing', label: 'Testing', icon: 'Hexagon', gate: EMBERPATH },
      { key: 'traces', label: 'Traces', icon: 'Activity', gate: EMBERPATH },
      { key: 'keys', label: 'API Keys', icon: 'Key', gate: EMBERPATH },
      { key: 'audit', label: 'Audit Log', icon: 'Scroll', gate: EMBERPATH },
    ],
  },
  {
    label: 'HiveMem',
    items: [
      { key: 'memories', label: 'Memories', icon: 'Activity', gate: HIVEMEM },
      { key: 'workspaces', label: 'Workspaces', icon: 'Activity', gate: HIVEMEM },
    ],
  },
  {
    label: 'HiveSkills',
    items: [{ key: 'skills', label: 'Skills', icon: 'Scroll', gate: { all: ['hiveskills'] } }],
  },
  {
    label: 'Cindertrace',
    items: [{ key: 'security', label: 'Cindertrace', icon: 'Alert', gate: { all: ['cindertrace'] } }],
  },
  {
    label: 'ChatterMost',
    items: [{ key: 'chat', label: 'ChatterMost', icon: 'Activity', gate: { all: ['chattermost'] } }],
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
export const NAV_GROUPS: readonly NavGroup[] = [...PRODUCT_GROUPS, ...magnusGroups(), SYSTEM_GROUP];

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
  return [...PRODUCT_GROUPS, ...magnusGroups(magnus), SYSTEM_GROUP].map((group) => ({
    label: group.label,
    items: group.items.filter((item) => gateOpen(item.gate, installed)),
  })).filter((group) => group.items.length > 0);
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
