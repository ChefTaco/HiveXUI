import { describe, expect, it, vi } from 'vitest';
import { createRecordSources, type SourceContext } from './record-sources';
import { RECORD_CAP, type RecordHit, type RecordSource } from './record-search';
import type { AdminUser } from './types';

// Every value is made up.
const T = '2026-11-10T14:30:00.000Z';
const node = (id: string, name: string, hostname: string) => ({
  id, name, hostname, ipAddress: '192.0.2.10', port: 4100, status: 'ONLINE', os: 'linux', arch: 'x64', tags: '[]', metadata: '{}', roleId: null,
  lastHeartbeatAt: T, createdAt: T, updatedAt: T, agent: null, role: null, upgradeReadiness: null, health: null,
});
const installation = (id: string, nodeId: string | null, hostname: string) => ({
  id, nodeId, hostname, sshPort: 22, displayName: null, installMode: 'system', hermesHome: '/srv/hermes', hermesBin: '/usr/bin/hermes', version: '1.0.0',
  status: 'ready', gatewayStatus: 'running', dashboardHost: '127.0.0.1', dashboardPort: 9119, dashboardStatus: 'running', apiServerEnabled: false, apiServerHost: '127.0.0.1',
  apiServerPort: null, lastDetectedAt: T, lastSyncedAt: T, metadata: {}, rawStatus: {}, configuration: null, createdAt: T, updatedAt: T,
});
const hermesProfile = (id: string, installationId: string, name: string) => ({
  id, installationId, name, description: 'Research helper', profileHome: '/srv/hermes/profiles', isDefault: false, providerSummary: null, modelSummary: null,
  distribution: null, gatewayStatus: 'running', apiServerEnabled: false, apiServerHost: '127.0.0.1', apiServerPort: null, apiServerKeyConfigured: false,
  capabilities: {}, envStatus: {}, metadata: {}, lastSyncedAt: T, createdAt: T, updatedAt: T,
});
const project = (n: number, name: string) => ({
  id: `prj_01HZX3K6Q1V8R2M4N6P8T0W00${n}`, name, audience: null, constraints: [], tags: [], status: 'active', created_by: 'alice',
  hivemem: { workspace_id: `studio-${n}`, state: 'ready', error: null }, chattermost_channel_id: null, last_area: 'room', created_at: T, updated_at: T, archived_at: null,
  brief_excerpt: '', file_count: 0, link_count: 0, deliverable_count: 0, team: { revision: 1, role_count: 1, bound_count: 1 }, open_questions: 0, review_pending: 0, active_tasks: 0,
  last_activity: { type: 'message', at: T, text: 'Draft posted' },
});
const memory = (id: string, content: string) => ({
  agent_id: 'ardent-lead', confidence: 0.9, confidence_provenance: [], content, corroborated_by: [], created_at: T, deleted_at: null, effective_confidence: null,
  endorsed_by: [], endorsements: 0, expires_at: null, id, importance: 0.5, metadata: {}, observed_at: null, opposed_by: [], redaction_policy: 'none', relationships: [],
  retention_class: 'standard', sanitization_warnings: null, scope: 'private', sensitivity: 'internal', session_id: null, source: 'conversation', superseded_at: null,
  superseded_by: null, supersedes: null, tags: [], type: 'semantic', updated_at: T, valid_from: null, valid_to: null, workspace_id: 'ardent-agents',
});
const fusionCase = (id: string, title: string) => ({ id, title, severity: 'high', status: 'open', confidence: 0.8, summary: 'Summary text', firstSeenAt: T, lastSeenAt: T, recommendedInvestigation: [], evidenceSteps: [] });
const trace = (id: string, requestId: string) => ({
  id, requestId, method: 'POST', path: '/v1/chat/completions', endpointKind: 'v1.chat.completions', routeKey: 'default', statusCode: 200, outcome: 'success', estimatedUsage: false,
  providerId: null, providerKind: null, providerModel: null, clientApiKeyId: null, decisionJson: '{}', requestHeadersJson: null, responseHeadersJson: null, requestMetaJson: null,
  responseMetaJson: null, usageJson: null, retentionJson: null, requestBodyPath: null, responseBodyPath: null, reasoningBodyPath: null, startedAt: T, endedAt: T, durationMs: 800, createdAt: T,
});
const skill = (slug: string, name: string) => ({ slug, name, description: `${name} things.`, homepage: null, enabled: true, createdAt: T, updatedAt: T });
const iamUser = (id: string, username: string, displayName: string | null) => ({ id, email: `${username}@example.com`, username, displayName, active: true, lastLoginAt: null, createdAt: T, roles: [] });
const client = (id: string, name: string) => ({ id, name, description: null, active: true, clientType: 'public', redirectUris: [], grantTypes: [], firstParty: false, createdAt: T });

interface Sent {
  method: string;
  path: string;
  body: unknown;
}
type Answer = unknown | ((sent: Sent) => unknown);
function api(routes: Record<string, Answer>) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (path: string, init: RequestInit = {}) => {
    const entry: Sent = { method: init.method ?? 'GET', path, body: typeof init.body === 'string' ? JSON.parse(init.body) : null };
    sent.push(entry);
    const key = `${entry.method} ${path.split('?')[0]}`;
    if (!(key in routes)) return Response.json({ error: 'not found' }, { status: 404 });
    const answer = routes[key];
    const value = typeof answer === 'function' ? (answer as (sent: Sent) => unknown)(entry) : answer;
    return value instanceof Response ? value : Response.json(value);
  });
  return { fetch, sent };
}
const ADMIN: AdminUser = { id: 'u1', username: 'admin', permissions: ['*'] };
function sources(routes: Record<string, Answer>, context: Partial<SourceContext> = {}) {
  const { fetch, sent } = api(routes);
  const list = createRecordSources({ user: ADMIN, suite: false, magnus: async () => ({ hermes: true }), fetch, ...context });
  const byId = (id: string) => list.find((source) => source.id === id)!;
  return { list, byId, sent };
}
const signal = () => new AbortController().signal;
async function run(source: RecordSource, query: string): Promise<{ allowed: boolean; hits: RecordHit[] }> {
  if (!(await source.allowed(signal()))) return { allowed: false, hits: [] };
  return { allowed: true, hits: await source.search(query, RECORD_CAP + 1, signal()) };
}
const queryOf = (path: string) => new URLSearchParams(path.split('?')[1] ?? '');

describe('the live record sources', () => {
  it('cover every product the palette searches, in display order', () => {
    expect(sources({}).list.map((source) => `${source.product}/${source.id}`)).toEqual([
      'magnus/magnus-nodes',
      'magnus/magnus-agents',
      'ardentstudio/studio-projects',
      'hivemem/hivemem-memories',
      'cindertrace/cindertrace-cases',
      'emberpath/emberpath-traces',
      'hiveskills/hiveskills-skills',
      'oathweave/oathweave-users',
      'oathweave/oathweave-clients',
    ]);
  });

  it('Magnus nodes: searched by Magnus, by name or hostname, and open the node page', async () => {
    const { byId, sent } = sources({
      'GET /api/magnus/nodes': { success: true, data: [node('n1', 'atlas', 'atlas.example.com'), node('n2', 'boreas', 'boreas.example.com')], meta: { total: 2, page: 1, pageSize: 6, hasMore: false } },
    });
    const { hits } = await run(byId('magnus-nodes'), 'atlas');
    expect(queryOf(sent[0]!.path).get('query')).toBe('atlas');
    expect(queryOf(sent[0]!.path).get('pageSize')).toBe(String(RECORD_CAP + 1));
    // A Magnus that ignored the query listed both; only the match is shown.
    expect(hits).toEqual([{ id: 'n1', label: 'atlas', detail: 'atlas.example.com', href: '/fleet/nodes/n1', icon: 'Server' }]);
  });

  it('Magnus agents: Hermes profiles filtered here, opening Agent 360', async () => {
    const { byId, sent } = sources({
      'GET /api/magnus/orchestra/installations': { success: true, data: [installation('i1', 'node-1', 'atlas.example.com'), installation('i2', null, 'loose.example.com')] },
      'GET /api/magnus/orchestra/profiles': { success: true, data: [hermesProfile('p1', 'i1', 'scout'), hermesProfile('p2', 'i1', 'writer'), hermesProfile('p3', 'i2', 'scout')] },
    });
    const { hits } = await run(byId('magnus-agents'), 'scout');
    expect(sent.every((entry) => !entry.path.includes('scout'))).toBe(true);
    expect(hits).toEqual([{ id: 'node-1~scout', label: 'scout', detail: 'atlas.example.com', href: '/agents/node-1~scout', icon: 'Radar' }]);
  });

  it('Magnus: no session hides both lists; Hermes off hides only the agents', async () => {
    const none = sources({}, { magnus: async () => null });
    expect(await none.byId('magnus-nodes').allowed(signal())).toBe(false);
    expect(await none.byId('magnus-agents').allowed(signal())).toBe(false);
    const noHermes = sources({}, { magnus: async () => ({ hermes: false }) });
    expect(await noHermes.byId('magnus-nodes').allowed(signal())).toBe(true);
    expect(await noHermes.byId('magnus-agents').allowed(signal())).toBe(false);
  });

  it('Studio projects: searched by Studio, open the project, with a see-all link to its home', async () => {
    const { byId, sent } = sources({ 'GET /api/ardentstudio/v1/projects': { projects: [project(1, 'Sunken Archive')] } });
    const source = byId('studio-projects');
    const { hits } = await run(source, 'sunken');
    expect(Object.fromEntries(queryOf(sent[0]!.path))).toEqual({ status: 'all', q: 'sunken' });
    expect(hits).toEqual([{ id: 'prj_01HZX3K6Q1V8R2M4N6P8T0W001', label: 'Sunken Archive', href: '/studio/p/prj_01HZX3K6Q1V8R2M4N6P8T0W001', icon: 'Workflow' }]);
    expect(source.seeAll?.('sunken')).toBe('/studio?q=sunken');
  });

  it('HiveMem memories: text search in every workspace, opening the same search in Memories', async () => {
    const { byId, sent } = sources({
      'GET /api/memory/profile': { agent_id: 'agent-admin', display_name: 'Admin', role: 'agent', scopes: ['memories:read'], workspace_ids: null },
      'POST /api/memory/memories/search': { collections_searched: [], results: [{ collection: 'c', is_own: false, memory: memory('m1', 'The archive prefers short, cited summaries.'), score: 1 }], total_searched: 1 },
    });
    const source = byId('hivemem-memories');
    const { hits } = await run(source, 'archive');
    const search = sent.find((entry) => entry.method === 'POST')!;
    expect(search.path).toBe('/api/memory/memories/search?workspace_id=*');
    expect(search.body).toEqual({ query: 'archive', workspace_id: '*', limit: RECORD_CAP + 1 });
    expect(hits).toEqual([{ id: 'm1', label: 'The archive prefers short, cited summaries.', detail: 'semantic · ardent-lead', href: '/?page=memories&q=archive&workspace=*', icon: 'Brain' }]);
    expect(source.seeAll?.('archive')).toBe('/?page=memories&q=archive&workspace=*');
  });

  it('HiveMem: a profile without memories:read is never sent the query', async () => {
    const { byId, sent } = sources({ 'GET /api/memory/profile': { agent_id: 'agent-x', display_name: 'X', role: 'agent', scopes: ['workspaces:read'], workspace_ids: null } });
    expect((await run(byId('hivemem-memories'), 'secret')).allowed).toBe(false);
    expect(sent.map((entry) => entry.path)).toEqual(['/api/memory/profile']);
  });

  it('Cindertrace cases: the case list is read and filtered here, by title or exact ID', async () => {
    const { byId, sent } = sources({ 'GET /api/security/security-fusion/cases': { success: true, data: [fusionCase('case-1', 'Repeated sign-in failures'), fusionCase('case-2', 'DNS volume')] } });
    const source = byId('cindertrace-cases');
    expect((await run(source, 'sign-in')).hits).toEqual([{ id: 'case-1', label: 'Repeated sign-in failures', detail: 'high · open', href: '/security-fusion/cases/case-1', icon: 'ScanSearch' }]);
    expect((await run(source, 'case-2')).hits.map((hit) => hit.id)).toEqual(['case-2']);
    expect(sent.every((entry) => entry.path === '/api/security/security-fusion/cases')).toBe(true);
  });

  it('Emberpath traces: only ID-shaped queries, matched exactly by trace or request ID, for router:admin:read', async () => {
    const { byId, sent } = sources({ 'GET /api/traces': { data: [trace('tr_100001', 'req_200001'), trace('tr_100002', 'req_200002')] } });
    const source = byId('emberpath-traces');
    expect(source.applies?.('router')).toBe(false);
    expect(source.applies?.('req_200002')).toBe(true);
    expect((await run(source, 'req_200002')).hits).toEqual([{ id: 'tr_100002', label: 'POST /v1/chat/completions', detail: 'Request req_200002', href: '/?page=traces&trace=tr_100002', icon: 'Activity' }]);
    expect((await run(source, 'tr_100001')).hits.map((hit) => hit.id)).toEqual(['tr_100001']);
    expect((await run(source, 'tr_1000')).hits).toEqual([]);
    expect(sent.every((entry) => entry.path === '/api/traces')).toBe(true);
    const reader = sources({}, { user: { id: 'u2', username: 'viewer', permissions: ['router:routing:read'] } });
    expect(await reader.byId('emberpath-traces').allowed(signal())).toBe(false);
  });

  it('HiveSkills skills: the catalog is read and filtered here', async () => {
    const { byId, sent } = sources({ 'GET /api/skills/v1/skills': [skill('summarize', 'Summarize'), skill('translate', 'Translate')] });
    expect((await run(byId('hiveskills-skills'), 'summ')).hits).toEqual([{ id: 'summarize', label: 'Summarize', detail: 'summarize', href: '/?page=skills', icon: 'Puzzle' }]);
    expect(sent.map((entry) => entry.path)).toEqual(['/api/skills/v1/skills']);
  });

  it('Oathweave users: searched by Oathweave for iam:users:read; clients filtered here for iam:clients:read', async () => {
    const { byId, sent } = sources({
      'GET /api/iam/users': { users: [iamUser('iu1', 'alice', 'Alice Example'), iamUser('iu2', 'bob', null)], total: 2, page: 1, limit: 6 },
      'GET /api/iam/clients': { clients: [client('cl1', 'Build agent'), client('cl2', 'Docs site')] },
    });
    expect((await run(byId('oathweave-users'), 'alice')).hits).toEqual([{ id: 'iu1', label: 'Alice Example', detail: 'alice@example.com', href: '/?page=iam-users', icon: 'Key' }]);
    expect(Object.fromEntries(queryOf(sent[0]!.path))).toEqual({ search: 'alice', limit: String(RECORD_CAP + 1) });
    expect((await run(byId('oathweave-clients'), 'build')).hits).toEqual([{ id: 'cl1', label: 'Build agent', detail: 'public', href: '/?page=iam-clients', icon: 'Route' }]);
    expect(sent[1]!.path).toBe('/api/iam/clients');
  });

  it('Oathweave: a role without the read permission is never sent the query', async () => {
    const { byId, sent } = sources({}, { user: { id: 'u3', username: 'helper', permissions: ['iam:users:read'] } });
    expect(await byId('oathweave-users').allowed(signal())).toBe(true);
    expect(await byId('oathweave-clients').allowed(signal())).toBe(false);
    expect(sent).toEqual([]);
  });

  it('suite sign-in: product permissions come from the product, asked once, and a refusal reads as no', async () => {
    const { byId, sent } = sources(
      {
        'GET /api/iam/auth/me': { user: { id: 'u1', username: 'alice', displayName: null, roles: ['viewer'], permissions: ['iam:clients:read'] } },
        'GET /api/auth/me': new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } }),
      },
      { suite: true },
    );
    expect(await byId('oathweave-users').allowed(signal())).toBe(false);
    expect(await byId('oathweave-clients').allowed(signal())).toBe(true);
    expect(await byId('emberpath-traces').allowed(signal())).toBe(false);
    expect(sent.filter((entry) => entry.path === '/api/iam/auth/me')).toHaveLength(1);
  });

  it('a refusal from a product reaches the search as a 403, which hides the source', async () => {
    const { byId } = sources({ 'GET /api/skills/v1/skills': new Response(JSON.stringify({ error: 'nope' }), { status: 403, headers: { 'content-type': 'application/json' } }) });
    await expect(byId('hiveskills-skills').search('summ', 6, signal())).rejects.toMatchObject({ status: 403 });
  });

  it('an answer outside the contract is a failure, not records', async () => {
    const { byId } = sources({ 'GET /api/skills/v1/skills': [{ slug: 1 }] });
    await expect(byId('hiveskills-skills').search('summ', 6, signal())).rejects.toThrow('shape');
  });
});
