// The Magnus sidebar sections, in one data file. The shell shows them as parts of one product. It lists every page the module will have, so porting a
// page never touches it: an entry appears as soon as its path is in a routes/*.ts file. Labels
// must be unique across the whole sidebar, because the console walkthrough names screenshots after
// them (navigation.test.ts enforces this). Pure data and no React, because the shell imports it.
import { hasRoute, type ConsoleRole, type MagnusCapability } from './routes';

export type MagnusNavIcon = 'Activity' | 'Alert' | 'Bell' | 'Book' | 'BookOpen' | 'Clock' | 'Compass' | 'Dashboard' | 'FileText' | 'Gauge' | 'HeartPulse' | 'Hexagon' | 'Key' | 'Library' | 'Map' | 'Package' | 'Puzzle' | 'Route' | 'Scroll' | 'Server' | 'Settings' | 'Shield' | 'Siren' | 'Sliders' | 'Terminal' | 'Webhook' | 'Zap';
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
    label: 'Fleet',
    items: [
      { path: '/mission-control', label: 'Mission Control', icon: 'Compass' },
      { path: '/', label: 'Fleet overview', icon: 'Dashboard' },
      { path: '/nodes', label: 'Nodes', icon: 'Server' },
      { path: '/application-operations', label: 'Applications', icon: 'HeartPulse' },
      { path: '/fleet-readiness', label: 'Readiness', icon: 'Gauge' },
      { path: '/fleet-map', label: 'Fleet map', icon: 'Map' },
      { path: '/anomalies', label: 'Anomalies', icon: 'Siren' },
      { path: '/anomalies/remediation', label: 'Remediation', icon: 'Zap' },
      { path: '/notifications', label: 'Notifications', icon: 'Bell' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { path: '/commands', label: 'Commands', icon: 'Terminal', roles: ['ADMIN', 'OPERATOR'] },
      { path: '/governor/operations', label: 'Fleet operations', icon: 'Sliders' },
      { path: '/rollouts', label: 'Rollouts', icon: 'Package' },
      { path: '/incidents', label: 'Fleet incidents', icon: 'Activity' },
      { path: '/cron', label: 'Cron jobs', icon: 'Clock', roles: ['ADMIN', 'OPERATOR'] },
      { path: '/files', label: 'Files', icon: 'FileText', roles: ['ADMIN', 'OPERATOR'] },
      { path: '/logs', label: 'Logs', icon: 'Scroll' },
      { path: '/audit', label: 'Fleet audit', icon: 'Shield' },
      { path: '/webhooks', label: 'Webhooks', icon: 'Webhook', roles: ['ADMIN'] },
      { path: '/api-docs', label: 'Fleet API', icon: 'BookOpen' },
    ],
  },
  {
    label: 'Provisioning',
    items: [
      { path: '/roles', label: 'Node roles', icon: 'Key' },
      { path: '/library', label: 'Library', icon: 'Library' },
      { path: '/skills', label: 'Installed skills', icon: 'Puzzle' },
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
    ],
  },
  {
    label: 'Ardent',
    items: [
      { path: '/ardent', label: 'Ardent overview', icon: 'Hexagon', roles: ['ADMIN'] },
      { path: '/ardent/installations', label: 'Ardent installations', icon: 'Server', roles: ['ADMIN'] },
      { path: '/ardent/profiles', label: 'Ardent profiles', icon: 'Key', roles: ['ADMIN'] },
    ],
  },
  {
    label: 'Codex',
    items: [
      { path: '/codex', label: 'Codex overview', icon: 'Hexagon', roles: ['ADMIN'] },
      { path: '/codex/installations', label: 'Codex installations', icon: 'Server', roles: ['ADMIN'] },
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
