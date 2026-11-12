import { describe, expect, it } from 'vitest';
import { retentionSummaryResponseSchema } from '@contracts/magnus/browser';
import { cutoffLabel, manualTables, oldestState, shareOf, totalRecords, type RetentionTable } from './retention-model';

const table = (name: string, count: number, extra: Partial<RetentionTable> = {}): RetentionTable => ({ name, count, oldestAt: null, policy: '30 days', ...extra });

describe('the retention answer', () => {
  it('parses what GET /ops/retention sends, cutoffs or not', () => {
    const parsed = retentionSummaryResponseSchema.parse({
      success: true,
      data: {
        generatedAt: '2026-11-05T10:00:00.000Z',
        policyStatus: { status: 'pass', message: 'Retention jobs are configured' },
        tables: [
          { name: 'HealthSnapshot', count: 10, oldestAt: '2026-11-01T00:00:00.000Z', policy: '24h full', cutoffs: { fullFidelityAfter: '2026-11-04T10:00:00.000Z', expiresBefore: '2026-10-06T10:00:00.000Z' } },
          { name: 'RemoteCommand', count: 3, oldestAt: null, policy: 'manual review' },
        ],
      },
    });
    expect(parsed.data.tables[0]!.cutoffs).toHaveProperty('expiresBefore');
    expect(parsed.data.tables[1]!.cutoffs).toBeUndefined();
  });
  it('rejects a cutoff that is not a timestamp and a status it does not know', () => {
    const base = { generatedAt: '2026-11-05T10:00:00.000Z', policyStatus: { status: 'pass', message: '' }, tables: [] };
    expect(retentionSummaryResponseSchema.safeParse({ success: true, data: { ...base, tables: [table('a', 1, { cutoffs: { x: 'soon' } })] } }).success).toBe(false);
    expect(retentionSummaryResponseSchema.safeParse({ success: true, data: { ...base, policyStatus: { status: 'maybe', message: '' } } }).success).toBe(false);
  });
});

describe('retention', () => {
  it('totals the rows of every table', () => {
    expect(totalRecords([table('a', 2), table('b', 3)])).toBe(5);
    expect(totalRecords([])).toBe(0);
  });
  it('gives each table its share, and nothing for an empty database', () => {
    expect(shareOf(1, 4)).toBe(25);
    expect(shareOf(0, 0)).toBe(0);
  });
  it('tells an untracked oldest row from an empty table', () => {
    expect(oldestState(table('a', 1, { oldestAt: '2026-11-01T00:00:00.000Z' }))).toBe('dated');
    expect(oldestState(table('a', 1))).toBe('untracked');
    expect(oldestState(table('a', 0))).toBe('empty');
  });
  it('reads a cutoff name as words', () => {
    expect(cutoffLabel('fullFidelityAfter')).toBe('Full fidelity after');
    expect(cutoffLabel('expiresBefore')).toBe('Expires before');
    expect(cutoffLabel('readBefore')).toBe('Read before');
  });
  it('lists the tables nothing purges', () => {
    expect(manualTables([table('a', 1, { policy: 'manual review' }), table('b', 1)]).map(({ name }) => name)).toEqual(['a']);
  });
});
