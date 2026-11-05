import { describe, expect, it } from 'vitest';
import { groupProfiles, hermesTone, summarize, tokenTone, type HermesInstallation, type HermesProfile } from './shared';

const installation = (id: string, status: string, dashboardStatus = 'stopped'): HermesInstallation => ({ id, status, dashboardStatus }) as HermesInstallation;
const profile = (id: string, installationId: string, gatewayStatus: string): HermesProfile => ({ id, installationId, gatewayStatus }) as HermesProfile;

describe('summarize', () => {
  it('counts only detected installations, and only their gateways', () => {
    const result = summarize([installation('a', 'running', 'running'), installation('b', 'detected'), installation('c', 'stopped'), installation('d', 'not_installed', 'running')], [profile('1', 'a', 'running'), profile('2', 'a', 'stopped'), profile('3', 'd', 'running')]);
    expect(result.detected.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(result.healthy).toBe(2);
    expect(result.dashboards).toBe(1);
    expect(result.gateways).toBe(1);
  });
});

describe('groupProfiles', () => {
  it('groups by installation', () => {
    const grouped = groupProfiles([profile('1', 'a', 'running'), profile('2', 'b', 'running'), profile('3', 'a', 'stopped')]);
    expect(grouped.get('a')?.map((item) => item.id)).toEqual(['1', '3']);
  });
});

describe('tones', () => {
  it('reads a detected install as fine and a free string as neutral', () => {
    expect(hermesTone('detected')).toBe('success');
    expect(hermesTone('running')).toBe('success');
    expect(hermesTone('something-new')).toBe('neutral');
  });
  it('warns on a token that needs a look, and alarms on one that failed', () => {
    expect(tokenTone('valid')).toBe('success');
    expect(tokenTone('expiring')).toBe('warning');
    expect(tokenTone('expired')).toBe('danger');
    expect(tokenTone('rejected')).toBe('danger');
  });
});
