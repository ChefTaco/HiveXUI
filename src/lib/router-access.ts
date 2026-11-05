import type { AdminUser } from './types';
import { can } from './permissions';
import type { Product } from './transport';
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
/** Background reads for the shell: never a product that is not installed. */
export function allowedStoreResource(
  key: string,
  user: AdminUser | null,
  browser: boolean,
  installed: (product: Product) => boolean,
): boolean {
  if (!browser || installed('emberpath'))
    return allowedRouterResource(key, user, browser);
  // Without Emberpath only Incidents remains; each source applies its own product's permission.
  return (
    key === 'incidents' &&
    (['oathweave', 'hivemem'] as const).some(installed)
  );
}
