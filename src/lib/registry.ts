import { useSyncExternalStore } from 'react';
import type { z } from 'zod';
import {
  registryConnectionSchema,
  registryInstallationSchema,
  registryProductListSchema,
  type RegistryConnection,
  type RegistryProduct,
} from '@contracts/hive-registry/browser';
import type { Product } from './transport';

/**
 * The Hive Registry: what this installation actually runs. runtime.json stays the bootstrap, with
 * API prefixes and OAuth clients; the Registry says which of those products are installed.
 *
 * Every read here is anonymous on purpose, so it uses fetch and never apiFetch. apiFetch would send
 * this path to Emberpath with a bearer token, and the Registry answers 401 to a credential it does
 * not recognise rather than treating it as public.
 */
export const REGISTRY_PREFIX = '/api/registry';
const READ_TIMEOUT_MS = 5000;
/** How long the first paint may wait. A later answer still applies, through `subscribeRegistry`. */
export const FIRST_PAINT_BUDGET_MS = 300;

export type RegistryState =
  /** Not asked yet, or never asked: legacy recovery and the authorization portal have no Registry. */
  | { status: 'pending' }
  | { status: 'ready'; installationId: string; installed: ReadonlySet<string> }
  /** `empty`: it answered, but listed nothing this console is configured for. */
  | { status: 'unavailable'; reason: 'unreachable' | 'malformed' | 'empty' };

class RegistryError extends Error {
  constructor(readonly reason: 'unreachable' | 'malformed') {
    super('The Hive Registry could not be read');
  }
}

async function read<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(REGISTRY_PREFIX + path, {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
  } catch {
    throw new RegistryError('unreachable');
  }
  if (!response.ok) throw new RegistryError('unreachable');
  const body: unknown = await response.json().catch(() => {
    throw new RegistryError('malformed');
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new RegistryError('malformed');
  return parsed.data;
}

/** Reads what is installed. Never rejects: every failure is a state the console can fall back from. */
export async function readRegistryState(configured: readonly Product[]): Promise<RegistryState> {
  try {
    const installation = await read('/v1/installation', registryInstallationSchema);
    const installed = new Set(installation.products);
    // An installation always has Oathweave, so answering with none of the configured products
    // means the record is not complete: before its first sync, or while activating. Hiding every
    // section would blank the console, so this falls back like any other unusable answer.
    if (configured.length > 0 && !configured.some((product) => installed.has(product)))
      return { status: 'unavailable', reason: 'empty' };
    return { status: 'ready', installationId: installation.id, installed };
  } catch (error) {
    return { status: 'unavailable', reason: error instanceof RegistryError ? error.reason : 'malformed' };
  }
}

const same = (a: RegistryState, b: RegistryState): boolean => {
  if (a.status === 'ready' && b.status === 'ready')
    return a.installationId === b.installationId && a.installed.size === b.installed.size && [...a.installed].every((id) => b.installed.has(id));
  if (a.status === 'unavailable' && b.status === 'unavailable') return a.reason === b.reason;
  return a.status === b.status;
};

let state: RegistryState = { status: 'pending' };
let configuredProducts: readonly Product[] = [];
let inFlight: Promise<void> | undefined;
const listeners = new Set<() => void>();

export const registryState = (): RegistryState => state;
export function subscribeRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const useRegistry = (): RegistryState => useSyncExternalStore(subscribeRegistry, registryState, registryState);

/** The Registry's half of the intersection. Without a usable answer, it has no objection. */
export const registryAllows = (product: Product): boolean => state.status !== 'ready' || state.installed.has(product);

/** Asks again. A repeated answer changes nothing, so polling does not re-render the shell. */
export function refreshRegistry(): Promise<void> {
  inFlight ??= readRegistryState(configuredProducts).then((next) => {
    inFlight = undefined;
    if (same(state, next)) return;
    state = next;
    for (const listener of [...listeners]) listener();
  });
  return inFlight;
}

/** Waits briefly, so a normal load paints the right sections with no flash, but never for long. */
export async function startRegistry(configured: readonly Product[]): Promise<void> {
  configuredProducts = configured;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    refreshRegistry(),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, FIRST_PAINT_BUDGET_MS);
    }),
  ]);
  clearTimeout(timer);
}

/** What the overview says when the Registry cannot be used. */
export function registryWarning(current: RegistryState): string | null {
  if (current.status !== 'unavailable') return null;
  const fallback = 'Sections follow runtime.json until it answers, so one may show a product that is not really installed.';
  if (current.reason === 'empty')
    return `The Hive Registry lists no product this console is configured for, so the installation may still be activating. ${fallback}`;
  if (current.reason === 'malformed')
    return `The Hive Registry sent an answer this console cannot read. Every installation runs one, so something is wrong. ${fallback}`;
  return `The Hive Registry is not answering. Every installation runs one, so something is wrong. ${fallback}`;
}

export interface RegistryEntry {
  product: RegistryProduct;
  /** Null when this product's own connection could not be read. */
  connection: RegistryConnection | null;
}

/**
 * Installed products with their connections. `presented` drops a product before its connection is
 * asked for. A failed connection costs that product its native URLs, not the whole list.
 */
export async function readRegistryCatalog(presented: (id: string) => boolean): Promise<RegistryEntry[]> {
  const { products } = await read('/v1/products?installed=true', registryProductListSchema);
  return Promise.all(
    products
      .filter((product) => product.installed && presented(product.id))
      .map(async (product) => ({
        product,
        connection: await read(`/v1/products/${encodeURIComponent(product.id)}/connection`, registryConnectionSchema).catch(() => null),
      })),
  );
}
