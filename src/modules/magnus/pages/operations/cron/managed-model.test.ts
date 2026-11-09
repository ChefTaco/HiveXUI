import { describe, expect, it } from 'vitest';
import { finiteJobBody, managedRegistration } from './managed-model';
const now = Date.parse('2030-01-01T00:00:00Z');
const input = () => ({ name: 'diagnostic', nodeId: 'node-1', command: '/usr/bin/uptime', args: '[]',
  schedule: '* * * * *', timeout: '60', expires: '2030-01-02T00:00:00Z' });
describe('finite scheduler approval', () => {
  it('binds the approved timeout, UTC schedule, revision and expiry', () => {
    expect(finiteJobBody(input(), now)).toMatchObject({ command: '/usr/bin/uptime', args: [], timeoutSeconds: 60,
      managed: { revision: 1, timezone: 'UTC', timeoutSeconds: 60, expiresAt: now + 86400000 } });
    expect(managedRegistration('90', input().expires, 8, now).revision).toBe(8);
  });
  it('refuses missing or expired authority, invalid budgets, names and non-string arguments', () => {
    for (const patch of [{ expires: 'invalid' }, { expires: '2029-01-01' }, { timeout: '0' }, { timeout: '1.5' },
      { timeout: '3601' }, { name: '[AI] unsafe' }, { args: '[1]' }, { args: '{}' }, { nodeId: '' }])
      expect(() => finiteJobBody({ ...input(), ...patch }, now)).toThrow();
    expect(() => managedRegistration('60', input().expires, 2147483648, now)).toThrow();
  });
});
