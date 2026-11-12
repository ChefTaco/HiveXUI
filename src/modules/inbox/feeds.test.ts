import { describe, expect, it } from 'vitest';
import {
  after,
  countUnread,
  discoverFeeds,
  feedUrl,
  filterEvents,
  isUnread,
  mergeEvents,
  MAX_PAGES,
  NO_FILTER,
  readFeed,
  readSeen,
  seenKey,
  unreadLabel,
  writeSeen,
  type FeedProgress,
  type FeedSource,
  type ReadState,
} from './feeds';
import { hiveEvent, memoryStorage, page, registryEntry, throwingStorage } from './test-fixtures';

const everything = () => true;
const noReads: ReadState = { seen: {}, magnusRead: new Map() };
const source: FeedSource = { product: 'cindertrace', name: 'Cindertrace', url: '/api/cindertrace/hive/events' };
const fresh = (cursor: string | null = null): FeedProgress => ({ events: [], cursor, dropped: 0 });

describe('which products serve a feed', () => {
  it('reads events.v1 from the connection, or from the product, through the browser prefix', () => {
    const feeds = discoverFeeds(
      [
        registryEntry('magnus', 'Magnus', '/hive/events'),
        registryEntry('cindertrace', 'Cindertrace', '/hive/events', { onProduct: true }),
        registryEntry('hiveskills', 'HiveSkills', null),
      ],
      everything,
    );
    expect(feeds).toEqual([
      { product: 'magnus', name: 'Magnus', url: '/api/magnus/hive/events' },
      { product: 'cindertrace', name: 'Cindertrace', url: '/api/cindertrace/hive/events' },
    ]);
  });
  it('skips a product that is not installed here, has no browser prefix, or is unknown to the console', () => {
    expect(discoverFeeds([registryEntry('magnus', 'Magnus', '/hive/events')], (product) => product !== 'magnus')).toEqual([]);
    expect(discoverFeeds([registryEntry('magnus', 'Magnus', '/hive/events', { browserPrefix: null })], everything)).toEqual([]);
    expect(discoverFeeds([registryEntry('hive-registry', 'Hive Registry', '/v1/hive/events')], everything)).toEqual([]);
  });
  it('never sends one product the path of another, which would carry the wrong token', () => {
    expect(discoverFeeds([registryEntry('cindertrace', 'Cindertrace', '/hive/events', { browserPrefix: '/api/magnus' })], everything)).toEqual([]);
  });
  it('builds only same-origin API paths', () => {
    expect(feedUrl('/api/magnus/', '/hive/events')).toBe('/api/magnus/hive/events');
    expect(feedUrl('/api/magnus', '/../oathweave/hive')).toBeNull();
    expect(feedUrl('/other', '/hive/events')).toBeNull();
    expect(feedUrl('/api/magnus', '/hive/events?x=1')).toBeNull();
  });
});

describe('reading one feed', () => {
  it('asks after the cursor, follows nextCursor until caught up and keeps the last cursor', async () => {
    const asked: string[] = [];
    const pages = [page([hiveEvent('cindertrace', 1, 1)], 'c1'), page([hiveEvent('cindertrace', 2, 2)], 'c2'), page([])];
    const progress = fresh('c0');
    await readFeed(source, progress, async (path) => (asked.push(path), Response.json(pages.shift())), new AbortController().signal);
    expect(asked).toEqual([
      '/api/cindertrace/hive/events?after=c0&limit=200',
      '/api/cindertrace/hive/events?after=c1&limit=200',
      '/api/cindertrace/hive/events?after=c2&limit=200',
    ]);
    expect(progress.events.map((event) => event.id)).toEqual(['cindertrace:record:1:opened', 'cindertrace:record:2:opened']);
    expect(progress.cursor).toBe('c2');
  });
  it('starts from the beginning without a cursor, and stops after MAX_PAGES', async () => {
    let calls = 0;
    const progress = fresh();
    await readFeed(source, progress, async (path) => {
      if (calls === 0) expect(path).toBe('/api/cindertrace/hive/events?limit=200');
      calls++;
      return Response.json(page([], `c${calls}`));
    }, new AbortController().signal);
    expect(calls).toBe(MAX_PAGES);
    expect(progress.cursor).toBe(`c${MAX_PAGES}`);
  });
  it('drops invalid events, and events that claim another product, without losing the rest', async () => {
    const progress = fresh();
    const good = hiveEvent('cindertrace', 1, 1);
    const invalid = [
      { ...hiveEvent('cindertrace', 2, 2), severity: 'urgent' },
      { ...hiveEvent('cindertrace', 3, 3), occurredAt: 'yesterday' },
      { ...hiveEvent('cindertrace', 4, 4), link: { product: 'cindertrace', path: 'https://example.com/phish' } },
      { ...hiveEvent('cindertrace', 5, 5), title: '' },
      'not an event',
      hiveEvent('magnus', 6, 6),
    ];
    await readFeed(source, progress, async () => Response.json(page([good, ...invalid])), new AbortController().signal);
    expect(progress.events).toEqual([good]);
    expect(progress.dropped).toBe(invalid.length);
  });
  it('keeps only the fields it validated', async () => {
    const progress = fresh();
    await readFeed(source, progress, async () => Response.json(page([{ ...hiveEvent('cindertrace', 1, 1), secret: 'x' }])), new AbortController().signal);
    expect(progress.events[0]).not.toHaveProperty('secret');
  });
  it('fails on a refusal or a body that is not a feed page, keeping earlier pages', async () => {
    const progress = fresh();
    const answers = [Response.json(page([hiveEvent('cindertrace', 1, 1)], 'c1')), Response.json({ error: { code: 'forbidden' } }, { status: 403 })];
    await expect(readFeed(source, progress, async () => answers.shift()!, new AbortController().signal)).rejects.toMatchObject({ kind: 'status', status: 403 });
    expect(progress.events).toHaveLength(1);
    expect(progress.cursor).toBe('c1');
    await expect(readFeed(source, fresh(), async () => Response.json({ items: [] }), new AbortController().signal)).rejects.toMatchObject({ kind: 'malformed' });
    await expect(readFeed(source, fresh(), async () => new Response('<html>', { status: 200 }), new AbortController().signal)).rejects.toMatchObject({ kind: 'malformed' });
  });
  it('reports an aborted read as a timeout', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(readFeed(source, fresh(), async () => { throw new DOMException('aborted', 'AbortError'); }, controller.signal)).rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('merging feeds', () => {
  it('shows the newest first across products, with the ID breaking a tie', () => {
    const merged = mergeEvents([hiveEvent('magnus', 1, 10)], [hiveEvent('cindertrace', 1, 30), hiveEvent('hiveskills', 1, 20), hiveEvent('cindertrace', 2, 10)]);
    expect(merged.map((event) => event.id)).toEqual(['cindertrace:record:1:opened', 'hiveskills:record:1:opened', 'magnus:record:1:opened', 'cindertrace:record:2:opened']);
  });
  it('keeps one event per ID: the first one seen', () => {
    const first = hiveEvent('magnus', 1, 10);
    const again = { ...first, title: 'changed' };
    const merged = mergeEvents([first], [again, again]);
    expect(merged).toEqual([first]);
  });
  it('keeps at most the newest max events', () => {
    const merged = mergeEvents([], [1, 2, 3, 4].map((n) => hiveEvent('magnus', n, n)), 2);
    expect(merged.map((event) => event.id)).toEqual(['magnus:record:4:opened', 'magnus:record:3:opened']);
  });
});

describe('last-seen cursors', () => {
  it('stores one position per person and product', () => {
    const storage = memoryStorage();
    expect(writeSeen(storage, 'usr_a', 'magnus', { occurredAt: '2026-11-10T12:00:00.000Z', id: 'magnus:x' })).toBe(true);
    expect(readSeen(storage, 'usr_a', 'magnus')).toEqual({ occurredAt: '2026-11-10T12:00:00.000Z', id: 'magnus:x' });
    expect(readSeen(storage, 'usr_b', 'magnus')).toBeNull();
    expect(readSeen(storage, 'usr_a', 'cindertrace')).toBeNull();
    expect([...storage.map.keys()]).toEqual([seenKey('usr_a', 'magnus')]);
  });
  it('treats an unreadable stored value as no position', () => {
    const storage = memoryStorage();
    for (const value of ['{', '"text"', '{"occurredAt":"soon","id":"x"}', '{"occurredAt":"2026-11-10T12:00:00Z"}'])
      storage.setItem(seenKey('usr_a', 'magnus'), value), expect(readSeen(storage, 'usr_a', 'magnus')).toBeNull();
  });
  it('survives storage that throws, or no storage at all', () => {
    expect(readSeen(throwingStorage(), 'usr_a', 'magnus')).toBeNull();
    expect(writeSeen(throwingStorage(), 'usr_a', 'magnus', { occurredAt: '2026-11-10T12:00:00Z', id: 'x' })).toBe(false);
    expect(readSeen(null, 'usr_a', 'magnus')).toBeNull();
    expect(writeSeen(null, 'usr_a', 'magnus', { occurredAt: '2026-11-10T12:00:00Z', id: 'x' })).toBe(false);
  });
  it('orders positions by time, then ID', () => {
    const at = { occurredAt: '2026-11-10T12:00:00.000Z', id: 'b' };
    expect(after({ occurredAt: '2026-11-10T12:00:01.000Z', id: 'a' }, at)).toBe(true);
    expect(after({ occurredAt: '2026-11-10T12:00:00Z', id: 'c' }, at)).toBe(true);
    expect(after({ occurredAt: '2026-11-10T12:00:00Z', id: 'b' }, at)).toBe(false);
    expect(after({ occurredAt: '2026-11-10T11:59:59Z', id: 'z' }, at)).toBe(false);
  });
});

describe('unread', () => {
  const events = [hiveEvent('magnus', 1, 1), hiveEvent('magnus', 2, 2, { sourceRef: 'n-2' }), hiveEvent('magnus', 3, 3, { sourceRef: 'n-3' }), hiveEvent('cindertrace', 1, 1), hiveEvent('cindertrace', 2, 2)];
  it('counts everything as unread without a last-seen position', () => {
    expect(countUnread(events, noReads)).toBe(5);
  });
  it('counts only events newer than each product’s last-seen position', () => {
    const state: ReadState = { seen: { magnus: { occurredAt: events[1]!.occurredAt, id: events[1]!.id }, cindertrace: { occurredAt: events[4]!.occurredAt, id: events[4]!.id } }, magnusRead: new Map() };
    expect(events.filter((event) => isUnread(event, state)).map((event) => event.id)).toEqual(['magnus:record:3:opened']);
  });
  it('respects Magnus’s own read flag for the notification an event names', () => {
    const state: ReadState = { seen: {}, magnusRead: new Map([['n-2', true], ['n-3', false]]) };
    expect(isUnread(events[1]!, state)).toBe(false);
    expect(isUnread(events[2]!, state)).toBe(true);
    expect(countUnread(events, state)).toBe(4);
    // Another product's sourceRef never matches a Magnus notification.
    expect(isUnread(hiveEvent('cindertrace', 9, 9, { sourceRef: 'n-2' }), state)).toBe(true);
  });
  it('labels a large count briefly', () => {
    expect(unreadLabel(7)).toBe('7');
    expect(unreadLabel(100)).toBe('99+');
  });
});

describe('filtering', () => {
  const events = [hiveEvent('magnus', 1, 1, { severity: 'critical' }), hiveEvent('cindertrace', 1, 2, { severity: 'info' }), hiveEvent('cindertrace', 2, 3, { severity: 'critical' })];
  const state: ReadState = { seen: { cindertrace: { occurredAt: events[1]!.occurredAt, id: events[1]!.id } }, magnusRead: new Map() };
  const ids = (filter: Partial<typeof NO_FILTER>) => filterEvents(events, { ...NO_FILTER, ...filter }, state).map((event) => event.id);
  it('filters by product, severity and read state, together', () => {
    expect(ids({})).toHaveLength(3);
    expect(ids({ product: 'cindertrace' })).toEqual(['cindertrace:record:1:opened', 'cindertrace:record:2:opened']);
    expect(ids({ severity: 'critical' })).toEqual(['magnus:record:1:opened', 'cindertrace:record:2:opened']);
    expect(ids({ unreadOnly: true })).toEqual(['magnus:record:1:opened', 'cindertrace:record:2:opened']);
    expect(ids({ product: 'cindertrace', severity: 'critical', unreadOnly: true })).toEqual(['cindertrace:record:2:opened']);
    expect(ids({ product: 'hiveskills' })).toEqual([]);
  });
});
