import { afterEach, it, expect, vi } from 'vitest';
import { adminApi } from './api';
import { clearAccess, configureEndpoint, rememberAccess } from './transport';
import { memoryApi } from './memory-api';
const memory = {
  id: 'synthetic-memory', agent_id: 'synthetic-owner', content: 'Synthetic memory', type: 'semantic', scope: 'private',
  source: 'user_feedback', confidence: 0, importance: 0, tags: [], metadata: {}, sensitivity: 'internal',
  retention_class: 'standard', redaction_policy: 'none', workspace_id: 'default', session_id: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', expires_at: null,
  valid_from: null, valid_to: null, observed_at: null, relationships: [], confidence_provenance: [],
  supersedes: null, superseded_by: null, superseded_at: null, corroborated_by: [], endorsements: 0,
  endorsed_by: [], opposed_by: [], deleted_at: null, effective_confidence: null, sanitization_warnings: null,
};
const job = {
  id: 'fixture-job', task_type: 'summary', status: 'completed', work_unit_key: 'fixture',
  owner_agent_id: 'synthetic-owner', workspace_id: 'default', session_id: null, peer_id: null,
  priority: 0, retry_count: 0, created_at: '2026-01-01T00:00:00Z', not_before: null, started_at: null,
  finished_at: null, error: null, payload: {}, observer_peer_id: null, observed_peer_id: null,
  idempotency_key: 'synthetic-idempotency', locked_at: null, result: {},
};
function nativeResponse(input: RequestInfo | URL) {
  const url = new URL(String(input), 'https://console.example.com');
  if (url.pathname.endsWith('/stats')) return Response.json({ agents: 0, memories: 0, sessions: 0, workspaces: 0, queue_jobs: 0, webhooks: 0, webhook_deliveries: 0, conclusions: 0, episodes: 0, messages: 0 });
  if (url.pathname.endsWith('/queue/status')) return Response.json({
    worker: { ready: true, state: 'manual', managed: false, enabled: false, running: false, heartbeat: null, last_success: null, error: null, recovered_on_startup: 0, pending_jobs: 0, oldest_pending_seconds: null },
    jobs: [], total: 0, pending_count: 0, in_progress_count: 0, failed_count: 0, dead_letter_count: 0, offset: 0, limit: 8,
  });
  if (url.pathname.includes('/queue/jobs/')) return Response.json(job);
  if (url.pathname.endsWith('/memories/search')) return Response.json({ results: [], total_searched: 0, collections_searched: [] });
  if (url.pathname.endsWith('/memories/browse')) return Response.json({ memories: [], results: [], total: 0, offset: Number(url.searchParams.get('offset') ?? 0), limit: 25, next_cursor: null });
  if (url.pathname.includes('/memories/')) return Response.json(memory);
  return Response.json([]);
}
afterEach(() => {
  clearAccess();
  vi.unstubAllGlobals();
});
it('does not request unrelated summaries for a memory-only reader', async () => {
  configureEndpoint('hivemem', '/api/hivemem');
  rememberAccess('hivemem', 'obviously-fake-memory-token', Date.now() + 60000);
  const send = vi
    .fn<typeof fetch>()
    .mockImplementation(async (input) => nativeResponse(input));
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
  await expect(adminApi.deleteMemory('synthetic-memory')).resolves.toBeUndefined();
  expect(send.mock.lastCall?.[0]).toBe('/api/hivemem/memories/synthetic-memory');
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
    .mockImplementation(async (input) => nativeResponse(input));
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
  await adminApi.searchMemory({ workspaceId: 'fixture-workspace', offset: 25 });
  expect(String(send.mock.lastCall?.[0])).toContain('offset=25');
  expect(String(send.mock.lastCall?.[0])).not.toContain('cursor=');
  expect(String(send.mock.lastCall?.[0])).not.toContain('agent_id=');
  // One agent's memories: agent_id in the browse query and in the search body.
  await adminApi.searchMemory({ workspaceId: '*', agentId: 'ardent-lead' });
  expect(String(send.mock.lastCall?.[0])).toContain('agent_id=ardent-lead');
  await adminApi.searchMemory({ query: 'fixture', agentId: 'ardent-lead' });
  expect(JSON.parse(String(send.mock.lastCall?.[1]?.body))).toMatchObject({ query: 'fixture', agent_id: 'ardent-lead' });
  await expect(adminApi.searchMemory({ query: 'fixture', agentId: 'Not An Actor' })).rejects.toThrow();
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

it('rejects malformed native memory data and invalid writes without hiding unavailable summary sections', async () => {
  configureEndpoint('hivemem', '/api/hivemem');
  rememberAccess('hivemem', 'obviously-fake-memory-token', Date.now() + 60000);
  const send = vi.fn<typeof fetch>().mockImplementation(async input => nativeResponse(input));
  vi.stubGlobal('fetch', send);
  await expect(adminApi.createMemory({ content: 'Synthetic', type: 'semantic', scope: 'private', workspace_id: '*' })).rejects.toThrow('specific workspace');
  expect(send).not.toHaveBeenCalled();
  send.mockImplementation(async input => String(input).includes('/stats') ? Response.json({ memories: 'invalid' }) : nativeResponse(input));
  const summary = await adminApi.memoryConsole();
  expect(summary.stats).toBeNull();
  expect(summary.issues?.some(issue => issue.startsWith('stats:'))).toBe(true);
  expect(summary.memories).toEqual([]);
  send.mockImplementation(async () => Response.json({ ...memory, content: 42 }));
  await expect(adminApi.getMemory('synthetic-memory')).rejects.toThrow();
  send.mockImplementation(async () => Response.json({ ...memory, signing_secret: 'obviously-fake-secret' }));
  const read = await adminApi.getMemory('synthetic-memory');
  expect(read.confidence).toBe(0);
  expect(read).not.toHaveProperty('signing_secret');
});
