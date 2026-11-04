import { afterEach, it, expect, vi } from 'vitest';
import { adminApi } from './api';
import { clearAccess, configureEndpoint, rememberAccess } from './transport';
import { memoryApi } from './memory-api';
afterEach(() => {
  clearAccess();
  vi.unstubAllGlobals();
});
it('does not request unrelated summaries for a memory-only reader', async () => {
  configureEndpoint('hivemem', '/api/hivemem');
  rememberAccess('hivemem', 'obviously-fake-memory-token', Date.now() + 60000);
  const send = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json({ results: [], total: 0 }));
  vi.stubGlobal('fetch', send);
  await adminApi.memoryConsole((permission) => permission === 'memories:read');
  const paths = send.mock.calls.map(([path]) => String(path));
  expect(paths).toContain('/api/hivemem/stats');
  expect(
    paths.some((path) => /queue|agents|sessions|webhooks/.test(path)),
  ).toBe(false);
});
it('validates owned workspace responses and preserves the explicit archive and restore verbs', async () => {
  configureEndpoint('hivemem', '/api/hivemem');
  rememberAccess('hivemem', 'obviously-fake-memory-token', Date.now() + 60000);
  const send = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', send);
  await expect(memoryApi.archive('synthetic/team')).rejects.toThrow(
    'Invalid API path',
  );
  expect(send).not.toHaveBeenCalled();
  await memoryApi.archive('synthetic:team');
  expect(send.mock.lastCall?.[0]).toBe(
    '/api/hivemem/workspaces/synthetic%3Ateam',
  );
  expect(send.mock.lastCall?.[1]?.method).toBe('DELETE');
  send.mockImplementation(async () =>
    Response.json({ workspace_id: 'malformed-fixture' }),
  );
  await expect(memoryApi.restore('synthetic-team')).rejects.toThrow();
  expect(send.mock.lastCall?.[0]).toBe(
    '/api/hivemem/workspaces/synthetic-team/restore',
  );
  expect(send.mock.lastCall?.[1]?.method).toBe('POST');
});
it('composes memory summaries directly and uses the native verbs for search, edits and queue controls', async () => {
  configureEndpoint('hivemem', '/api/hivemem');
  rememberAccess('hivemem', 'obviously-fake-memory-token', Date.now() + 60000);
  const send = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json({ results: [], total: 0 }));
  vi.stubGlobal('fetch', send);
  await adminApi.memoryConsole();
  const paths = send.mock.calls.map(([path]) => String(path));
  expect(paths).toContain('/api/hivemem/stats');
  expect(paths).toContain('/api/hivemem/agents');
  expect(paths.some((path) => path.includes('dashboard-data'))).toBe(false);
  await adminApi.searchMemory({
    query: 'fixture',
    workspaceId: 'fixture-workspace',
    offset: 25,
  });
  expect(send.mock.lastCall?.[1]?.method).toBe('POST');
  expect(JSON.parse(String(send.mock.lastCall?.[1]?.body))).toMatchObject({
    query: 'fixture',
    workspace_id: 'fixture-workspace',
    offset: 25,
  });
  await adminApi.updateMemory('fixture-memory', { content: 'Updated fixture' });
  expect(send.mock.lastCall?.[1]?.method).toBe('PUT');
  await adminApi.runMemoryQueueJob('fixture-job');
  expect(send.mock.lastCall?.[0]).toBe(
    '/api/hivemem/queue/jobs/fixture-job/run',
  );
  expect(
    new Headers(send.mock.lastCall?.[1]?.headers).get('Authorization'),
  ).toBe('Bearer obviously-fake-memory-token');
});
