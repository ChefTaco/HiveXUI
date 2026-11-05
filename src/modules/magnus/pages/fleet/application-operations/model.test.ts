import { describe, expect, it } from 'vitest';
import { applicationCounts, maintenanceRequest, parseIdList, probeTone, windowState, type MaintenanceWindow } from './model';

const NOW = Date.parse('2026-11-05T12:00:00.000Z');
const window = (fields: Partial<MaintenanceWindow>): MaintenanceWindow => ({ id: 'w', reason: 'r', nodeIds: '[]', serviceIds: '[]', actorId: 'a', startsAt: '2026-11-05T11:00:00.000Z', endsAt: '2026-11-05T13:00:00.000Z', cancelledAt: null, createdAt: '2026-11-05T11:00:00.000Z', ...fields });

describe('windowState', () => {
  it('names each state, with cancellation first', () => {
    expect(windowState(window({}), NOW)).toBe('active');
    expect(windowState(window({ startsAt: '2026-11-05T12:30:00.000Z' }), NOW)).toBe('scheduled');
    expect(windowState(window({ endsAt: '2026-11-05T12:00:00.000Z' }), NOW)).toBe('expired');
    expect(windowState(window({ cancelledAt: '2026-11-05T11:30:00.000Z', endsAt: '2026-11-05T11:40:00.000Z' }), NOW)).toBe('cancelled');
  });
});

describe('parseIdList', () => {
  it('reads a JSON array of strings', () => expect(parseIdList('["a","b"]')).toEqual(['a', 'b']));
  it('survives bad data', () => {
    expect(parseIdList('nonsense')).toEqual([]);
    expect(parseIdList('{"a":1}')).toEqual([]);
    expect(parseIdList('["a",1]')).toEqual(['a']);
  });
});

describe('maintenanceRequest', () => {
  const form = { nodeId: ' n1 ', serviceId: '', reason: ' disk swap ', minutes: '60' };
  it('builds a window starting now, trimmed, with an empty service list meaning all', () => {
    expect(maintenanceRequest(form, NOW)).toEqual({ body: { reason: 'disk swap', nodeIds: ['n1'], serviceIds: [], startsAt: '2026-11-05T12:00:00.000Z', endsAt: '2026-11-05T13:00:00.000Z' } });
    expect(maintenanceRequest({ ...form, serviceId: 'api' }, NOW)).toMatchObject({ body: { serviceIds: ['api'] } });
  });
  it('refuses what the server would refuse', () => {
    expect(maintenanceRequest({ ...form, nodeId: ' ' }, NOW)).toHaveProperty('error');
    expect(maintenanceRequest({ ...form, reason: 'abc' }, NOW)).toHaveProperty('error');
    expect(maintenanceRequest({ ...form, minutes: '0' }, NOW)).toHaveProperty('error');
    expect(maintenanceRequest({ ...form, minutes: '10081' }, NOW)).toHaveProperty('error');
    expect(maintenanceRequest({ ...form, minutes: '1.5' }, NOW)).toHaveProperty('error');
  });
});

describe('probes', () => {
  it('tones each status', () => {
    expect(probeTone('pass')).toBe('success');
    expect(probeTone('fail')).toBe('danger');
    expect(probeTone('constrained')).toBe('warning');
    expect(probeTone('unknown')).toBe('neutral');
  });
  it('counts by outcome', () => {
    expect(applicationCounts([{ status: 'pass' }, { status: 'fail' }, { status: 'unknown' }, { status: 'unconfigured' }])).toEqual({ pass: 1, fail: 1, other: 2 });
  });
});
