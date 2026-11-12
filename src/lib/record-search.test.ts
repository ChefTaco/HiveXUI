import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HiveApiError } from './api-error';
import {
  eligibleSources,
  groupRecords,
  looksLikeId,
  matchesQuery,
  recordQuery,
  runRecordSearch,
  RECORD_CAP,
  RECORD_TIMEOUT_MS,
  type RecordHit,
  type RecordSource,
  type SourceState,
} from './record-search';
import type { Product } from './transport';

const hit = (id: string): RecordHit => ({ id, label: `Record ${id}`, href: `/?page=skills&id=${id}`, icon: 'Puzzle' });
function source(id: string, product: Product, partial: Partial<RecordSource> = {}): RecordSource {
  return { id, product, name: product, kind: 'Thing', allowed: async () => true, search: async () => [hit(`${id}-1`)], ...partial };
}
function collect() {
  const states = new Map<string, SourceState>();
  const updates: Array<[string, SourceState['status']]> = [];
  return { states, updates, onUpdate: (id: string, state: SourceState) => (states.set(id, state), updates.push([id, state.status])) };
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('which sources are asked', () => {
  it('asks only installed products, and only sources the query suits', () => {
    const sources = [source('nodes', 'magnus'), source('cases', 'cindertrace'), source('traces', 'emberpath', { applies: looksLikeId })];
    const installed = (product: Product) => product !== 'cindertrace';
    expect(eligibleSources(sources, 'node', installed).map((entry) => entry.id)).toEqual(['nodes']);
    expect(eligibleSources(sources, 'req_123456', installed).map((entry) => entry.id)).toEqual(['nodes', 'traces']);
  });
  it('needs at least two characters, trimmed and collapsed', () => {
    expect(recordQuery('')).toBeNull();
    expect(recordQuery(' a ')).toBeNull();
    expect(recordQuery(' ab ')).toBe('ab');
    expect(recordQuery('node   one')).toBe('node one');
    expect(recordQuery('x'.repeat(500))).toHaveLength(200);
  });
  it('treats only a single ID-shaped token as an ID', () => {
    expect(looksLikeId('req_42abcd')).toBe(true);
    expect(looksLikeId('0b6f3a52-6c1e-4ec8-9d0e-3a0c3c6a1d11')).toBe(true);
    expect(looksLikeId('router')).toBe(false);
    expect(looksLikeId('two words1')).toBe(false);
    expect(looksLikeId('ab1')).toBe(false);
  });
  it('matches every word in any field, ignoring case', () => {
    expect(matchesQuery('node ONE', 'Node-One', null)).toBe(true);
    expect(matchesQuery('node two', 'node-one', 'host')).toBe(false);
    expect(matchesQuery('host', 'node', 'host.example.com')).toBe(true);
  });
});

describe('running a search', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports every source pending, then each answer as it arrives', async () => {
    const { states, updates, onUpdate } = collect();
    runRecordSearch('ab', [source('a', 'magnus'), source('b', 'hivemem')], onUpdate);
    expect(updates).toEqual([['a', 'pending'], ['b', 'pending']]);
    await flush();
    expect(states.get('a')).toMatchObject({ status: 'done', hits: [{ id: 'a-1' }], more: false });
    expect(states.get('b')).toMatchObject({ status: 'done' });
  });

  it('gives each source its own deadline: a slow one fails alone, the others answer', async () => {
    const { states, onUpdate } = collect();
    let slowSignal: AbortSignal | undefined;
    const slow = source('slow', 'cindertrace', { search: (_query, _limit, signal) => ((slowSignal = signal), new Promise(() => {})) });
    runRecordSearch('ab', [slow, source('fast', 'magnus')], onUpdate);
    await flush();
    expect(states.get('fast')?.status).toBe('done');
    expect(states.get('slow')?.status).toBe('pending');
    await vi.advanceTimersByTimeAsync(RECORD_TIMEOUT_MS - 1);
    expect(states.get('slow')?.status).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(states.get('slow')?.status).toBe('failed');
    expect(slowSignal?.aborted).toBe(true);
  });

  it('counts a slow permission check against the same deadline', async () => {
    const { states, onUpdate } = collect();
    const search = vi.fn(async () => [hit('x')]);
    runRecordSearch('ab', [source('gate', 'oathweave', { allowed: () => new Promise(() => {}), search })], onUpdate);
    await vi.advanceTimersByTimeAsync(RECORD_TIMEOUT_MS);
    expect(states.get('gate')?.status).toBe('failed');
    expect(search).not.toHaveBeenCalled();
  });

  it('shows at most the cap per source and says when there is more', async () => {
    const { states, onUpdate } = collect();
    const many = Array.from({ length: 9 }, (_, i) => hit(String(i)));
    const limits: number[] = [];
    runRecordSearch('ab', [source('many', 'ardentstudio', { search: async (_q, limit) => (limits.push(limit), many), seeAll: (query) => `/studio?q=${query}` })], onUpdate);
    await flush();
    expect(limits).toEqual([RECORD_CAP + 1]);
    const state = states.get('many');
    expect(state).toMatchObject({ status: 'done', more: true, seeAll: '/studio?q=ab' });
    expect(state?.status === 'done' && state.hits).toHaveLength(RECORD_CAP);
  });

  it('offers no see-all link when everything fits', async () => {
    const { states, onUpdate } = collect();
    runRecordSearch('ab', [source('few', 'ardentstudio', { seeAll: () => '/studio' })], onUpdate);
    await flush();
    expect(states.get('few')).toMatchObject({ status: 'done', more: false, seeAll: null });
  });

  it('hides a source that refuses (401 or 403) and reports other failures quietly', async () => {
    const { states, onUpdate } = collect();
    runRecordSearch(
      'ab',
      [
        source('unauthorized', 'hivemem', { search: async () => { throw new HiveApiError(401, 'Sign in'); } }),
        source('forbidden', 'cindertrace', { search: async () => { throw new HiveApiError(403, 'No'); } }),
        source('broken', 'hiveskills', { search: async () => { throw new HiveApiError(500, 'Down'); } }),
        source('offline', 'magnus', { search: async () => { throw new TypeError('Failed to fetch'); } }),
      ],
      onUpdate,
    );
    await flush();
    expect(Object.fromEntries([...states].map(([id, state]) => [id, state.status]))).toEqual({ unauthorized: 'hidden', forbidden: 'hidden', broken: 'failed', offline: 'failed' });
  });

  it('never sends the query to a source the role cannot read', async () => {
    const { states, onUpdate } = collect();
    const search = vi.fn(async () => [hit('x')]);
    runRecordSearch('secret words', [source('iam', 'oathweave', { allowed: async () => false, search })], onUpdate);
    await flush();
    expect(states.get('iam')?.status).toBe('hidden');
    expect(search).not.toHaveBeenCalled();
  });

  it('stops reporting once cancelled, and aborts what is still running', async () => {
    const { updates, onUpdate } = collect();
    let signal: AbortSignal | undefined;
    const cancel = runRecordSearch('ab', [source('a', 'magnus', { search: (_q, _l, given) => ((signal = given), new Promise(() => {})) })], onUpdate);
    await flush();
    cancel();
    await vi.advanceTimersByTimeAsync(RECORD_TIMEOUT_MS * 2);
    expect(updates).toEqual([['a', 'pending']]);
    expect(signal?.aborted).toBe(true);
  });

  it('logs nothing, so a query never reaches the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    const { onUpdate } = collect();
    runRecordSearch('private query', [source('a', 'magnus', { search: async () => { throw new Error('boom'); } }), source('b', 'hivemem')], onUpdate);
    await vi.advanceTimersByTimeAsync(RECORD_TIMEOUT_MS);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const spy of spies) spy.mockRestore();
  });
});

describe('grouping', () => {
  it('groups by product in source order, keeps pending and failed products, and drops hidden ones', () => {
    const sources = [source('nodes', 'magnus'), source('agents', 'magnus'), source('cases', 'cindertrace'), source('users', 'oathweave'), source('skills', 'hiveskills')];
    const states = new Map<string, SourceState>([
      ['nodes', { status: 'done', hits: [hit('n1')], more: false, seeAll: null }],
      ['agents', { status: 'pending' }],
      ['cases', { status: 'failed' }],
      ['users', { status: 'hidden' }],
      ['skills', { status: 'done', hits: [], more: false, seeAll: null }],
    ]);
    const groups = groupRecords(sources, states);
    expect(groups.map((group) => [group.product, group.entries.length, group.pending, group.failed])).toEqual([
      ['magnus', 1, true, false],
      ['cindertrace', 0, false, true],
    ]);
  });
  it('adds the see-all entry after the records', () => {
    const groups = groupRecords([source('projects', 'ardentstudio')], new Map([['projects', { status: 'done', hits: [hit('p1')], more: true, seeAll: '/studio?q=ab' }]]));
    expect(groups[0]!.entries.map((entry) => ('hit' in entry ? entry.hit.id : entry.seeAll))).toEqual(['p1', '/studio?q=ab']);
  });
});
