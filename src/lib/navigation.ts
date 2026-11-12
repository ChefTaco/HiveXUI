// What the shell derives from the route table (./routes): sidebar sections, the active entry, the
// breadcrumb, palette screens and the opening view for an address. Pure data and no React.
import type { MagnusNavContext } from '../modules/magnus/nav';
import {
  gateOpen,
  matchSubroute,
  routeAddress,
  routeFor,
  routePath,
  ROUTES,
  underPrefix,
  type NavIcon,
  type ProductCheck,
  type ScreenRoute,
  type SubRoute,
  type ViewKey,
} from './routes';

export type { IamViewKey, NavIcon, ProductCheck, ProductGate, ViewKey } from './routes';

export interface NavItem {
  key: ViewKey;
  label: string;
  icon: NavIcon;
  gate?: ScreenRoute['gate'];
  /** A page of a product that owns a path prefix, in the route's own address space. */
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

const PRODUCT_ICON: Readonly<Record<string, NavIcon>> = {
  Hive: 'Hexagon',
  Magnus: 'Radar',
  Studio: 'Workflow',
  Oathweave: 'Shield',
  Emberpath: 'Route',
  HiveMem: 'Brain',
  HiveSkills: 'Puzzle',
  Cindertrace: 'ScanSearch',
  Embermend: 'Shield',
  ChatterMost: 'Messages',
  System: 'Settings',
};

/** The sidebar sections of a set of routes, in table order. */
function groupsOf(routes: readonly ScreenRoute[], magnus: MagnusNavContext | undefined, installed?: ProductCheck): NavGroup[] {
  const groups: Array<{ label: string; product?: string; items: NavItem[] }> = [];
  for (const route of routes) {
    if (installed && !gateOpen(route.gate, installed)) continue;
    const entries = route.navFor ? route.navFor(magnus) : (route.nav ?? [{ label: route.title, icon: route.icon }]);
    for (const entry of entries) {
      const label = entry.section ?? route.group;
      const product = entry.section ? route.group : undefined;
      let group = groups.find((candidate) => candidate.label === label && candidate.product === product);
      if (!group) groups.push((group = { label, ...(product ? { product } : {}), items: [] }));
      group.items.push({ key: route.id as ViewKey, label: entry.label, icon: entry.icon, ...(route.gate ? { gate: route.gate } : {}), ...(entry.path !== undefined ? { path: entry.path } : {}) });
    }
  }
  return groups;
}

/** Every group and entry, whatever is installed or ported. */
export const NAV_GROUPS: readonly NavGroup[] = groupsOf(ROUTES, undefined);

/**
 * Sections an operator sees: only installed products' pages, and no empty sections. Magnus entries
 * also depend on what has been ported and on what this session's role and capabilities allow.
 */
export function visibleNavGroups(installed: ProductCheck, magnus: MagnusNavContext = {}): NavGroup[] {
  return groupsOf(ROUTES, magnus, installed).filter((group) => group.items.length > 0);
}

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
/** A subroute and the pages above it, nearest last: a record, then its list. */
function subrouteTrail(route: ScreenRoute, path: string): SubRoute[] {
  if (!route.subroutes || !route.prefix) return [];
  const pages = route.subroutes;
  const trail: SubRoute[] = [];
  for (let page = matchSubroute(route.prefix.path, pages, path)?.page; page; page = page.parent ? pages.find((entry) => entry.id === page!.parent) : undefined) trail.unshift(page);
  return trail;
}
const subrouteAddress = (route: ScreenRoute, page: SubRoute): string => (page.path ? `${route.prefix!.path}/${page.path}` : route.prefix!.path);

/**
 * The sidebar entry for a route-relative path. A product with its own pages lights the nearest
 * page above it that has an entry; otherwise the longest entry path that contains it wins, so a
 * record lights its list. A product's home ('/' or the prefix itself) matches only itself.
 */
export function activeNavPath(view: ViewKey, path: string): string | null {
  const route = routeFor(view);
  if (!route?.prefix) return null;
  if (route.subroutes) {
    const page = subrouteTrail(route, path).findLast((entry) => entry.nav);
    return page ? subrouteAddress(route, page) : null;
  }
  const home = new Set(['/', route.prefix.path]);
  let best: string | null = null;
  for (const entry of route.navFor ? route.navFor(undefined) : (route.nav ?? []))
    if (entry.path !== undefined && (entry.path === path || (!home.has(entry.path) && path.startsWith(entry.path + '/'))) && (best === null || entry.path.length > best.length))
      best = entry.path;
  return best;
}
export function findActiveNav(products: readonly NavProduct[], view: ViewKey, navPath: string | null): ActiveNav {
  for (const product of products)
    for (const section of product.sections)
      for (const item of section.items)
        if (item.key === view && (item.path === undefined || item.path === navPath)) return { product, section, item };
  return {};
}

/** Where a page of the shell is: its route, its route-relative path and the entry that holds it. */
export interface ShellLocation {
  view: ViewKey;
  /** The route-relative path. Empty for a screen without a prefix. */
  path: string;
  /** The sidebar entry path for it, or null. */
  navPath: string | null;
}
export function shellLocation(view: ViewKey, pathname: string): ShellLocation {
  const route = routeFor(view);
  if (!route?.prefix) return { view, path: '', navPath: null };
  const path = routePath(route, pathname);
  return { view, path, navPath: activeNavPath(view, path) };
}

/** The top-bar title for a screen at a route-relative path. */
export function titleFor(view: ViewKey, path = ''): string {
  const route = routeFor(view)!;
  return (path && route.pageTitle?.(path)) || route.title;
}

export interface Crumb {
  label: string;
  /** A place to go. Absent for the current page and for headings that are not pages. */
  to?: { view: ViewKey; path?: string | undefined };
}
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
  // A product with its own pages: the lit page, then each page below it down to this one.
  const route = routeFor(item.key);
  if (route?.subroutes && pathname !== '') {
    const trail = subrouteTrail(route, pathname);
    const at = trail.findIndex((page) => page.nav && subrouteAddress(route, page) === item.path);
    if (at >= 0) {
      const pages = trail.slice(at);
      for (const [index, page] of pages.entries())
        crumbs.push(index === pages.length - 1 ? { label: page.nav?.label ?? page.title } : { label: page.nav?.label ?? page.title, to: { view: item.key, path: subrouteAddress(route, page) } });
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
export const showsShellRefresh = (view: ViewKey): boolean => routeFor(view)?.shellRefresh === true;
/** Pages whose content comes from the shared store, where its health and age mean something. */
export const showsShellStatus = (view: ViewKey): boolean => routeFor(view)?.shellStatus === true;

/** Every screen the command palette can open. */
export interface PaletteScreen {
  id: string;
  label: string;
  where: string;
  icon: NavIcon;
  view: ViewKey;
  path?: string;
}
export function paletteScreens(products: readonly NavProduct[]): PaletteScreen[] {
  const screens: PaletteScreen[] = [];
  for (const product of products)
    for (const section of product.sections)
      for (const item of section.items) {
        const where = product.sections.length > 1 ? `${product.label} · ${section.label}` : product.label;
        screens.push({ id: item.path ?? item.key, label: item.label, where, icon: item.icon, view: item.key, ...(item.path !== undefined ? { path: item.path } : {}) });
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
  const route = routeFor(view);
  return !!route && gateOpen(route.gate, installed);
}

/** The browser address for a Magnus page. */
export const magnusAddress = (path: string): string => routeAddress(routeFor('magnus')!, path);
/** The browser address for a view and an optional route-relative path. */
export const viewAddress = (view: ViewKey, path?: string): string => routeAddress(routeFor(view)!, path);

/**
 * Chooses the opening view for an address. A link to a product that is not installed lands on the
 * overview, and `url` then drops the dead address from the location bar. In order: a product that
 * owns its whole prefix (Magnus, Studio), then `?page=`, then a product that shares `?page=` with
 * the shell (Cindertrace), then the overview.
 */
export function resolveDeepLink(
  location: { pathname: string; search: string },
  installed: ProductCheck,
): { view: ViewKey; url: string | null } {
  const prefixed = ROUTES.filter((route): route is Extract<(typeof ROUTES)[number], { prefix: object }> => 'prefix' in route);
  const under = prefixed.filter((route) => underPrefix(location.pathname, route.prefix.path));
  for (const route of under)
    if (route.prefix.ownsQuery && viewAvailable(route.id, installed))
      // A fullscreen product renders outside the shell. The shell only sees its address for the
      // moment before it swaps, and then it must not rewrite the address.
      return { view: 'fullscreen' in route ? 'hive' : route.id, url: null };
  const page = new URLSearchParams(location.search).get('page');
  if (page !== null && viewAvailable(page, installed)) {
    const route = routeFor(page)!;
    if (route.pageMovesToPrefix && route.prefix) return { view: page, url: route.prefix.path };
    if (!route.fullscreen) return { view: page, url: null };
  }
  for (const route of under)
    if (!route.prefix.ownsQuery && viewAvailable(route.id, installed)) return { view: route.id, url: null };
  return { view: 'hive', url: page !== null || under.length > 0 ? '/' : null };
}
