// Made-up feeds for the inbox tests. Tests only; nothing in the console imports it.
import type { RegistryEntry } from '../../lib/registry';
import type { HiveEvent, HiveEventSeverity } from './feeds';

export const BASE = Date.parse('2026-11-10T12:00:00.000Z');

export function hiveEvent(product: string, n: number, minutes: number, extra: Partial<HiveEvent> & Record<string, unknown> = {}): HiveEvent {
  return {
    id: `${product}:record:${n}:opened`,
    product,
    type: 'record.opened',
    severity: 'warning' as HiveEventSeverity,
    title: `${product} event ${n}`,
    summary: `Something happened in ${product}.`,
    occurredAt: new Date(BASE + minutes * 60_000).toISOString(),
    link: { product, path: '/security-fusion/cases/case-1' },
    ...extra,
  };
}

/** A Registry entry; `feed` is the capability path, on the connection unless `onProduct`. */
export function registryEntry(id: string, displayName: string, feed: string | null, options: { onProduct?: boolean; browserPrefix?: string | null } = {}): RegistryEntry {
  const capabilities = feed ? { 'events.v1': { path: feed } } : undefined;
  return {
    product: {
      id,
      displayName,
      description: '',
      links: { repository: null, documentation: null, license: null, licenseSpdx: null },
      consoleSection: null,
      required: false,
      installed: true,
      dependencies: [],
      ...(options.onProduct && capabilities ? { capabilities } : {}),
    },
    connection: {
      id,
      consolePath: null,
      browserPrefix: options.browserPrefix === undefined ? `/api/${id}` : options.browserPrefix,
      nativeApis: {},
      documentation: null,
      ...(!options.onProduct && capabilities ? { capabilities } : {}),
    },
  };
}

/** A feed page body. */
export const page = (data: unknown[], nextCursor: string | null = null) => ({ data, nextCursor });

/** Storage over a Map, or one that throws on every call. */
export function memoryStorage(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
}
export const throwingStorage = (): Pick<Storage, 'getItem' | 'setItem'> => ({
  getItem: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('full', 'QuotaExceededError');
  },
});
