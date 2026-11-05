// Work package: fleet. See PORTING.md. Only this package's agent edits this file.
import type { MagnusRoute } from './types';

export const fleetRoutes: readonly MagnusRoute[] = [
  { path: '/', title: 'Fleet Overview', load: () => import('../pages/fleet/overview/page') },
  { path: '/mission-control', title: 'Mission Control', load: () => import('../pages/fleet/mission-control/page') },
  { path: '/nodes', title: 'Nodes', load: () => import('../pages/fleet/nodes/page') },
  { path: '/application-operations', title: 'Application Operations', load: () => import('../pages/fleet/application-operations/page') },
  { path: '/fleet-readiness', title: 'Fleet Readiness', load: () => import('../pages/fleet/readiness/page') },
  { path: '/anomalies', title: 'Anomalies', load: () => import('../pages/fleet/anomalies/page') },
  { path: '/anomalies/:anomalyId', title: 'Anomaly Analysis', load: () => import('../pages/fleet/anomalies/detail/page') },
  { path: '/anomalies/remediation', title: 'Auto-Remediation', load: () => import('../pages/fleet/anomalies/remediation/page') },
  { path: '/notifications', title: 'Notifications', load: () => import('../pages/fleet/notifications/page') },
  { path: '/nodes/:nodeId', title: 'Node', load: () => import('../pages/fleet/node-detail/page') },
  { path: '/fleet-map', title: 'Fleet Map', load: () => import('../pages/fleet/fleet-map/page') },
];
