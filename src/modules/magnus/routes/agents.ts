// Work package: agents. See PORTING.md. Only this package's agent edits this file.
import type { MagnusRoute } from './types';

// The API serves /ardent and /codex to ADMIN only.
const ADMIN = ['ADMIN'] as const;

export const agentsRoutes: readonly MagnusRoute[] = [
  { path: '/ardent', title: 'Magnus Ardent', roles: ADMIN, load: () => import('../pages/agents/ardent/page') },
  { path: '/ardent/installations', title: 'Ardent installations', roles: ADMIN, load: () => import('../pages/agents/ardent/installations/page') },
  { path: '/ardent/profiles', title: 'Ardent profiles', roles: ADMIN, load: () => import('../pages/agents/ardent/profiles/page') },
  { path: '/ardent/profiles/:id', title: 'Ardent profile', roles: ADMIN, load: () => import('../pages/agents/ardent/profile/page') },
  { path: '/codex', title: 'Codex agents', roles: ADMIN, load: () => import('../pages/agents/codex/page') },
  { path: '/codex/installations', title: 'Codex installations', roles: ADMIN, load: () => import('../pages/agents/codex/installations/page') },
  { path: '/orchestra', title: 'Hermes agents', capability: 'hermes', load: () => import('../pages/agents/orchestra/page') },
  { path: '/orchestra/installations', title: 'Hermes installations', capability: 'hermes', load: () => import('../pages/agents/orchestra/installations/page') },
  { path: '/orchestra/profiles', title: 'Hermes profiles', capability: 'hermes', load: () => import('../pages/agents/orchestra/profiles/page') },
  { path: '/hermes-drift', title: 'Hermes drift cockpit', capability: 'hermes', load: () => import('../pages/agents/hermes-drift/page') },
];
