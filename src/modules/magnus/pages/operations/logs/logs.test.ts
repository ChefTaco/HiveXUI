import { describe, expect, it } from 'vitest';
import { levelTone, MAX_LIVE_LOGS, parseStreamLog, prependLog, type LogRow } from './log-model';

const entry = { id: '', nodeId: 'n', source: 'agent', level: 'warn', message: 'disk', metadata: { a: 1 }, timestamp: '2026-11-05T14:00:00.000Z' };

describe('live log events', () => {
  it('keeps a valid entry under the key the page gives it', () => {
    expect(parseStreamLog(JSON.stringify(entry), 'live-1')).toEqual({ key: 'live-1', source: 'agent', level: 'warn', message: 'disk', timestamp: entry.timestamp });
  });
  it('skips what is not a log entry, including the empty heartbeat', () => {
    expect(parseStreamLog('', 'k')).toBeNull();
    expect(parseStreamLog('{not json', 'k')).toBeNull();
    expect(parseStreamLog(JSON.stringify({ ...entry, timestamp: 'yesterday' }), 'k')).toBeNull();
  });
  it('holds at most the live limit, newest first', () => {
    let rows: LogRow[] = [];
    for (let index = 0; index < MAX_LIVE_LOGS + 5; index += 1) rows = prependLog(rows, { key: String(index), source: 's', level: 'info', message: 'm', timestamp: 't' });
    expect(rows).toHaveLength(MAX_LIVE_LOGS);
    expect(rows[0]!.key).toBe(String(MAX_LIVE_LOGS + 4));
  });
  it('colors a level by what it means', () => {
    expect(levelTone('FATAL')).toBe('danger');
    expect(levelTone('warn')).toBe('warning');
    expect(levelTone('debug')).toBe('neutral');
  });
});
