// The inbox's data rules, with no React: which products serve a HiveEvent feed, reading one feed,
// merging feeds, the per-user last-seen cursors and what counts as unread. The store (./store)
// runs these on a timer; the tests run them directly.
import { HIVE_EVENT_SEVERITIES, isPage, validateHiveEvent, type HiveEvent, type HiveEventSeverity } from '@hivemagnus/hive-common/contracts';
import type { RegistryEntry } from '../../lib/registry';
import { productFor, type Product } from '../../lib/transport';

export type { HiveEvent, HiveEventSeverity };
export const HIVE_SEVERITIES = HIVE_EVENT_SEVERITIES;

/** The capability a product announces in the Hive Registry when it serves a feed. */
export const EVENTS_CAPABILITY = 'events.v1';
/** Events the browser keeps after merging, newest first. */
export const MAX_EVENTS = 500;
/** Events asked for per page, the most a feed serves. */
export const PAGE_LIMIT = 200;
/** Pages read for one product in one round, so a feed that never ends cannot hold the round. */
export const MAX_PAGES = 10;

/** One product's feed, as the Registry announces it. */
export interface FeedSource {
  product: Product;
  /** The Registry's display name, for "couldn't reach <name>". */
  name: string;
  /** Same-origin API path of the feed, through the product's browser prefix. */
  url: string;
}

/** The feed URL for a browser prefix and the capability's path, or null when it is not a safe API path. */
export function feedUrl(browserPrefix: string, path: string): string | null {
  const url = browserPrefix.replace(/\/+$/, '') + (path.startsWith('/') ? path : `/${path}`);
  if (!url.startsWith('/api/') || url.startsWith('//') || /[\\?#\s\u0000-\u001f]/.test(url)) return null;
  if (url.split('/').some((segment) => segment === '.' || segment === '..')) return null;
  return url;
}

/**
 * The installed products that announce `events.v1`, in Registry order. A product's feed must be
 * sent to that product's own API: a path that the transport would route to another product (and
 * so send another product's token to) is ignored.
 */
export function discoverFeeds(entries: readonly RegistryEntry[], installed: (product: Product) => boolean): FeedSource[] {
  const sources: FeedSource[] = [];
  for (const { product, connection } of entries) {
    const capability = connection?.capabilities?.[EVENTS_CAPABILITY] ?? product.capabilities?.[EVENTS_CAPABILITY];
    const prefix = connection?.browserPrefix;
    if (!capability || !prefix) continue;
    const url = feedUrl(prefix, capability.path);
    if (!url) continue;
    const owner = productFor(url);
    if (owner !== product.id || !installed(owner) || sources.some((source) => source.product === owner)) continue;
    sources.push({ product: owner, name: product.displayName, url });
  }
  return sources;
}

/** Where a read stopped: the events it kept, and the last cursor it was given. */
export interface FeedProgress {
  events: HiveEvent[];
  cursor: string | null;
  /** Events that failed validation, or claimed another product. Counted, never shown. */
  dropped: number;
}

export type FeedFetch = (path: string, init: RequestInit) => Promise<Response>;

export class FeedError extends Error {
  override name = 'FeedError';
  constructor(
    readonly kind: 'timeout' | 'status' | 'malformed' | 'network',
    readonly status?: number,
  ) {
    super(kind === 'timeout' ? 'It did not answer in time' : kind === 'status' ? `It answered ${status}` : kind === 'malformed' ? 'It sent a feed this console cannot read' : 'It could not be reached');
  }
}

/**
 * Read a feed from `progress.cursor` until it is caught up or MAX_PAGES. Pages are added to
 * `progress` as they arrive, so a later page failing keeps what the earlier ones gave. Each event is
 * validated on its own: one bad event is dropped, not the page.
 */
export async function readFeed(source: FeedSource, progress: FeedProgress, request: FeedFetch, signal: AbortSignal): Promise<void> {
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams();
    if (progress.cursor) query.set('after', progress.cursor);
    query.set('limit', String(PAGE_LIMIT));
    let response: Response;
    try {
      response = await request(`${source.url}?${query.toString()}`, { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    } catch (error) {
      throw signal.aborted ? new FeedError('timeout') : error instanceof FeedError ? error : new FeedError('network');
    }
    if (!response.ok) throw new FeedError('status', response.status);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw signal.aborted ? new FeedError('timeout') : new FeedError('malformed');
    }
    if (!isPage(body) || (body.nextCursor !== null && (typeof body.nextCursor !== 'string' || body.nextCursor === ''))) throw new FeedError('malformed');
    for (const item of body.data) {
      const result = validateHiveEvent(item);
      if (result.ok && result.value.product === source.product) progress.events.push(result.value);
      else progress.dropped++;
    }
    if (body.nextCursor === null) return;
    progress.cursor = body.nextCursor;
  }
}

/** Display order: newest first; the ID breaks a tie so the order never flickers. */
export function compareNewestFirst(a: HiveEvent, b: HiveEvent): number {
  return Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/** Merge new events into a list: one per ID (the first one seen stays), newest first, at most `max`. */
export function mergeEvents(current: readonly HiveEvent[], incoming: readonly HiveEvent[], max = MAX_EVENTS): HiveEvent[] {
  const byId = new Map<string, HiveEvent>();
  for (const event of [...current, ...incoming]) if (!byId.has(event.id)) byId.set(event.id, event);
  return [...byId.values()].sort(compareNewestFirst).slice(0, max);
}

// ------------------------------------------------------------------------------------------------
// Last-seen cursors: one per person and product, in localStorage.

/** A feed position: the newest event a person has seen in one product. */
export interface SeenPosition {
  occurredAt: string;
  id: string;
}
const STORAGE_PREFIX = 'hivexui-inbox:v1';
export const seenKey = (subject: string, product: string): string => `${STORAGE_PREFIX}:${encodeURIComponent(subject)}:${product}`;

/** The minimal Storage this needs, so tests can hand in one that throws. */
export type SeenStorage = Pick<Storage, 'getItem' | 'setItem'>;
export const browserStorage = (): SeenStorage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** The stored position, or null when there is none, it is unreadable or storage is blocked. */
export function readSeen(storage: SeenStorage | null, subject: string, product: string): SeenPosition | null {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(seenKey(subject, product)) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const { occurredAt, id } = parsed as Record<string, unknown>;
    if (typeof occurredAt !== 'string' || typeof id !== 'string' || !Number.isFinite(Date.parse(occurredAt)) || id.length === 0 || id.length > 128) return null;
    return { occurredAt, id };
  } catch {
    return null;
  }
}
/** Store a position. Storage blocked or full: the change lasts until the page reloads. */
export function writeSeen(storage: SeenStorage | null, subject: string, product: string, position: SeenPosition): boolean {
  try {
    if (!storage) return false;
    storage.setItem(seenKey(subject, product), JSON.stringify({ occurredAt: position.occurredAt, id: position.id }));
    return true;
  } catch {
    return false;
  }
}

/** Whether an event comes after a position, in feed order `(occurredAt, id)`. */
export function after(event: SeenPosition, position: SeenPosition | null | undefined): boolean {
  if (!position) return true;
  const difference = Date.parse(event.occurredAt) - Date.parse(position.occurredAt);
  return difference > 0 || (difference === 0 && event.id > position.id);
}
/** The later of two positions. */
export const latest = (a: SeenPosition | null | undefined, b: SeenPosition): SeenPosition => (a && !after(b, a) ? a : { occurredAt: b.occurredAt, id: b.id });

export interface ReadState {
  /** The last-seen position per product. */
  seen: Readonly<Partial<Record<string, SeenPosition>>>;
  /** Magnus's own read flags, by notification ID, where its notifications API has them. */
  magnusRead: ReadonlyMap<string, boolean>;
}
/**
 * Unread: newer than the product's last-seen position. A Magnus event that names a notification
 * (its `sourceRef`) Magnus already marks read is read, whatever the cursor says.
 */
export function isUnread(event: HiveEvent, state: ReadState): boolean {
  if (!after(event, state.seen[event.product])) return false;
  if (event.product === 'magnus' && event.sourceRef !== undefined && state.magnusRead.get(event.sourceRef) === true) return false;
  return true;
}
export const countUnread = (events: readonly HiveEvent[], state: ReadState): number => events.reduce((count, event) => count + (isUnread(event, state) ? 1 : 0), 0);

/** What "Mark all read" moves each product's position to: its newest event. */
export function newestPerProduct(events: readonly HiveEvent[]): Map<string, SeenPosition> {
  const newest = new Map<string, SeenPosition>();
  for (const event of events) newest.set(event.product, latest(newest.get(event.product), event));
  return newest;
}

// ------------------------------------------------------------------------------------------------
// Filters.

export interface InboxFilter {
  /** A product ID, or 'all'. */
  product: string;
  /** A severity, or 'all'. */
  severity: HiveEventSeverity | 'all';
  unreadOnly: boolean;
}
export const NO_FILTER: InboxFilter = { product: 'all', severity: 'all', unreadOnly: false };

export function filterEvents(events: readonly HiveEvent[], filter: InboxFilter, state: ReadState): HiveEvent[] {
  return events.filter(
    (event) =>
      (filter.product === 'all' || event.product === filter.product) &&
      (filter.severity === 'all' || event.severity === filter.severity) &&
      (!filter.unreadOnly || isUnread(event, state)),
  );
}

export const unreadLabel = (count: number): string => (count > 99 ? '99+' : String(count));
