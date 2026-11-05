// Work package: operations. See PORTING.md. Only this package's agent edits this file.
import type { MagnusRoute } from './types';

export const operationsRoutes: readonly MagnusRoute[] = [
  { path: '/commands', title: 'Command Dispatch', roles: ['ADMIN', 'OPERATOR'], load: () => import('../pages/operations/commands/page') },
  { path: '/logs', title: 'Log Explorer', load: () => import('../pages/operations/logs/page') },
  { path: '/audit', title: 'Audit Log', load: () => import('../pages/operations/audit/page') },
  { path: '/cron', title: 'Cron Jobs', roles: ['ADMIN', 'OPERATOR'], load: () => import('../pages/operations/cron/page') },
  { path: '/files', title: 'File Manager', roles: ['ADMIN', 'OPERATOR'], load: () => import('../pages/operations/files/page') },
  { path: '/incidents', title: 'Incident Workspace', load: () => import('../pages/operations/incidents/page') },
  { path: '/rollouts', title: 'Guided Rollouts', load: () => import('../pages/operations/rollouts/page') },
  { path: '/governor/operations', title: 'Operations', load: () => import('../pages/operations/governor-operations/page') },
  { path: '/webhooks', title: 'Webhooks', roles: ['ADMIN'], load: () => import('../pages/operations/webhooks/page') },
  // Also serves /webhooks/new. A literal route would need its own sidebar entry (routes.test.ts).
  { path: '/webhooks/:id', title: 'Webhook', roles: ['ADMIN'], load: () => import('../pages/operations/webhooks/detail-page') },
  { path: '/api-docs', title: 'API Documentation', load: () => import('../pages/operations/api-docs/page') },
];
