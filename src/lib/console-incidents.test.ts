import { expect, it, vi } from 'vitest';
import { groupIncidentEvents, readConsoleIncidents } from './console-incidents';
import type { HiveIncidentEvent } from './types';

it('groups only explicit request correlation inside a bounded window without inventing resolution', () => {
  const event: HiveIncidentEvent = {
    id: 'synthetic-model', service: 'router', kind: 'inference', severity: 'critical',
    timestamp: '2026-01-01T00:00:01Z', title: 'Synthetic failure', requestId: 'synthetic-request',
    actor: null, outcome: 'failed', details: {},
  };
  const groups = groupIncidentEvents([
    event, { ...event, id: 'synthetic-identity', service: 'iam', severity: 'warning' },
    { ...event, id: 'synthetic-later', timestamp: '2026-01-01T01:00:00Z' },
    { ...event, id: 'invalid-time', timestamp: 'invalid' },
  ]);
  expect(groups).toHaveLength(2);
  expect(groups[1]).toMatchObject({ services: ['router', 'iam'], severity: 'critical', status: 'open' });
  expect(groups[1]!.events).toHaveLength(2);
});

it('uses product-owned authorized reads, omits sensitive raw details and reports independent unavailable sources', async () => {
  const audit = {
    events: [{ id: 'synthetic-audit', timestamp: '2026-01-01T00:00:01Z', eventType: 'auth.denied', category: 'auth',
      actorType: 'user', action: 'sign-in', outcome: 'denied',
      detail: { requestId: 'synthetic-request', password: 'obviously-fake-never-copy', authorization: 'obviously-fake-token' } }],
    total: 1, page: 1, limit: 50,
  };
  const send = vi.fn<typeof fetch>().mockImplementation(async path => {
    if (String(path) === '/api/iam/auth/me') return Response.json({ user: { id: 'synthetic-owner', username: 'admin', displayName: null, roles: [], permissions: ['iam:audit:read'] } });
    if (String(path) === '/api/iam/audit?limit=50') return Response.json(audit);
    return Response.json({ invalid: true });
  });
  const result = await readConsoleIncidents(send, product => ['emberpath', 'oathweave'].includes(product));
  expect(result.data).toHaveLength(1);
  expect(result.issues).toEqual(['emberpath: failure summary unavailable']);
  expect(JSON.stringify(result.data)).not.toContain('never-copy');
  expect(JSON.stringify(result.data)).not.toContain('authorization');
  expect(send.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  expect(send.mock.calls.every(([path]) => !String(path).includes('/hive/'))).toBe(true);
});

it('skips unconfigured products and unauthorized audit reads', async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ user: { id: 'synthetic-owner', username: 'reader', displayName: null, roles: [], permissions: [] } }));
  const result = await readConsoleIncidents(send, product => product === 'oathweave');
  expect(result).toEqual({ data: [], issues: [] });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]![0]).toBe('/api/iam/auth/me');
});
