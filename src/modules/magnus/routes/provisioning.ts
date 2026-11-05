// Work package: provisioning. See PORTING.md. Only this package's agent edits this file.
import type { MagnusRoute } from './types';

export const provisioningRoutes: readonly MagnusRoute[] = [
  { path: '/roles', title: 'Node roles', load: () => import('../pages/provisioning/roles/page') },
  { path: '/library', title: 'Library', load: () => import('../pages/provisioning/library/page') },
  { path: '/skills', title: 'Installed skills', load: () => import('../pages/provisioning/skills/page') },
];
