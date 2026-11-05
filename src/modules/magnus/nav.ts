// The Magnus sidebar, in one data file. It lists every page the module will have, so porting a
// page never touches it: an entry appears as soon as its path is in a routes/*.ts file. Labels
// must be unique across the whole sidebar, because the console walkthrough names screenshots after
// them (navigation.test.ts enforces this). Pure data and no React, because the shell imports it.
import { hasRoute, type ConsoleRole, type MagnusCapability } from './routes';

export type MagnusNavIcon = 'Activity' | 'Alert' | 'Book' | 'Gauge' | 'Hexagon' | 'Key' | 'Route' | 'Scroll' | 'Server' | 'Settings';
export interface MagnusNavItem {
  path: string;
  label: string;
  icon: MagnusNavIcon;
  roles?: readonly ConsoleRole[];
}
export interface MagnusNavSection {
  label: string;
  capability?: MagnusCapability;
  items: readonly MagnusNavItem[];
}
/** What the signed-in session allows. Unknown until GET /console/session answers. */
export interface MagnusNavContext {
  role?: ConsoleRole | undefined;
  hermes?: boolean | undefined;
}

export const MAGNUS_NAV: readonly MagnusNavSection[] = [
  {
    label: 'Magnus',
    items: [
      { path: '/mission-control', label: 'Mission Control', icon: 'Gauge' },
      { path: '/', label: 'Fleet overview', icon: 'Hexagon' },
      { path: '/nodes', label: 'Nodes', icon: 'Server' },
      { path: '/application-operations', label: 'Applications', icon: 'Activity' },
      { path: '/fleet-readiness', label: 'Readiness', icon: 'Gauge' },
      { path: '/fleet-map', label: 'Fleet map', icon: 'Route' },
      { path: '/anomalies', label: 'Anomalies', icon: 'Alert' },
      { path: '/anomalies/remediation', label: 'Remediation', icon: 'Alert' },
      { path: '/notifications', label: 'Notifications', icon: 'Settings' },
    ],
  },
  {
    label: 'Magnus operations',
    items: [
      { path: '/commands', label: 'Commands', icon: 'Server' },
      { path: '/governor/operations', label: 'Fleet operations', icon: 'Route' },
      { path: '/rollouts', label: 'Rollouts', icon: 'Route' },
      { path: '/incidents', label: 'Fleet incidents', icon: 'Alert' },
      { path: '/cron', label: 'Cron jobs', icon: 'Activity' },
      { path: '/files', label: 'Files', icon: 'Book' },
      { path: '/logs', label: 'Logs', icon: 'Scroll' },
      { path: '/audit', label: 'Fleet audit', icon: 'Scroll' },
      { path: '/webhooks', label: 'Webhooks', icon: 'Route' },
      { path: '/api-docs', label: 'Fleet API', icon: 'Book' },
    ],
  },
  {
    label: 'Magnus provisioning',
    items: [
      { path: '/roles', label: 'Node roles', icon: 'Key' },
      { path: '/library', label: 'Library', icon: 'Book' },
      { path: '/skills', label: 'Installed skills', icon: 'Scroll' },
    ],
  },
  {
    label: 'Hermes Agent',
    capability: 'hermes',
    items: [
      { path: '/orchestra', label: 'Hermes overview', icon: 'Hexagon' },
      { path: '/orchestra/installations', label: 'Hermes installations', icon: 'Server' },
      { path: '/orchestra/profiles', label: 'Hermes profiles', icon: 'Key' },
      { path: '/hermes-drift', label: 'Drift cockpit', icon: 'Route' },
      { path: '/hermes-security', label: 'Proxy security', icon: 'Alert' },
    ],
  },
  {
    label: 'Magnus Ardent',
    items: [
      { path: '/ardent', label: 'Ardent overview', icon: 'Hexagon' },
      { path: '/ardent/installations', label: 'Ardent installations', icon: 'Server' },
      { path: '/ardent/profiles', label: 'Ardent profiles', icon: 'Key' },
    ],
  },
  {
    label: 'Codex Agent',
    items: [
      { path: '/codex', label: 'Codex overview', icon: 'Hexagon' },
      { path: '/codex/installations', label: 'Codex installations', icon: 'Server' },
    ],
  },
];

/** Sections to show: ported pages this session may open, without empty sections. */
export function visibleMagnusNav(context: MagnusNavContext = {}, sections: readonly MagnusNavSection[] = MAGNUS_NAV): MagnusNavSection[] {
  return sections
    .filter((section) => section.capability !== 'hermes' || context.hermes === true)
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => hasRoute(item.path) && (!item.roles || (context.role !== undefined && item.roles.includes(context.role)))),
    }))
    .filter((section) => section.items.length > 0);
}

/** The sidebar entry for a page: the longest path that contains it, so details light their list. */
export function activeMagnusNavPath(path: string, sections: readonly MagnusNavSection[] = MAGNUS_NAV): string | null {
  let best: string | null = null;
  for (const section of sections)
    for (const { path: candidate } of section.items)
      if ((candidate === path || (candidate !== '/' && path.startsWith(candidate + '/'))) && (best === null || candidate.length > best.length))
        best = candidate;
  return best;
}
