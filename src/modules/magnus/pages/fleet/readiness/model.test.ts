import { describe, expect, it } from 'vitest';
import { fleetNodes, keyedTimeline, radarCounts, totalRecords, type ReadinessNode, type TimelineItem } from './model';

const node = (id: string, operationalStatus: ReadinessNode['operationalStatus']) => ({ id, operationalStatus }) as ReadinessNode;
const item = (type: TimelineItem['type'], title: string, timestamp = '2026-11-05T10:00:00.000Z'): TimelineItem => ({ type, title, timestamp, severity: 'info', href: '/logs' });

describe('readiness', () => {
  it('leaves out the control plane records', () => {
    expect(fleetNodes([node('__control-api__', 'ONLINE'), node('__dashboard__', 'STALE'), node('a', 'ONLINE')]).map(({ id }) => id)).toEqual(['a']);
  });
  it('counts a stale node as degraded on the radar', () => {
    expect(radarCounts([node('a', 'ONLINE'), node('b', 'STALE'), node('c', 'DEGRADED'), node('d', 'OFFLINE'), node('e', 'DECOMMISSIONED'), node('f', 'PROVISIONING')])).toEqual({ online: 1, degraded: 2, offline: 2, provisioning: 1 });
  });
});

describe('retention', () => {
  it('totals the rows of every table', () => {
    expect(totalRecords([{ name: 'a', count: 2, oldestAt: null, policy: '' }, { name: 'b', count: 3, oldestAt: null, policy: '' }])).toBe(5);
  });
});

describe('timeline', () => {
  it('filters by type', () => {
    expect(keyedTimeline([item('log', 'a'), item('audit', 'b')], 'audit').map(({ title }) => title)).toEqual(['b']);
  });
  it('gives identical items distinct, stable keys', () => {
    const keys = keyedTimeline([item('log', 'same'), item('log', 'same'), item('log', 'other')]).map(({ key }) => key);
    expect(new Set(keys).size).toBe(3);
    expect(keyedTimeline([item('log', 'same'), item('log', 'same'), item('log', 'other')]).map(({ key }) => key)).toEqual(keys);
  });
});
