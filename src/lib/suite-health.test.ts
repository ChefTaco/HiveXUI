import { beforeEach, expect, it, vi } from 'vitest';
import { readSuiteHealth } from './suite-health';
import { configureEndpoint } from './transport';

beforeEach(() => {
  configureEndpoint('oathweave', '/api/oathweave');
  configureEndpoint('emberpath', '/api/emberpath');
});

it('probes and reports only installed products, leaving no row for the rest', async () => {
  const send = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}'));
  const rows = await readSuiteHealth(send);
  expect(rows.map((row) => row.product)).toEqual(['oathweave', 'emberpath']);
  expect(rows.every((row) => row.state === 'ready')).toBe(true);
  expect(send.mock.calls.map(([path]) => path)).toEqual(['/api/iam/health/ready', '/api/health/ready']);
});

it('still reports denied and unavailable states for installed products', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('{}', { status: 403 }))
    .mockRejectedValueOnce(new Error('offline'));
  const rows = await readSuiteHealth(send);
  expect(rows.map((row) => row.state)).toEqual(['denied', 'unavailable']);
});
