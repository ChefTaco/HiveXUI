// Record search for the command palette: the rules, with no React and no product contracts. Each
// installed product the person may read is asked on its own, with its own deadline, and answers as
// it comes; a slow or failing product never holds the others. The live sources are in
// ./record-sources, loaded the first time someone types a search.
import { HiveApiError } from './api-error';
import type { NavIcon } from './routes';
import type { Product } from './transport';

/** How long one product has to answer, permission check included. */
export const RECORD_TIMEOUT_MS = 1500;
/** The pause in typing before products are asked. */
export const RECORD_DEBOUNCE_MS = 200;
/** Shorter searches only match screens. */
export const RECORD_MIN_LENGTH = 2;
/** Records shown per source. */
export const RECORD_CAP = 5;

/** One record a product found. `href` is an address from the route table (`linkTo`). */
export interface RecordHit {
  id: string;
  label: string;
  detail?: string | undefined;
  href: string;
  icon: NavIcon;
}

/** One searchable list in one product. A product can have several (Oathweave users and clients). */
export interface RecordSource {
  /** Unique across sources: `magnus-nodes`. */
  id: string;
  product: Product;
  /** The product's name, which heads its group: "Magnus". */
  name: string;
  /** What the records are, shown beside each one: "Node". */
  kind: string;
  /** Whether the query is worth asking this source at all, such as an ID-shaped query. */
  applies?: (query: string) => boolean;
  /** Whether this person's role may read the list. False hides the source without asking it. */
  allowed: (signal: AbortSignal) => Promise<boolean>;
  /** Matching records, best first. May return more than the cap: one more says there are more. */
  search: (query: string, limit: number, signal: AbortSignal) => Promise<RecordHit[]>;
  /** The product's own page for the full result list, where that page takes the query. */
  seeAll?: (query: string) => string;
}

export type SourceState =
  | { status: 'pending' }
  | { status: 'done'; hits: RecordHit[]; more: boolean; seeAll: string | null }
  /** Did not answer in time, or answered with an error. Shown as a quiet note. */
  | { status: 'failed' }
  /** Not this person's to read: not shown at all. */
  | { status: 'hidden' };

/** The query as products receive it, or null when it is too short to search records. */
export function recordQuery(query: string): string | null {
  const trimmed = query.trim().replace(/\s+/g, ' ');
  return trimmed.length >= RECORD_MIN_LENGTH ? trimmed.slice(0, 200) : null;
}

/** The sources to ask: their product is installed and the query suits them. */
export function eligibleSources(sources: readonly RecordSource[], query: string, installed: (product: Product) => boolean): RecordSource[] {
  return sources.filter((source) => installed(source.product) && (source.applies?.(query) ?? true));
}

/** A refusal: this person cannot read the list. The source is hidden, not reported. */
export const isDenied = (error: unknown): boolean => error instanceof HiveApiError && (error.status === 401 || error.status === 403);

/** Every word of the query appears in one of the fields, ignoring case. For lists filtered here. */
export function matchesQuery(query: string, ...fields: ReadonlyArray<string | null | undefined>): boolean {
  const text = fields.filter((field): field is string => typeof field === 'string').join('\n').toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => text.includes(word));
}

/** An exact ID: one token of letters, digits and `_-.:`, with at least one digit, 6 to 128 long. */
export const looksLikeId = (query: string): boolean => /^[A-Za-z0-9_.:-]{6,128}$/.test(query) && /\d/.test(query);

export interface RunOptions {
  timeoutMs?: number;
  cap?: number;
}

/**
 * Ask every source at once. `onUpdate` hears each source's state as it changes: pending first, then
 * one answer. The returned function cancels whatever is still running, without further updates.
 */
export function runRecordSearch(query: string, sources: readonly RecordSource[], onUpdate: (id: string, state: SourceState) => void, options: RunOptions = {}): () => void {
  const timeoutMs = options.timeoutMs ?? RECORD_TIMEOUT_MS;
  const cap = options.cap ?? RECORD_CAP;
  let cancelled = false;
  const controllers: AbortController[] = [];
  for (const source of sources) {
    const controller = new AbortController();
    controllers.push(controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    onUpdate(source.id, { status: 'pending' });
    const settle = (state: SourceState) => {
      clearTimeout(timer);
      if (!cancelled) onUpdate(source.id, state);
    };
    // A deadline that loses the race to a source ignoring its signal still wins here.
    const deadline = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    deadline.catch(() => {});
    void (async () => {
      if (!(await Promise.race([source.allowed(controller.signal), deadline]))) return settle({ status: 'hidden' });
      const hits = await Promise.race([source.search(query, cap + 1, controller.signal), deadline]);
      const more = hits.length > cap;
      settle({ status: 'done', hits: hits.slice(0, cap), more, seeAll: more && source.seeAll ? source.seeAll(query) : null });
    })().catch((error: unknown) => {
      if (cancelled && !timedOut) return;
      settle(!timedOut && isDenied(error) ? { status: 'hidden' } : { status: 'failed' });
    });
  }
  return () => {
    cancelled = true;
    for (const controller of controllers) controller.abort();
  };
}

/** One product's part of the palette: its records, and whether it is still searching or failed. */
export interface RecordGroup {
  product: Product;
  name: string;
  entries: Array<{ source: RecordSource; hit: RecordHit } | { source: RecordSource; seeAll: string }>;
  pending: boolean;
  failed: boolean;
}

/** Groups by product, in source order. A product with nothing to show and nothing pending is left out. */
export function groupRecords(sources: readonly RecordSource[], states: ReadonlyMap<string, SourceState>): RecordGroup[] {
  const groups: RecordGroup[] = [];
  for (const source of sources) {
    const state = states.get(source.id);
    if (!state || state.status === 'hidden') continue;
    let group = groups.find((entry) => entry.product === source.product);
    if (!group) groups.push((group = { product: source.product, name: source.name, entries: [], pending: false, failed: false }));
    if (state.status === 'pending') group.pending = true;
    else if (state.status === 'failed') group.failed = true;
    else {
      for (const hit of state.hits) group.entries.push({ source, hit });
      if (state.seeAll) group.entries.push({ source, seeAll: state.seeAll });
    }
  }
  return groups.filter((group) => group.entries.length > 0 || group.pending || group.failed);
}
