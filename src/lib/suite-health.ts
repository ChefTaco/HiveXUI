import { apiFetch, productPrefix, type Product } from './transport';
import type { HiveStatus } from './types';
export const readiness: ReadonlyArray<{
  product: Product;
  name: string;
  path: string;
}> = [
  { product: 'oathweave', name: 'Oathweave', path: '/api/iam/health/ready' },
  { product: 'emberpath', name: 'Emberpath', path: '/api/health/ready' },
  { product: 'hivemem', name: 'HiveMem', path: '/api/memory/health/ready' },
  { product: 'hiveskills', name: 'HiveSkills', path: '/api/skills/healthz' },
  {
    product: 'cindertrace',
    name: 'Cindertrace',
    path: '/api/security/health/ready',
  },
  {
    product: 'chattermost',
    name: 'ChatterMost',
    path: '/api/chat/api/v4/system/ping',
  },
  { product: 'magnus', name: 'Magnus', path: '/api/magnus/health/ready' },
];
export interface ServiceReadiness {
  product: Product;
  name: string;
  path: string;
  state: 'ready' | 'denied' | 'unavailable';
  message: string;
  latencyMs?: number;
}
export async function readSuiteHealth(
  send: typeof apiFetch = apiFetch,
): Promise<ServiceReadiness[]> {
  return Promise.all(
    // Only installed products are probed or reported; an absent one leaves no row.
    readiness
      .filter((service) => productPrefix(service.product))
      .map(async (service): Promise<ServiceReadiness> => {
        try {
          const started = performance.now(),
            response = await send(service.path, {
              signal: AbortSignal.timeout(5000),
            });
          return {
            ...service,
            state: response.ok
              ? ('ready' as const)
              : response.status === 401 || response.status === 403
                ? ('denied' as const)
                : ('unavailable' as const),
            message: response.ok
              ? 'Product readiness check passed'
              : response.status === 401 || response.status === 403
                ? 'This identity cannot inspect this product'
                : 'Readiness check failed',
            latencyMs: Math.round(performance.now() - started),
          };
        } catch {
          return {
            ...service,
            state: 'unavailable' as const,
            message:
              'Product endpoint is unreachable or sign-in is not configured',
          };
        }
      }),
  );
}
export async function readConsoleHealth(): Promise<HiveStatus> {
  const rows = await readSuiteHealth();
  const keys = {
    oathweave: 'iam',
    emberpath: 'router',
    hivemem: 'memory',
  } as const;
  return {
    generatedAt: new Date().toISOString(),
    uiUrl: location.origin,
    apps: rows
      .filter(
        (row): row is typeof row & { product: keyof typeof keys } =>
          row.product in keys,
      )
      .map((row) => ({
        key: keys[row.product],
        name: row.name,
        role: 'Independent product API',
        status: row.state === 'ready' ? 'online' : 'offline',
        summary: row.message,
        internalUrl: '',
        publicUrl: productPrefix(row.product) ?? '',
        consoleUrl: '',
        checks: [
          {
            name: 'readiness',
            status: row.state === 'ready' ? 'pass' : 'warn',
            message: row.message,
          },
        ],
        ...(row.latencyMs !== undefined ? { latencyMs: row.latencyMs } : {}),
      })),
  };
}
