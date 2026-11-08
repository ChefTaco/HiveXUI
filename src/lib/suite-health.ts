import { registryHealthSchema } from '@contracts/hive-registry/browser';
import { REGISTRY_PREFIX } from './registry';
import { browserIdentity, productInstalled } from './runtime';
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
  { product: 'ardentstudio', name: 'Ardent Project Studio', path: '/api/ardentstudio/health/ready' },
];
export const REGISTRY_ROW = 'hive-registry';
export interface ServiceReadiness {
  product: Product | typeof REGISTRY_ROW;
  name: string;
  path: string;
  state: 'ready' | 'denied' | 'unavailable';
  message: string;
  /** Every installation must run this, so it is reported whatever runtime.json configures. */
  required?: boolean;
  latencyMs?: number;
}
/**
 * The Registry's own row. It takes no sign-in, and apiFetch would send it to Emberpath with a
 * token. A 200 only counts with the Registry's own answer, so a page served in its place fails.
 */
export async function readRegistryHealth(
  request: typeof fetch = fetch,
): Promise<ServiceReadiness> {
  const row = {
    product: REGISTRY_ROW,
    name: 'Registry',
    path: `${REGISTRY_PREFIX}/health/ready`,
    required: true,
  } as const;
  const failed = 'Required, and the readiness check failed';
  try {
    const started = performance.now(),
      response = await request(row.path, {
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      }),
      latencyMs = Math.round(performance.now() - started);
    const ready =
      response.ok &&
      registryHealthSchema.safeParse(await response.json().catch(() => null))
        .success;
    return {
      ...row,
      state: ready ? 'ready' : 'unavailable',
      message: ready ? 'Install catalog readiness check passed' : failed,
      latencyMs,
    };
  } catch {
    return { ...row, state: 'unavailable', message: 'Required, and its endpoint is unreachable' };
  }
}
export async function readSuiteHealth(
  send: typeof apiFetch = apiFetch,
  // Legacy recovery talks to the native console API, which has no Registry behind it.
  registry: (() => Promise<ServiceReadiness>) | null = browserIdentity() ? readRegistryHealth : null,
): Promise<ServiceReadiness[]> {
  const products = Promise.all(
    // Only installed products are probed or reported; an absent one leaves no row.
    readiness
      .filter((service) => productPrefix(service.product) && productInstalled(service.product))
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
  const [registryRow, rows] = await Promise.all([registry?.(), products]);
  return registryRow ? [registryRow, ...rows] : rows;
}
export async function readConsoleHealth(): Promise<HiveStatus> {
  // These apps are Oathweave, Emberpath and HiveMem, so the Registry would be probed for nothing.
  const rows = await readSuiteHealth(apiFetch, null);
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
