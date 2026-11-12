import { describe, expect, it } from 'vitest';
import { fleetNodes, radarCounts, type ReadinessNode } from './model';

const node = (id: string, operationalStatus: ReadinessNode['operationalStatus']) => ({ id, operationalStatus }) as ReadinessNode;

describe('readiness', () => {
  it('leaves out the control plane records', () => {
    expect(fleetNodes([node('__control-api__', 'ONLINE'), node('__dashboard__', 'STALE'), node('a', 'ONLINE')]).map(({ id }) => id)).toEqual(['a']);
  });
  it('counts a stale node as degraded on the radar', () => {
    expect(radarCounts([node('a', 'ONLINE'), node('b', 'STALE'), node('c', 'DEGRADED'), node('d', 'OFFLINE'), node('e', 'DECOMMISSIONED'), node('f', 'PROVISIONING')])).toEqual({ online: 1, degraded: 2, offline: 2, provisioning: 1 });
  });
});
