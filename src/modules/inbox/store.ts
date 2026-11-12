// The inbox's live state: one store per signed-in person, shared by the header bell and the Inbox
// page, so the feeds are read once however many views show them. It reads the Registry catalog,
// reads every announced feed in parallel with a per-product timeout, merges what arrives and polls
// every minute while the tab is visible.
import { useEffect, useSyncExternalStore } from 'react';
import { readRegistryCatalog, type RegistryEntry } from '../../lib/registry';
import { productInstalled, registryEntryPresented } from '../../lib/runtime';
import { apiFetch, type Product } from '../../lib/transport';
import {
  browserStorage,
  countUnread,
  discoverFeeds,
  latest,
  mergeEvents,
  newestPerProduct,
  readFeed,
  readSeen,
  writeSeen,
  type FeedFetch,
  type FeedProgress,
  type FeedSource,
  type HiveEvent,
  type ReadState,
  type SeenPosition,
  type SeenStorage,
} from './feeds';

export const POLL_MS = 60_000;
export const FEED_TIMEOUT_MS = 5_000;
/** How long a catalog read is trusted before the Registry is asked again. */
export const CATALOG_MS = 5 * 60_000;

/** One product's feed, as the last round left it. */
export interface SourceStatus {
  product: Product;
  name: string;
  state: 'loading' | 'ready' | 'failed';
  /** Why the last read failed. Plain text for the "couldn't reach" row. */
  error?: string;
}
export interface InboxSnapshot {
  /** `loading` until the first round ends; `error` only when the Registry was never read. */
  phase: 'loading' | 'ready' | 'error';
  registryError: string | null;
  sources: readonly SourceStatus[];
  events: readonly HiveEvent[];
  read: ReadState;
  unread: number;
}

/** Magnus's own read flags, where its notifications API exposes them. */
export interface MagnusReads {
  readFlags: (signal: AbortSignal) => Promise<ReadonlyMap<string, boolean>>;
  markAllRead: () => Promise<void>;
}

export interface InboxOptions {
  subject: string;
  request?: FeedFetch;
  readCatalog?: () => Promise<RegistryEntry[]>;
  installed?: (product: Product) => boolean;
  storage?: SeenStorage | null;
  magnus?: MagnusReads | null;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  /** The document whose visibility pauses polling. */
  document?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> | null;
}

export interface InboxStore {
  subscribe: (listener: () => void) => () => void;
  snapshot: () => InboxSnapshot;
  /** Keep polling while at least one view holds the store. Returns the release. */
  retain: () => () => void;
  /** One round now; resolves when it ends. */
  refresh: () => Promise<void>;
  /** Advance every product's last-seen position, and Magnus's own flags. Rejects if Magnus refused. */
  markAllRead: () => Promise<void>;
}

const describe = (error: unknown): string => (error instanceof Error && error.message ? error.message : 'It could not be reached');

export function createInboxStore(options: InboxOptions): InboxStore {
  const {
    subject,
    request = apiFetch as FeedFetch,
    readCatalog = () => readRegistryCatalog(registryEntryPresented),
    installed = productInstalled,
    storage = browserStorage(),
    magnus = null,
    timeoutMs = FEED_TIMEOUT_MS,
    pollMs = POLL_MS,
    now = Date.now,
  } = options;
  const doc = options.document === undefined ? (typeof document === 'undefined' ? null : document) : options.document;

  let sources: FeedSource[] | null = null;
  let catalogAt = 0;
  const cursors = new Map<Product, string | null>();
  let snapshot: InboxSnapshot = { phase: 'loading', registryError: null, sources: [], events: [], read: { seen: {}, magnusRead: new Map() }, unread: 0 };
  const listeners = new Set<() => void>();
  let holders = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let lastRound = 0;
  let stopped = new AbortController();

  function update(next: Partial<InboxSnapshot>): void {
    const merged = { ...snapshot, ...next };
    snapshot = { ...merged, unread: countUnread(merged.events, merged.read) };
    for (const listener of [...listeners]) listener();
  }
  // What this page marked read. With storage blocked it is all there is, until the page reloads.
  const marked = new Map<string, SeenPosition>();
  /** Each product's position: the stored one (another tab may have moved it) or this page's, the later. */
  function seenFor(list: readonly FeedSource[]): ReadState['seen'] {
    const seen: Record<string, SeenPosition> = {};
    for (const source of list) {
      const stored = readSeen(storage, subject, source.product);
      const mine = marked.get(source.product);
      const position = stored && mine ? latest(stored, mine) : (stored ?? mine);
      if (position) seen[source.product] = position;
    }
    return seen;
  }

  /** Abort after the per-product budget, or when the store stops. */
  function deadline(): { signal: AbortSignal; done: () => void } {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const stop = () => controller.abort();
    stopped.signal.addEventListener('abort', stop, { once: true });
    return {
      signal: controller.signal,
      done: () => {
        clearTimeout(timeout);
        stopped.signal.removeEventListener('abort', stop);
      },
    };
  }

  async function round(): Promise<void> {
    if (!sources || now() - catalogAt >= CATALOG_MS) {
      try {
        sources = discoverFeeds(await readCatalog(), installed);
        catalogAt = now();
      } catch (error) {
        // A catalog read before keeps working; only a first failure is the page's error.
        if (!sources) {
          update({ phase: 'error', registryError: describe(error) });
          return;
        }
      }
    }
    const list = sources;
    const statuses = new Map<Product, SourceStatus>(snapshot.sources.map((status) => [status.product, status]));
    update({
      registryError: null,
      sources: list.map((source) => statuses.get(source.product) ?? { product: source.product, name: source.name, state: 'loading' }),
      read: { ...snapshot.read, seen: seenFor(list) },
    });
    const results = await Promise.all(
      list.map(async (source): Promise<{ progress: FeedProgress; status: SourceStatus }> => {
        const progress: FeedProgress = { events: [], cursor: cursors.get(source.product) ?? null, dropped: 0 };
        const { signal, done } = deadline();
        try {
          await readFeed(source, progress, request, signal);
          return { progress, status: { product: source.product, name: source.name, state: 'ready' } };
        } catch (error) {
          return { progress, status: { product: source.product, name: source.name, state: 'failed', error: describe(error) } };
        } finally {
          done();
          cursors.set(source.product, progress.cursor);
        }
      }),
    );
    let magnusRead = snapshot.read.magnusRead;
    if (magnus && list.some((source) => source.product === 'magnus')) {
      const { signal, done } = deadline();
      try {
        magnusRead = await magnus.readFlags(signal);
      } catch {
        // Without Magnus's flags the cursor alone decides, as for every other product.
      } finally {
        done();
      }
    }
    const products = new Set(list.map((source) => source.product as string));
    const events = mergeEvents(
      snapshot.events.filter((event) => products.has(event.product)),
      results.flatMap((result) => result.progress.events),
    );
    update({ phase: 'ready', sources: results.map((result) => result.status), events, read: { seen: seenFor(list), magnusRead } });
  }

  function schedule(): void {
    clearTimeout(timer);
    timer = undefined;
    if (holders === 0 || doc?.visibilityState === 'hidden') return;
    timer = setTimeout(() => void refresh(), Math.max(0, lastRound + pollMs - now()));
  }
  function refresh(): Promise<void> {
    inFlight ??= round().finally(() => {
      inFlight = undefined;
      lastRound = now();
      schedule();
    });
    return inFlight;
  }
  const onVisibility = () => {
    if (doc?.visibilityState === 'hidden') {
      clearTimeout(timer);
      timer = undefined;
    } else if (!inFlight) {
      if (now() - lastRound >= pollMs) void refresh();
      else schedule();
    }
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => snapshot,
    retain() {
      holders++;
      if (holders === 1) {
        stopped = new AbortController();
        doc?.addEventListener('visibilitychange', onVisibility);
        if (doc?.visibilityState !== 'hidden') {
          if (lastRound === 0 || now() - lastRound >= pollMs) void refresh();
          else schedule();
        }
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders--;
        if (holders > 0) return;
        clearTimeout(timer);
        timer = undefined;
        doc?.removeEventListener('visibilitychange', onVisibility);
        stopped.abort();
      };
    },
    refresh,
    async markAllRead() {
      const seen: Partial<Record<string, SeenPosition>> = { ...snapshot.read.seen };
      for (const [product, position] of newestPerProduct(snapshot.events)) {
        const next = latest(seen[product], position);
        seen[product] = next;
        marked.set(product, next);
        writeSeen(storage, subject, product, next);
      }
      update({ read: { ...snapshot.read, seen } });
      if (magnus && snapshot.sources.some((source) => source.product === 'magnus')) {
        await magnus.markAllRead();
        update({ read: { ...snapshot.read, magnusRead: new Map([...snapshot.read.magnusRead.keys()].map((id) => [id, true])) } });
      }
    },
  };
}

// ------------------------------------------------------------------------------------------------
// The page's one store, per signed-in person.

let current: { subject: string; store: InboxStore } | undefined;
let magnusReads: Promise<MagnusReads> | undefined;
const loadMagnusReads = () => (magnusReads ??= import('./magnus-reads').then((module) => module.magnusReads));

/** The store for this person. Signing in as someone else starts afresh. */
export function inboxFor(subject: string): InboxStore {
  if (current?.subject !== subject) {
    const lazyMagnus: MagnusReads = {
      readFlags: async (signal) => (await loadMagnusReads()).readFlags(signal),
      markAllRead: async () => (await loadMagnusReads()).markAllRead(),
    };
    current = { subject, store: createInboxStore({ subject, magnus: lazyMagnus }) };
  }
  return current.store;
}

/** Hold the store while mounted and read its snapshot. */
export function useInbox(store: InboxStore): InboxSnapshot {
  useEffect(() => store.retain(), [store]);
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}
