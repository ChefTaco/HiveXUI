// Work package: fleet. See PORTING.md. Only this package's agent edits this file.
import type { MagnusRoute } from './types';

export const fleetRoutes: readonly MagnusRoute[] = [
  { path: '/', title: 'Fleet Overview', load: () => import('../pages/fleet/overview/page') },
  { path: '/mission-control', title: 'Mission Control', load: () => import('../pages/fleet/mission-control/page') },
  { path: '/nodes', title: 'Nodes', load: () => import('../pages/fleet/nodes/page') },
];
