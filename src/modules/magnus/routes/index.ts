import { agentsRoutes } from './agents';
import { fleetRoutes } from './fleet';
import { operationsRoutes } from './operations';
import { provisioningRoutes } from './provisioning';
import type { MagnusRoute } from './types';

export type { ConsoleRole, MagnusCapability, MagnusRoute } from './types';

export const MAGNUS_ROUTES: readonly MagnusRoute[] = [...fleetRoutes, ...operationsRoutes, ...provisioningRoutes, ...agentsRoutes];

export interface RouteMatch {
  route: MagnusRoute;
  params: Record<string, string>;
}

function match(route: MagnusRoute, segments: readonly string[]): Record<string, string> | null {
  const pattern = route.path.split('/').filter(Boolean);
  if (pattern.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (const [index, part] of pattern.entries()) {
    const segment = segments[index]!;
    if (part.startsWith(':')) {
      try {
        params[part.slice(1)] = decodeURIComponent(segment);
      } catch {
        return null;
      }
    } else if (part !== segment) return null;
  }
  return params;
}

/** Literal paths win over parameters, in any file order: /nodes/tags before /nodes/:nodeId. */
export function matchRoute(path: string, routes: readonly MagnusRoute[] = MAGNUS_ROUTES): RouteMatch | null {
  const segments = path.split('/').filter(Boolean);
  const exact = routes.find((route) => !route.path.includes(':') && match(route, segments));
  if (exact) return { route: exact, params: {} };
  for (const route of routes) {
    const params = match(route, segments);
    if (params) return { route, params };
  }
  return null;
}

/** Whether a console path has been ported. Use it to offer a link only once it can be followed. */
export const hasRoute = (path: string): boolean => matchRoute(path.split(/[?#]/, 1)[0]!) !== null;
