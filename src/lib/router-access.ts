import type { AdminUser } from './types';
import { can } from './permissions';
const permissions: Record<string, string> = {
  providers: 'router:providers:read',
  aliases: 'router:routing:read',
  routeRules: 'router:routing:read',
  heuristics: 'router:routing:read',
  clientKeys: 'router:keys:read',
  telemetry: 'router:admin:read',
  incidents: 'router:admin:read',
  traces: 'router:admin:read',
  audit: 'router:admin:read',
  runtimeSettings: 'router:settings:read',
  docs: 'router:admin:read',
};
export function allowedRouterResource(
  key: string,
  user: AdminUser | null,
  browser: boolean,
): boolean {
  return !browser || (!!permissions[key] && can(user, permissions[key]!));
}
