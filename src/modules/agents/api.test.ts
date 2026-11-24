import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { summary } from '../studio/test-fixtures';
import { executionTraces, liveSources, resetSupportCache } from './api';

type Answer = { status?: number; body: unknown };
let routes: Array<[RegExp, (url: URL, init: RequestInit | undefined) => Answer]>;
let sent: Array<{ method: string; url: string; body: unknown }>;

beforeEach(() => {
  routes = [];
  sent = [];
  resetSupportCache();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'https://hive.example.com');
    sent.push({ method: init?.method ?? 'GET', url: url.pathname + url.search, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    for (const [pattern, answer] of routes)
      if (pattern.test(url.pathname + url.search)) {
        const { status = 200, body } = answer(url, init);
        return Response.json(body, { status });
      }
    return Response.json({ error: { code: 'NOT_FOUND', message: 'not mocked' } }, { status: 404 });
  });
});
afterEach(() => vi.unstubAllGlobals());

const signal = () => new AbortController().signal;
const T1 = '2026-11-10T14:30:00.000Z';
const refused = (code: string): Answer => ({ status: 400, body: { success: false, error: { code, message: 'Invalid filter' } } });
const reads = (path: RegExp) => sent.filter((request) => path.test(request.url));

describe('the Magnus identity', () => {
  it('asks by agent reference and keeps the answer', async () => {
    const data = { agentRef: 'node-1~lead', nodeId: 'node-1', profile: 'lead', runtime: 'ardent', actorId: 'ardent-lead', workspaceId: 'ws', oathweaveSubject: null, emberpathClientKeyId: null };
    routes.push([/^\/api\/magnus\/agents\/node-1~lead\/identity$/, () => ({ body: { success: true, data } })]);
    await expect(liveSources.identity('node-1~lead', signal())).resolves.toEqual(data);
  });

  it('passes a 404 on as a HiveApiError', async () => {
    await expect(liveSources.identity('node-1~lead', signal())).rejects.toMatchObject({ status: 404 });
  });
});

describe('Studio projects', () => {
  const project = summary();

  it('trusts the filter once Studio has refused a malformed reference', async () => {
    routes.push([/agentRef=not-an-agent-ref/, () => refused('VALIDATION_ERROR')], [/\/projects\?/, () => ({ body: { projects: [project] } })]);
    await expect(liveSources.projects('node-1~lead', signal())).resolves.toEqual({ supported: true, data: [expect.objectContaining({ id: project.id })] });
    expect(reads(/agentRef=node-1%7Elead|agentRef=node-1~lead/)).toHaveLength(1);
    // The answer is remembered.
    await liveSources.projects('node-1~lead', signal());
    expect(reads(/not-an-agent-ref/)).toHaveLength(1);
  });

  it('reports a Studio that ignores the filter as unsupported', async () => {
    routes.push([/\/projects\?/, () => ({ body: { projects: [project] } })]);
    await expect(liveSources.projects('node-1~lead', signal())).resolves.toEqual({ supported: false });
  });

  it('reports a Studio that refuses the parameter as unsupported', async () => {
    routes.push([/\/projects\?/, () => refused('VALIDATION_ERROR')]);
    await expect(liveSources.projects('node-1~lead', signal())).resolves.toEqual({ supported: false });
  });
});

describe('Cindertrace cases', () => {
  const fusionCase = { id: 'case-1', title: 'Repeated sign-in failures', severity: 'high', status: 'open', confidence: 0.8, summary: '', firstSeenAt: T1, lastSeenAt: T1, recommendedInvestigation: [], evidenceSteps: [] };

  it('lists the cases of actor:<actorId> from a release that knows the filter', async () => {
    routes.push([/entity=not-an-agent/, () => refused('INVALID_ENTITY_FILTER')], [/\/security-fusion\/cases\?/, () => ({ body: { success: true, data: [fusionCase] } })]);
    await expect(liveSources.cases('ardent-lead', signal())).resolves.toEqual({ supported: true, data: [fusionCase] });
    expect(reads(/entityType=agent&entity=actor%3Aardent-lead/)).toHaveLength(1);
  });

  it('never shows the unfiltered list of a release that ignores the filter', async () => {
    routes.push([/\/security-fusion\/cases\?/, () => ({ body: { success: true, data: [fusionCase] } })]);
    await expect(liveSources.cases('ardent-lead', signal())).resolves.toEqual({ supported: false });
  });

  it('treats a 400 to the real filter as an older release', async () => {
    routes.push([/\/security-fusion\/cases\?/, () => refused('VALIDATION_ERROR')]);
    await expect(liveSources.cases('ardent-lead', signal())).resolves.toEqual({ supported: false });
  });

  it('passes a refusal of this person on', async () => {
    routes.push([/\/security-fusion\/cases\?/, () => ({ status: 403, body: { success: false, error: { code: 'FORBIDDEN', message: 'No' } } })]);
    await expect(liveSources.cases('ardent-lead', signal())).rejects.toMatchObject({ status: 403 });
  });
});

describe('Emberpath traffic', () => {
  const trace = { id: 'tr_1', requestId: 'r', method: 'POST', path: '/v1/chat/completions', endpointKind: 'chat', routeKey: 'default', statusCode: 200, outcome: 'success', estimatedUsage: false, providerId: null, providerKind: null, providerModel: null, clientApiKeyId: null, actorId: 'ardent-lead', decisionJson: '{}', requestHeadersJson: null, responseHeadersJson: null, requestMetaJson: null, responseMetaJson: null, usageJson: null, retentionJson: null, requestBodyPath: null, responseBodyPath: null, reasoningBodyPath: null, startedAt: T1, endedAt: T1, durationMs: 1, createdAt: T1 };

  it('reads the paged answer as this agent’s traffic', async () => {
    routes.push([/^\/api\/traces\?actorId=ardent-lead&limit=50$/, () => ({ body: { data: [trace], nextCursor: 'c1' } })]);
    await expect(liveSources.traces('ardent-lead', signal())).resolves.toEqual({ supported: true, data: { traces: [expect.objectContaining({ id: 'tr_1' })], nextCursor: 'c1' } });
  });

  it('never passes on the legacy list, which is everyone’s', async () => {
    routes.push([/^\/api\/traces/, () => ({ body: { data: [trace] } })]);
    await expect(liveSources.traces('ardent-lead', signal())).resolves.toEqual({ supported: false });
  });

  const execution = { root: 'hx1:studio:inst:request:m1', self: 'hx1:ardent:node-1.lead:attempt:t1/1/1', parent: null, clientRequestId: null, inboundTraceparent: null, attempt: 1, deadlineMs: null, assertedBy: null, context: null };
  it('asks for the traffic Ardent executions attributed, and trusts only an answer that carries them', async () => {
    routes.push([/executionTask=hx1%3Aardent%3A/, () => ({ body: { data: [{ ...trace, execution, attempts: [] }], nextCursor: null } })]);
    await expect(liveSources.traces('ardent-lead', signal(), true)).resolves.toMatchObject({ supported: true, data: { traces: [{ id: 'tr_1', execution }] } });
    routes.unshift([/executionTask=/, () => ({ body: { data: [trace], nextCursor: null } })]);
    await expect(liveSources.traces('ardent-lead', signal(), true)).resolves.toEqual({ supported: false });
  });

  it("reads one execution's provider traces, unsupported before Emberpath 2.6.0", async () => {
    routes.push([/^\/api\/traces\?limit=50&executionTask=hx1%3Aardent%3Anode-1.lead%3Atask%3At1$/, () => ({ body: { data: [{ ...trace, execution, attempts: [] }], nextCursor: null } })]);
    await expect(executionTraces({ executionTask: 'hx1:ardent:node-1.lead:task:t1' }, signal())).resolves.toMatchObject({ supported: true, data: [{ id: 'tr_1' }] });
    routes.unshift([/^\/api\/traces/, () => ({ body: { data: [trace] } })]);
    await expect(executionTraces({ executionTask: 'hx1:ardent:node-1.lead:task:t1' }, signal())).resolves.toEqual({ supported: false });
  });
});

describe('Ardent executions', () => {
  it('reads the profile tasks through Magnus with their execution context and recovery', async () => {
    routes.push([/^\/api\/magnus\/ardent\/installations\/node-1\/profiles\/lead\/tasks$/, () => ({ body: { success: true, data: { tasks: [
      { id: 't1', state: 'unknown', prompt: 'Publish', created_ms: 1, execution: { v: 1, root: 'hx1:studio:inst:request:m1', parent: 'hx1:studio:inst:task:tsk_1', self: 'hx1:ardent:node-1.lead:task:t1' },
        recovery: { status: 'awaiting_decision', reason: { code: 'UNSETTLED_EXTERNAL_WRITE', message: 'Confirm.' }, attempt: 1, actions: ['mark_applied', 'some_future_action'] } },
      { id: 't0', state: 'completed', prompt: 'Old', created_ms: 0 },
    ] } } })]);
    const [held, old] = await liveSources.executions('node-1', 'lead', signal());
    expect(held!.execution).toEqual({ root: 'hx1:studio:inst:request:m1', parent: 'hx1:studio:inst:task:tsk_1', self: 'hx1:ardent:node-1.lead:task:t1', inputs: undefined });
    // An action this console does not know is never offered.
    expect(held!.recovery?.actions).toEqual(['mark_applied']);
    expect(old!.execution).toBeUndefined();
    expect(old!.recovery).toBeUndefined();
  });
});

describe('HiveSkills targets', () => {
  const target = (magnusNodeId?: string) => ({ name: 'target-a', host: 'target-a.example.internal', username: 'deploy', enabled: true, ...(magnusNodeId ? { magnusNodeId, agentRefs: [`${magnusNodeId}~lead`] } : {}) });

  it('lists the targets bound to the node, with their agent links', async () => {
    routes.push([/nodeId=%21/, () => ({ status: 400, body: { error: 'Invalid target filter' } })], [/\/admin\/targets\?nodeId=node-1$/, () => ({ body: [target('node-1')] })]);
    await expect(liveSources.skillTargets('node-1', signal())).resolves.toEqual({ supported: true, data: [target('node-1')] });
  });

  it('reports a release that ignores the filter as unsupported', async () => {
    routes.push([/\/admin\/targets\?/, () => ({ body: [target()] })]);
    await expect(liveSources.skillTargets('node-1', signal())).resolves.toEqual({ supported: false });
  });

  it('distrusts an answer that holds another node’s target', async () => {
    routes.push([/nodeId=%21/, () => ({ status: 400, body: { error: 'Invalid target filter' } })], [/\/admin\/targets\?/, () => ({ body: [target('node-2')] })]);
    await expect(liveSources.skillTargets('node-1', signal())).resolves.toEqual({ supported: false });
  });
});

describe('HiveMem memories', () => {
  const record = (agentId: string) => ({ agent_id: agentId, confidence: 1, confidence_provenance: [], content: 'x', corroborated_by: [], created_at: T1, deleted_at: null, effective_confidence: null, endorsed_by: [], endorsements: 0, expires_at: null, id: `m-${agentId}`, importance: 0.5, metadata: {}, observed_at: null, opposed_by: [], redaction_policy: 'none', relationships: [], retention_class: 'standard', sanitization_warnings: null, scope: 'private', sensitivity: 'internal', session_id: null, source: 'conversation', superseded_at: null, superseded_by: null, supersedes: null, tags: [], type: 'semantic', updated_at: T1, valid_from: null, valid_to: null, workspace_id: 'ws' });
  const browse = (memories: unknown[]) => ({ body: { limit: 25, memories, next_cursor: null, offset: 0, results: memories, total: memories.length } });

  it('browses with agent_id', async () => {
    routes.push([/^\/api\/memory\/memories\/browse\?agent_id=ardent-lead&workspace_id=\*&limit=25$/, () => browse([record('ardent-lead')])]);
    await expect(liveSources.memories('ardent-lead', '', signal())).resolves.toMatchObject({ supported: true, data: { total: 1 } });
  });

  it('searches with agent_id in the body', async () => {
    routes.push([/\/memories\/search/, () => ({ body: { collections_searched: [], results: [{ collection: 'c', is_own: true, memory: record('ardent-lead'), score: 1 }], total_searched: 1 } })]);
    await liveSources.memories('ardent-lead', 'deploy', signal());
    expect(sent.at(-1)).toMatchObject({ method: 'POST', body: expect.objectContaining({ agent_id: 'ardent-lead', query: 'deploy' }) });
  });

  it('gives away a HiveMem that ignores agent_id by another actor in its answer', async () => {
    routes.push([/\/memories\/browse/, () => browse([record('ardent-lead'), record('someone-else')])]);
    await expect(liveSources.memories('ardent-lead', '', signal())).resolves.toEqual({ supported: false });
  });

  it('shows no figures when HiveMem refuses per-agent stats', async () => {
    routes.push([/\/stats\?agent_id=ardent-lead$/, () => ({ status: 403, body: { detail: 'forbidden' } })]);
    await expect(liveSources.memoryStats('ardent-lead', signal())).resolves.toBeNull();
  });
});
