import { afterEach, describe, expect, it, vi } from 'vitest';
import { seenKey } from './feeds';
import { createInboxStore, type InboxOptions, type MagnusReads } from './store';
import { hiveEvent, memoryStorage, page, registryEntry, throwingStorage } from './test-fixtures';

const CATALOG = [
  registryEntry('magnus', 'Magnus', '/hive/events'),
  registryEntry('cindertrace', 'Cindertrace', '/api/v1/hive/events'),
  registryEntry('hiveskills', 'HiveSkills', '/v1/hive/events'),
];
type Answer = Response | Promise<Response> | 'hang';
/** Answers per product by URL; 'hang' waits until the read is aborted. */
function feeds(answers: Record<string, () => Answer>) {
  const asked: string[] = [];
  const request = (path: string, init: RequestInit): Promise<Response> => {
    asked.push(path);
    const product = /^\/api\/([a-z]+)\//.exec(path)?.[1] ?? '';
    const answer = answers[product]?.() ?? Response.json({ error: 'not found' }, { status: 404 });
    if (answer !== 'hang') return Promise.resolve(answer);
    return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  };
  return { request, asked };
}
const store = (options: Partial<InboxOptions> & Pick<InboxOptions, 'request'>) =>
  createInboxStore({ subject: 'usr_a', readCatalog: async () => CATALOG, installed: () => true, storage: memoryStorage(), document: null, timeoutMs: 50, ...options });

afterEach(() => vi.useRealTimers());

describe('the inbox store', () => {
  it('merges every announced feed, newest first, deduplicated by ID', async () => {
    const shared = hiveEvent('magnus', 1, 5);
    const { request } = feeds({
      magnus: () => Response.json(page([shared, shared, hiveEvent('magnus', 2, 1)])),
      cindertrace: () => Response.json(page([hiveEvent('cindertrace', 1, 3)])),
      hiveskills: () => Response.json(page([hiveEvent('hiveskills', 1, 9)])),
    });
    const inbox = store({ request });
    await inbox.refresh();
    const snapshot = inbox.snapshot();
    expect(snapshot.phase).toBe('ready');
    expect(snapshot.events.map((event) => event.id)).toEqual(['hiveskills:record:1:opened', 'magnus:record:1:opened', 'cindertrace:record:1:opened', 'magnus:record:2:opened']);
    expect(snapshot.sources.map((source) => source.state)).toEqual(['ready', 'ready', 'ready']);
    expect(snapshot.unread).toBe(4);
  });

  it('isolates a product that times out or fails: the others still show', async () => {
    const { request } = feeds({
      magnus: () => 'hang',
      cindertrace: () => Response.json({ error: { code: 'internal' } }, { status: 500 }),
      hiveskills: () => Response.json(page([hiveEvent('hiveskills', 1, 1)])),
    });
    const inbox = store({ request });
    const started = Date.now();
    await inbox.refresh();
    expect(Date.now() - started).toBeLessThan(2000);
    const { sources, events } = inbox.snapshot();
    expect(sources).toEqual([
      { product: 'magnus', name: 'Magnus', state: 'failed', error: 'It did not answer in time' },
      { product: 'cindertrace', name: 'Cindertrace', state: 'failed', error: 'It answered 500' },
      { product: 'hiveskills', name: 'HiveSkills', state: 'ready' },
    ]);
    expect(events.map((event) => event.id)).toEqual(['hiveskills:record:1:opened']);
  });

  it('asks again after the last cursor it was given', async () => {
    // The first round reads a page and catches up; the second starts from the last cursor.
    const answers = [page([hiveEvent('magnus', 1, 1)], 'm1'), page([]), page([hiveEvent('magnus', 2, 2)])];
    const { request, asked } = feeds({ magnus: () => Response.json(answers.shift()) });
    const inbox = store({ request, readCatalog: async () => [CATALOG[0]!] });
    await inbox.refresh();
    await inbox.refresh();
    expect(asked).toEqual(['/api/magnus/hive/events?limit=200', '/api/magnus/hive/events?after=m1&limit=200', '/api/magnus/hive/events?after=m1&limit=200']);
    expect(inbox.snapshot().events.map((event) => event.id)).toEqual(['magnus:record:2:opened', 'magnus:record:1:opened']);
  });

  it('shows the Registry failure only when it has never been read', async () => {
    const { request } = feeds({ magnus: () => Response.json(page([])) });
    let fail = true;
    const inbox = store({
      request,
      readCatalog: async () => {
        if (fail) throw new Error('The Hive Registry could not be read');
        return [CATALOG[0]!];
      },
    });
    await inbox.refresh();
    expect(inbox.snapshot()).toMatchObject({ phase: 'error', registryError: 'The Hive Registry could not be read' });
    fail = false;
    await inbox.refresh();
    expect(inbox.snapshot()).toMatchObject({ phase: 'ready', registryError: null });
  });

  it('marks all read: stores each product’s newest position for this person', async () => {
    const storage = memoryStorage();
    const { request } = feeds({
      cindertrace: () => Response.json(page([hiveEvent('cindertrace', 1, 1), hiveEvent('cindertrace', 2, 2)])),
    });
    const inbox = store({ request, storage, readCatalog: async () => [CATALOG[1]!] });
    await inbox.refresh();
    expect(inbox.snapshot().unread).toBe(2);
    await inbox.markAllRead();
    expect(inbox.snapshot().unread).toBe(0);
    expect(JSON.parse(storage.getItem(seenKey('usr_a', 'cindertrace'))!)).toEqual({ occurredAt: hiveEvent('cindertrace', 2, 2).occurredAt, id: 'cindertrace:record:2:opened' });
    // A new person on the same browser starts unread.
    const other = createInboxStore({ subject: 'usr_b', request, storage, readCatalog: async () => [CATALOG[1]!], installed: () => true, document: null });
    await other.refresh();
    expect(other.snapshot().unread).toBe(2);
  });

  it('keeps marks for the page’s life when storage throws', async () => {
    const { request } = feeds({ cindertrace: () => Response.json(page([hiveEvent('cindertrace', 1, 1)])) });
    const inbox = store({ request, storage: throwingStorage(), readCatalog: async () => [CATALOG[1]!] });
    await inbox.refresh();
    await inbox.markAllRead();
    await inbox.refresh();
    expect(inbox.snapshot().unread).toBe(0);
  });

  it('uses Magnus’s own read flags and marks them read through its API', async () => {
    const markAllRead = vi.fn(async () => {});
    const magnus: MagnusReads = { readFlags: async () => new Map([['n-1', true], ['n-2', false]]), markAllRead };
    const { request } = feeds({
      magnus: () => Response.json(page([hiveEvent('magnus', 1, 1, { sourceRef: 'n-1' }), hiveEvent('magnus', 2, 2, { sourceRef: 'n-2' })])),
    });
    const inbox = store({ request, magnus, readCatalog: async () => [CATALOG[0]!] });
    await inbox.refresh();
    expect(inbox.snapshot().unread).toBe(1);
    await inbox.markAllRead();
    expect(markAllRead).toHaveBeenCalledOnce();
    expect(inbox.snapshot().unread).toBe(0);
  });

  it('counts by the cursor alone when Magnus’s flags cannot be read, and reports a refused mark', async () => {
    const magnus: MagnusReads = { readFlags: async () => Promise.reject(new Error('down')), markAllRead: async () => Promise.reject(new Error('refused')) };
    const { request } = feeds({ magnus: () => Response.json(page([hiveEvent('magnus', 1, 1, { sourceRef: 'n-1' })])) });
    const inbox = store({ request, magnus, readCatalog: async () => [CATALOG[0]!] });
    await inbox.refresh();
    expect(inbox.snapshot()).toMatchObject({ phase: 'ready', unread: 1 });
    await expect(inbox.markAllRead()).rejects.toThrow('refused');
    // The cursor still moved.
    expect(inbox.snapshot().unread).toBe(0);
  });

  it('polls every minute while visible, pauses while hidden and stops when released', async () => {
    vi.useFakeTimers();
    const listeners = new Set<() => void>();
    const doc = { visibilityState: 'visible' as DocumentVisibilityState, addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) };
    const { request, asked } = feeds({ magnus: () => Response.json(page([])) });
    const inbox = store({ request, document: doc as unknown as Document, readCatalog: async () => [CATALOG[0]!], now: () => Date.now() });
    const release = inbox.retain();
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(asked).toHaveLength(2);
    doc.visibilityState = 'hidden';
    for (const listener of listeners) listener();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(asked).toHaveLength(2);
    doc.visibilityState = 'visible';
    for (const listener of listeners) listener();
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toHaveLength(3);
    release();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(asked).toHaveLength(3);
    expect(listeners.size).toBe(0);
  });
});
