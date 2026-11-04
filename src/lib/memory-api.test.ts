import { afterEach, it, expect, vi } from 'vitest';
import { adminApi } from './api';
import { clearAccess, configureEndpoint, rememberAccess } from './transport';
afterEach(() => {
  clearAccess();
  vi.unstubAllGlobals();
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
