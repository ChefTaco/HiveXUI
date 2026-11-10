import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readRegistryHealth, readSuiteHealth } from './suite-health';
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

it('probes Magnus with its own path once it is installed', async () => {
  configureEndpoint('magnus', '/api/magnus');
  const send = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}'));
  const rows = await readSuiteHealth(send);
  expect(rows.find((row) => row.product === 'magnus')).toMatchObject({ name: 'Magnus', path: '/api/magnus/health/ready', state: 'ready' });
});

it('probes Ardent Project Studio at its own prefix once it is installed', async () => {
  configureEndpoint('ardentstudio', '/api/ardentstudio');
  const send = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}'));
  const rows = await readSuiteHealth(send);
  expect(rows.find((row) => row.product === 'ardentstudio')).toMatchObject({ name: 'Ardent Project Studio', path: '/api/ardentstudio/v1/health/ready', state: 'ready' });
  expect(send.mock.calls.map(([path]) => path)).toContain('/api/ardentstudio/v1/health/ready');
});

it('still reports denied and unavailable states for installed products', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('{}', { status: 403 }))
    .mockRejectedValueOnce(new Error('offline'));
  const rows = await readSuiteHealth(send);
  expect(rows.slice(0, 2).map((row) => row.state)).toEqual(['denied', 'unavailable']);
});

describe('the Registry row', () => {
  const answering = (body: BodyInit | null, status = 200) => vi.fn<typeof fetch>().mockImplementation(async () => new Response(body, { status }));
  it('is reported ready only with the Registry\'s own answer, anonymously and at its own path', async () => {
    const request = answering(JSON.stringify({ status: 'ready', readOnly: false }));
    await expect(readRegistryHealth(request)).resolves.toMatchObject({ product: 'hive-registry', name: 'Registry', path: '/api/registry/health/ready', required: true, state: 'ready' });
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe('/api/registry/health/ready');
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error' });
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
  });
  it.each([
    ['a 404 from a stack without it', answering('API unavailable', 404)],
    ['a 500', answering('{}', 500)],
    ['a page served in its place', answering('<!doctype html>')],
    ['another body', answering(JSON.stringify({ status: 'starting', readOnly: false }))],
    ['a network failure', vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))],
  ])('is required and unavailable on %s', async (_name, request) => {
    await expect(readRegistryHealth(request)).resolves.toMatchObject({ required: true, state: 'unavailable' });
  });
  it('leads the rows and does not go through the product transport', async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}'));
    const registry = vi.fn(() => readRegistryHealth(answering('API unavailable', 404)));
    const rows = await readSuiteHealth(send, registry);
    expect(rows[0]).toMatchObject({ name: 'Registry', state: 'unavailable', required: true });
    expect(rows.length).toBeGreaterThan(1);
    expect(send.mock.calls.map(([path]) => path)).not.toContain('/api/registry/health/ready');
  });
  it('is left out where there is no Registry to ask, as in legacy recovery', async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}'));
    expect((await readSuiteHealth(send)).map((row) => row.product)).not.toContain('hive-registry');
  });
});

describe('fresh Studio setup', () => {
  const ok = { status: 'ok', error: null };
  const waiting = { status: 'not_ready', checks: { database: ok, magnus: ok, hivemem: ok, agents: { status: 'unavailable', available: 0 } } };
  const probe = async (body: unknown, status = 503) => {
    configureEndpoint('ardentstudio', '/api/ardentstudio');
    const send = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(body, { status }));
    return (await readSuiteHealth(send)).find((row) => row.product === 'ardentstudio');
  };
  it('explains the first-agent setup without claiming readiness', async () => {
    expect(await probe(waiting)).toMatchObject({ state: 'unavailable', message: expect.stringContaining('create or start a profile in Magnus') });
  });
  it.each(['database', 'magnus', 'hivemem'] as const)('preserves %s failures rather than suggesting only an agent setup', async (dependency) => {
    const body = { ...waiting, checks: { ...waiting.checks, [dependency]: { status: 'unavailable', error: 'private backend diagnostic' } } };
    expect(await probe(body)).toMatchObject({ state: 'unavailable', message: 'Readiness check failed' });
  });
  it.each([401, 403])('keeps access denial for HTTP %s', async (status) => {
    expect(await probe(waiting, status)).toMatchObject({ state: 'denied', message: 'This identity cannot inspect this product' });
  });
  it.each([null, { status: 'not_ready' }, { ...waiting, checks: { ...waiting.checks, agents: { status: 'unavailable', available: '0' } } }])('does not infer setup from malformed answers', async (body) => {
    expect(await probe(body)).toMatchObject({ state: 'unavailable', message: 'Readiness check failed' });
  });
  it('does not explain a server error as an empty installation', async () => {
    expect(await probe(waiting, 500)).toMatchObject({ state: 'unavailable', message: 'Readiness check failed' });
  });
});
