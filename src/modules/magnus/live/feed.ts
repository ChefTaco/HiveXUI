// The fleet event feed: the last 50 events and the stream's state. The stream writes to it, and the
// band's marquee and any page's LiveEventList read it. It never reads the network itself.
export type FeedSeverity = 'info' | 'success' | 'warning' | 'error';
export interface FeedEntry {
  id: string;
  at: number;
  channel: string;
  title: string;
  message?: string;
  severity: FeedSeverity;
}
/**
 * What the marquee can honestly say about itself. `waiting` is the short dwell before the stream
 * is opened: entries shown then are recent activity from the API, not live events.
 */
export type LiveStatus = 'waiting' | 'connecting' | 'live' | 'retrying' | 'stopped';
export interface FeedSnapshot {
  connected: boolean;
  status: LiveStatus;
  /** Why the stream is not live, when it has stopped for good. */
  detail?: string;
  entries: readonly FeedEntry[];
}
const LIMIT = 50;
let snapshot: FeedSnapshot = { connected: false, status: 'waiting', entries: [] };
let nextId = 1;
const listeners = new Set<() => void>();
function emit(next: FeedSnapshot): void {
  snapshot = next;
  for (const listener of [...listeners]) listener();
}
export const eventFeed = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: (): FeedSnapshot => snapshot,
  push(entry: Omit<FeedEntry, 'id' | 'at'> & { at?: number }): void {
    emit({ ...snapshot, entries: [{ ...entry, id: `live-${nextId++}`, at: entry.at ?? Date.now() }, ...snapshot.entries].slice(0, LIMIT) });
  },
  /** Recent activity from the API, shown until live events arrive. Live entries are kept. */
  seed(entries: ReadonlyArray<Omit<FeedEntry, 'id'> & { id: string }>): void {
    const live = snapshot.entries.filter((entry) => entry.id.startsWith('live-'));
    emit({ ...snapshot, entries: [...live, ...[...entries].sort((a, b) => b.at - a.at)].slice(0, LIMIT) });
  },
  setStatus(status: LiveStatus, detail?: string): void {
    if (snapshot.status === status && snapshot.detail === detail) return;
    const { detail: _previous, ...rest } = snapshot;
    emit({ ...rest, status, connected: status === 'live', ...(detail ? { detail } : {}) });
  },
  reset(): void {
    emit({ connected: false, status: 'waiting', entries: [] });
  },
};
