import { describe, expect, it } from 'vitest';
import { actionTone, dayOptions, detailText, integrityTone, parseDetails, todayKey } from './audit-model';

describe('audit days', () => {
  it('takes today from the UTC date the server files by', () => {
    expect(todayKey(new Date('2026-11-05T23:59:59.000Z'))).toBe('2026-11-05');
  });
  it('always offers today', () => {
    expect(dayOptions(['2026-11-04'], '2026-11-05')).toEqual(['2026-11-05', '2026-11-04']);
    expect(dayOptions(['2026-11-05', '2026-11-04'], '2026-11-05')).toEqual(['2026-11-05', '2026-11-04']);
  });
});

describe('audit details', () => {
  it('reads an object, a JSON string and a damaged record', () => {
    expect(parseDetails({ a: 1 })).toEqual({ a: 1 });
    expect(parseDetails('{"a":1}')).toEqual({ a: 1 });
    expect(parseDetails('not json')).toEqual({ raw: 'not json' });
    expect(parseDetails(7)).toEqual({ raw: 7 });
    expect(parseDetails([1])).toEqual({ raw: [1] });
    expect(parseDetails(undefined)).toEqual({});
    expect(parseDetails('null')).toEqual({});
  });
  it('shows nested values as JSON', () => {
    expect(detailText({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(detailText(false)).toBe('false');
  });
});

describe('audit tones', () => {
  it('color an action by its effect', () => {
    expect(actionTone('webhook.delete')).toBe('danger');
    expect(actionTone('node.register')).toBe('success');
    expect(actionTone('cron.update')).toBe('warning');
    expect(actionTone('notification.read_all')).toBe('info');
  });
  it('never call a broken chain good', () => {
    expect(integrityTone('verified')).toBe('success');
    expect(integrityTone('legacy-partial')).toBe('warning');
    expect(integrityTone('invalid')).toBe('danger');
    expect(integrityTone('unverified')).toBe('neutral');
  });
});
