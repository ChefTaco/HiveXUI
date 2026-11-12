import { describe, expect, it } from 'vitest';
import { activeMagnusNavPath, MAGNUS_NAV, visibleMagnusNav } from '../nav';
import { fleetRoutes } from './fleet';
import { hasRoute, MAGNUS_ROUTES, matchRoute, type MagnusRoute } from './index';

const load = async () => ({ default: () => null });
const route = (path: string): MagnusRoute => ({ path, title: path, load });

describe('route matching', () => {
  const routes = [route('/nodes/:nodeId'), route('/nodes/tags'), route('/nodes'), route('/')];
  it('finds the root, static and parameter routes, and decodes parameters', () => {
    expect(matchRoute('/', routes)?.route.path).toBe('/');
    expect(matchRoute('/nodes', routes)?.route.path).toBe('/nodes');
    expect(matchRoute('/nodes/a%20b', routes)).toMatchObject({ route: { path: '/nodes/:nodeId' }, params: { nodeId: 'a b' } });
  });
  it('prefers a literal path to a parameter, in any file order', () => {
    expect(matchRoute('/nodes/tags', routes)?.route.path).toBe('/nodes/tags');
  });
  it('does not match a longer path or a malformed parameter', () => {
    expect(matchRoute('/nodes/a/b', routes)).toBeNull();
    expect(matchRoute('/nodes/%zz', routes)).toBeNull();
    expect(matchRoute('/other', routes)).toBeNull();
  });
});

describe('the route files', () => {
  it('declare each path once, without the /fleet prefix', () => {
    const paths = MAGNUS_ROUTES.map((item) => item.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.filter((path) => /^\/fleet(\/|$)/.test(path))).toEqual([]);
  });
  it('load each page from its own dynamic import', () => {
    for (const item of fleetRoutes) expect(item.load.toString()).toContain('import');
  });
  it('give every list page an entry in the one navigation file', () => {
    const listed = new Set(MAGNUS_NAV.flatMap((section) => section.items.map((item) => item.path)));
    const lists = MAGNUS_ROUTES.filter((item) => !item.path.includes(':')).map((item) => item.path);
    expect(lists.filter((path) => !listed.has(path))).toEqual([]);
  });
  it('have ported the first pages', () => {
    for (const path of ['/', '/mission-control', '/nodes']) expect(hasRoute(path)).toBe(true);
    expect(hasRoute('/nodes?page=2')).toBe(true);
  });
});

describe('the sidebar data', () => {
  const sections = [
    { label: 'Fleet', items: [{ path: '/nodes', label: 'Nodes', icon: 'Server' as const }, { path: '/', label: 'Overview', icon: 'Gauge' as const, roles: ['ADMIN'] as const }, { path: '/not-ported', label: 'Later', icon: 'Book' as const }] },
    { label: 'Hermes', capability: 'hermes' as const, items: [{ path: '/mission-control', label: 'Control', icon: 'Gauge' as const }] },
    { label: 'Nothing yet', items: [{ path: '/not-ported', label: 'Later', icon: 'Book' as const }] },
  ];
  it('shows only ported pages and drops empty sections', () => {
    const visible = visibleMagnusNav({ role: 'ADMIN', hermes: false }, sections);
    expect(visible.map((section) => section.label)).toEqual(['Fleet']);
    expect(visible[0]!.items.map((item) => item.path)).toEqual(['/nodes', '/']);
  });
  it('hides Hermes sections unless the capability is true', () => {
    expect(visibleMagnusNav({ role: 'VIEWER' }, sections).map((section) => section.label)).toEqual(['Fleet']);
    expect(visibleMagnusNav({ role: 'VIEWER', hermes: true }, sections).map((section) => section.label)).toEqual(['Fleet', 'Hermes']);
  });
  it('hides role-limited pages until the session says otherwise', () => {
    expect(visibleMagnusNav({}, sections)[0]!.items.map((item) => item.path)).toEqual(['/nodes']);
    expect(visibleMagnusNav({ role: 'VIEWER' }, sections)[0]!.items.map((item) => item.path)).toEqual(['/nodes']);
  });
  it('lights the longest matching entry, and the root only on the root', () => {
    expect(activeMagnusNavPath('/')).toBe('/');
    expect(activeMagnusNavPath('/nodes/abc')).toBe('/nodes');
    expect(activeMagnusNavPath('/anomalies/remediation')).toBe('/anomalies/remediation');
    expect(activeMagnusNavPath('/anomalies/abc')).toBe('/anomalies');
    expect(activeMagnusNavPath('/nodesque')).toBeNull();
  });
  it('removes what the owner removed: terminal, federation, control nodes, the login page, Cindertrace and the Hermes proxy report', () => {
    const paths = MAGNUS_NAV.flatMap((section) => section.items.map((item) => item.path));
    for (const path of ['/login', '/security-fusion', '/orchestra/web-gateway', '/hermes-security', '/terminal', '/federation']) expect(paths).not.toContain(path);
  });
});
