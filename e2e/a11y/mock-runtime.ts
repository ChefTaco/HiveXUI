// A mocked HiveXUI runtime for browser tests that need no backends: a suite runtime.json with
// Oathweave browser sign-in, a mocked Oathweave that signs real ID tokens with a per-run key, and
// made-up product API answers served through Playwright request interception. Every value is
// fictional (example.com hosts, alice, bob and carol). Unmocked API calls get a 404.
import type { Page, Request } from '@playwright/test';
import { createHash } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import * as studio from '../../src/modules/studio/test-fixtures';

type Body = unknown;
type Answer = Body | ((match: RegExpMatchArray, url: URL, request: Request) => Body);

// ---------------------------------------------------------------- fixture data (all made up)
const T0 = '2026-11-01T09:00:00.000Z';
const T1 = '2026-11-10T14:30:00.000Z';
// The browser clock is frozen at NOW_MS so relative times ("2h ago") match between runs.
const NOW_MS = Date.parse('2026-11-12T12:00:00.000Z');
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

// The runtime maps each product to a same-origin prefix. Emberpath's prefix must be /api/<name>,
// so its logical '/api/...' calls arrive as '/api/emberpath/...'. The others keep their logical path.
const PRODUCTS = {
    emberpath: '/api/emberpath',
    oathweave: '/api/iam',
    hivemem: '/api/memory',
    hiveskills: '/api/skills',
    chattermost: '/api/chat',
    cindertrace: '/api/security',
    embermend: '/api/embermend',
    magnus: '/api/magnus',
    ardentstudio: '/api/ardentstudio',
};
const ISSUER = 'https://identity.example.com';
const RUNTIME = {
  schema: 1,
  products: PRODUCTS,
  identity: {
    issuer: ISSUER,
    apiPrefix: '/api/iam',
    clients: Object.fromEntries(Object.keys(PRODUCTS).map((name) => [name, `hivexui-${name}`])),
  },
};

const ADMIN = {
  id: 'usr_admin', username: 'admin', displayName: 'Admin Operator', createdAt: T0, updatedAt: T1,
  roles: ['admin'], permissions: ['*'],
};

const model = (providerId: string, name: string, i: number) => ({
  id: `${providerId}-m${i}`, providerId, model: name, displayName: null, enabled: true,
  maxContextWindow: 128000, capabilityJson: null, createdAt: T0, updatedAt: T1,
});
const provider = (id: string, slug: string, name: string, kind: string, baseUrl: string, health: string, models: string[], extra: Record<string, unknown> = {}) => ({
  id, slug, name, kind, baseUrl, authMode: kind === 'OLLAMA' ? 'NONE' : 'BEARER', authHeaderName: 'Authorization',
  authSecretMasked: kind === 'OLLAMA' ? null : 'sk-****abcd', defaultHeaders: {},
  capabilities: { tools: true, streaming: true, tags: ['general'] }, timeoutMs: 120000, maxRetries: 1, concurrency: 16,
  priority: 100, weight: 100, failoverGroup: null, enabled: true,
  lastHealthStatus: health, lastHealthError: health === 'unhealthy' ? 'connect timeout' : null, lastHealthAt: T1,
  models: models.map((m, i) => model(id, m, i)), ...extra,
});
const PROVIDERS = [
  // As Emberpath returns stored credentials: the secret masked, a credential header hidden.
  provider('prv_a', 'router-a', 'Router A', 'OPENAI_GENERIC', 'https://router-a.example.com/v1', 'healthy', ['model-large', 'model-small'],
    { hasAuthSecret: true, defaultHeaders: { 'x-api-token': '[redacted]', 'x-title': 'Hive' }, redactedDefaultHeaders: ['x-api-token'] }),
  provider('prv_b', 'router-b', 'Router B', 'OLLAMA', 'http://router-b.example.internal:11434', 'healthy', ['local-7b']),
  provider('prv_c', 'router-c', 'Router C', 'ANTHROPIC', 'https://router-c.example.com', 'unhealthy', ['model-chat'], { priority: 50 }),
  provider('prv_d', 'router-d', 'Router D', 'VLLM', 'http://router-d.example.internal:8000', 'unknown', ['vision-1'], { enabled: false }),
];
const summary = (p: (typeof PROVIDERS)[number] | undefined) => ({ id: p!.id, slug: p!.slug, name: p!.name, kind: p!.kind });
const ALIASES = [
  { id: 'al_1', alias: 'default', providerId: 'prv_a', upstreamModel: 'model-large', enabled: true, description: 'General purpose', createdAt: T0, updatedAt: T1, provider: summary(PROVIDERS[0]) },
  { id: 'al_2', alias: 'local', providerId: 'prv_b', upstreamModel: 'local-7b', enabled: true, description: null, createdAt: T0, updatedAt: T1, provider: summary(PROVIDERS[1]) },
];
const ROUTE_RULES = [
  { id: 'rr_1', name: 'Prefer local', kind: 'PROVIDER_PREFERENCE', priority: 100, enabled: true,
    matchJson: JSON.stringify({ models: ['local'] }), actionJson: JSON.stringify({ providerIds: ['prv_b'] }), createdAt: T0, updatedAt: T1 },
];
const HEURISTICS = [
  { id: 'hr_1', name: 'Code requests', category: 'coding', pattern: 'function|class', score: 10, enabled: true,
    actionJson: JSON.stringify({ action: 'rerank', targetTag: 'general' }), createdAt: T0, updatedAt: T1 },
];
const CLIENT_KEYS = [
  { id: 'ck_1', name: 'build-agent', keyPrefix: 'ep_ab12', enabled: true, metadataJson: JSON.stringify({ owner: 'alice@example.com', environment: 'dev' }), lastUsedAt: T1, expiresAt: null, createdAt: T0, updatedAt: T1 },
];
const trace = (i: number, ok: boolean) => ({
  id: `tr_${i}`, requestId: `req_${i}`, method: 'POST', path: '/v1/chat/completions', endpointKind: 'v1.chat.completions',
  routeKey: 'default', statusCode: ok ? 200 : 502, outcome: ok ? 'success' : 'failure', estimatedUsage: false,
  providerId: ok ? 'prv_a' : 'prv_c', providerKind: ok ? 'OPENAI_GENERIC' : 'ANTHROPIC', providerModel: 'model-large', clientApiKeyId: 'ck_1',
  decisionJson: '{}', requestHeadersJson: null, responseHeadersJson: null, requestMetaJson: null, responseMetaJson: null,
  usageJson: JSON.stringify({ prompt_tokens: 120, completion_tokens: 80 }), retentionJson: null, requestBodyPath: null,
  responseBodyPath: null, reasoningBodyPath: null, startedAt: T1, endedAt: T1, durationMs: 840 + i * 13, createdAt: T1,
  provider: summary(ok ? PROVIDERS[0] : PROVIDERS[2]), clientApiKey: null,
});
const TRACES = [trace(1, true), trace(2, true), trace(3, false)];
const auditUser = { id: 'usr_admin', username: 'admin', displayName: 'Admin Operator', createdAt: T0, updatedAt: T1 };
const AUDIT = [
  ['provider.update', 'provider', 'prv_a'], ['provider.create', 'provider', 'prv_d'], ['client_key.rotate', 'client_key', 'ck_1'],
  ['route_rule.create', 'route_rule', 'rr_1'], ['auth.login', 'admin_user', 'usr_admin'],
].map(([action, entityType, entityId], i) => ({
  id: `au_${i}`, actorType: 'admin', adminUserId: 'usr_admin', action, entityType, entityId,
  metadataJson: JSON.stringify({ source: 'hivexui' }), createdAt: new Date(NOW_MS - i * 3600_000).toISOString(), adminUser: auditUser,
}));

const iamRole = (id: string, name: string, label: string, permissions: string[], isSystem: boolean) => ({ id, name, label, description: null, permissions, isSystem, createdAt: T0, updatedAt: T1 });
const IAM_ROLES = [iamRole('role_admin', 'admin', 'Administrator', ['*'], true), iamRole('role_ops', 'operator', 'Operator', ['emberpath:read'], false)];
const iamUser = (id: string, username: string, email: string, displayName: string | null, roleName: string, extra: Record<string, unknown> = {}) => ({
  id, email, username, displayName, active: true, lockedUntil: null, failedAttempts: 0, mfaEnabled: true, passkeyCount: 1,
  trustedDeviceCount: 1, passwordChangedAt: T0, lastLoginAt: T1, createdAt: T0,
  roles: [{ roleId: `role_${roleName === 'admin' ? 'admin' : 'ops'}`, grantedAt: T0, grantedBy: null, role: { name: roleName, label: roleName === 'admin' ? 'Administrator' : 'Operator' } }],
  ...extra,
});
const IAM_USERS = [
  iamUser('iu_1', 'alice', 'alice@example.com', 'Alice Example', 'admin'),
  iamUser('iu_2', 'bob', 'bob@example.com', 'Bob Example', 'operator', { mfaEnabled: false, passkeyCount: 0 }),
  iamUser('iu_3', 'carol', 'carol@example.com', null, 'operator', { active: false, lastLoginAt: null }),
];

const chatUser = (id: string, username: string, first: string, last: string, roles: string, extra: Record<string, unknown> = {}) => ({
  id, create_at: NOW_MS - 86400_000 * 30, update_at: NOW_MS, delete_at: 0, username, auth_data: '', auth_service: '',
  email: `${username}@example.com`, nickname: '', first_name: first, last_name: last, position: '', roles, locale: 'en',
  timezone: {}, notify_props: {}, last_picture_update: 0, is_bot: false, bot_description: '', ...extra,
});
const CHAT_ME = chatUser('cu00000000000000000000adm1', 'admin', 'Admin', 'Operator', 'system_admin system_user');
const CHAT_USERS = [
  CHAT_ME,
  chatUser('cu00000000000000000000ali1', 'alice', 'Alice', 'Example', 'system_user'),
  chatUser('cu00000000000000000000bob1', 'bob', 'Bob', 'Example', 'system_user', { delete_at: NOW_MS - 86400_000 }),
];
const adminChatUser = (u: ReturnType<typeof chatUser>) => ({ id: u.id, username: u.username, email: u.email, nickname: u.nickname, first_name: u.first_name, last_name: u.last_name, position: u.position, roles: u.roles, delete_at: u.delete_at, is_bot: u.is_bot, locale: u.locale });

const SKILLS = [
  { slug: 'summarize', name: 'Summarize', description: 'Condense long documents.', homepage: null, enabled: true, createdAt: T0, updatedAt: T1 },
  { slug: 'translate', name: 'Translate', description: 'Translate text between languages.', homepage: 'https://example.com/translate', enabled: true, createdAt: T0, updatedAt: T1 },
];

const PROFILE = { agent_id: 'agent-admin', display_name: 'Admin Operator', role: 'admin', scopes: ['admin:all'], workspace_ids: null };
const workspace = (id: string, title: string, owner: string) => ({
  workspace_id: id, title, description: 'Shared notes for the team', created_at: T0, updated_at: T1, deleted_at: null, owner_agent_id: owner, metadata: {},
  members: [{ agent_id: owner, role: 'owner', scopes: ['memories:write'], added_by: null, created_at: T0, updated_at: T1 },
    { agent_id: 'agent-b', role: 'member', scopes: ['memories:read'], added_by: owner, created_at: T0, updated_at: T1 }],
  policy: { agent_overrides: {}, allowed_scopes: ['memories:read', 'memories:write'], consolidation_cadence_seconds: null, reasoning_provider: null, retention_days: 90,
    sanitization: { deny_regexes: [], detect_pii: true, detect_secrets: true, mode: 'redact' }, session_overrides: {}, webhooks_enabled: false },
});
const WORKSPACES = [workspace('ws-alpha', 'Alpha project', 'agent-admin'), workspace('ws-beta', 'Beta research', 'agent-b')];

// What a legacy installation's native status API reports about its products.
const hiveApp = (key: string, name: string, status: string, summary: string, latencyMs: number, details: Record<string, unknown> = {}) => ({
  key, name, role: 'Product API', status, summary, internalUrl: '', publicUrl: '', consoleUrl: `https://${key}.example.com`, latencyMs, details,
  checks: [{ name: 'readiness', status: status === 'online' ? 'pass' : 'warn', message: summary }],
});
const HIVE_APPS = [
  hiveApp('router', 'Hive Router', 'online', 'Routing traffic', 14, {
    tlsCertificate: { configured: true, status: 'pass', message: 'Certificate is valid.', domains: ['hive.example.com'], expectedHost: 'hive.example.com', hostnameMatched: true, validTo: '2027-02-01T00:00:00.000Z', daysRemaining: 81, issuer: 'Example CA' },
    securityExporterJwks: { state: 'healthy', remainingMs: 3_600_000, trustedKeyCount: 2 },
  }),
  hiveApp('iam', 'Hive IAM', 'online', 'Identity core ready', 9),
  hiveApp('memory', 'Hive Memory', 'degraded', 'Consolidation is behind', 41),
];

// Cindertrace answers in a { success, data } envelope that the browser checks against its contract.
const fusion = (data: unknown) => ({ success: true, data });
const fusionCase = (id: string, title: string, severity: string, confidence: number) => ({
  id, title, severity, status: 'open', confidence, summary: `${title} across the lab network.`, firstSeenAt: T0, lastSeenAt: T1,
  recommendedInvestigation: ['Confirm the source address owner', 'Compare with the change calendar'], evidenceSteps: [],
});
const FUSION_CASES = [
  fusionCase('case-1', 'Repeated sign-in failures', 'high', 0.82),
  fusionCase('case-2', 'Unexpected outbound DNS volume', 'medium', 0.61),
  fusionCase('case-3', 'New service listening on a node', 'low', 0.4),
];
const fusionEvent = (i: number, source: string, kind: string, severity: string, summary: string) => ({
  id: `fev_${i}`, eventId: `evt-${i}`, source, kind, observedAt: new Date(NOW_MS - i * 600_000).toISOString(), severity, confidence: 0.5 + i / 10,
  summary, integritySha256: 'c'.repeat(64), attributes: { host: `node-${i}.example.internal` },
});
const FUSION_EVENTS = [
  fusionEvent(1, 'hive', 'auth.failure', 'high', 'Five failed sign-ins for bob from one address'),
  fusionEvent(2, 'magnus', 'service.started', 'low', 'A new service started on node-2'),
  fusionEvent(3, 'unifi_dns', 'dns.volume', 'medium', 'DNS queries above the usual rate'),
];
const FUSION_SOURCES = [
  { source: 'hive', status: 'healthy', lastEventAt: T1, lastSuccessAt: T1, lastError: null },
  { source: 'magnus', status: 'healthy', lastEventAt: T1, lastSuccessAt: T1, lastError: null },
  { source: 'unifi_dns', status: 'error', lastEventAt: T0, lastSuccessAt: T0, lastError: 'collector unreachable' },
];
const FUSION_ENTITIES = [
  { id: 'ent-1', type: 'user', canonical: 'user:bob@example.com', label: 'bob@example.com', lastSeenAt: T1 },
  { id: 'ent-2', type: 'host', canonical: 'host:node-2.example.internal', label: 'node-2', lastSeenAt: T1 },
  { id: 'ent-3', type: 'agent', canonical: 'actor:ardent-lead', label: 'lead', lastSeenAt: T1,
    aliasesJson: JSON.stringify(['actor:ardent-lead', 'magnus-node:node-1', 'agent-ref:node-1~lead']) },
];
const FUSION_EVIDENCE = [{ id: 'evd-1', sourceLocator: 'hive://audit/evt-1', sha256: 'd'.repeat(64), preservedAt: T1, mediaType: 'application/json' }];

// Agent 360 for the agent node-1~lead: Magnus names it, every other product answers about it.
const AGENT_REF = 'node-1~lead';
const ACTOR = 'ardent-lead';
const AGENT_IDENTITY = { agentRef: AGENT_REF, nodeId: 'node-1', profile: 'lead', runtime: 'ardent', actorId: ACTOR, workspaceId: 'ardent-agents', oathweaveSubject: null, emberpathClientKeyId: null };
const AGENT_NODE = {
  id: 'node-1', name: 'node-1', hostname: 'node-1.example.internal', ipAddress: '192.0.2.10', port: 4000, status: 'ONLINE', os: 'linux', arch: 'x64',
  tags: '[]', metadata: '{}', roleId: null, lastHeartbeatAt: T1, createdAt: T0, updatedAt: T1,
  agent: { id: 'ag-1', nodeId: 'node-1', version: '2.0.0', status: 'RUNNING', pid: 4242, startedAt: T0, lastCheckIn: T1, capabilities: '{}' }, role: null, upgradeReadiness: null,
};
const ARDENT_INSTALLATION = {
  nodeId: 'node-1', nodeName: 'node-1', hostname: 'node-1.example.internal', reachable: true, error: null, installed: true, version: '2.2.0', owner: 'ardent', checkedAt: T1,
  profiles: [{ id: 'lead', name: 'lead', backend: 'llamacpp', apiPort: 9910, running: true, a2aEnabled: true, channels: { web: true, chat: false }, error: null }],
};
const agentMemory = (i: number, content: string, type: string) => ({
  agent_id: ACTOR, confidence: 0.9, confidence_provenance: [], content, corroborated_by: [], created_at: new Date(NOW_MS - i * 3600_000).toISOString(), deleted_at: null,
  effective_confidence: null, endorsed_by: [], endorsements: 0, expires_at: null, id: `mem-${i}`, importance: 0.5, metadata: {}, observed_at: null, opposed_by: [],
  redaction_policy: 'none', relationships: [], retention_class: 'standard', sanitization_warnings: null, scope: 'private', sensitivity: 'internal', session_id: null,
  source: 'conversation', superseded_at: null, superseded_by: null, supersedes: null, tags: [], type, updated_at: T1, valid_from: null, valid_to: null, workspace_id: 'ardent-agents',
});
const AGENT_MEMORIES = [
  agentMemory(1, 'The archive project prefers short, cited summaries.', 'semantic'),
  agentMemory(2, 'Deploys to node-2 need the maintenance window.', 'procedural'),
  agentMemory(3, 'Reviewed the draft chapter with the team.', 'episodic'),
];
const studioProject = (n: number, name: string, bound: number, review: number) => ({
  id: `prj_01HZX3K6Q1V8R2M4N6P8T0W00${n}`, name, audience: null, constraints: [], tags: [], status: 'active', created_by: 'alice',
  hivemem: { workspace_id: `studio-${n}`, state: 'ready', error: null }, chattermost_channel_id: null, last_area: 'room', created_at: T0, updated_at: T1, archived_at: null,
  brief_excerpt: '', file_count: 2, link_count: 0, deliverable_count: 1, team: { revision: 2, role_count: 3, bound_count: bound },
  open_questions: 0, review_pending: review, active_tasks: 1, last_activity: { type: 'message', at: T1, text: 'Draft posted' },
});
const AGENT_PROJECTS = [studioProject(1, 'Sunken Archive', 3, 1), studioProject(2, 'Market scan', 2, 0)];
const AGENT_CASES = [FUSION_CASES[0]];
const AGENT_TRACES = [trace(11, true), trace(12, true), trace(13, false)].map((item) => ({ ...item, actorId: ACTOR }));
const AGENT_TARGETS = [
  { name: 'node-1-lead', host: 'node-1.example.internal', username: 'deploy', enabled: true, magnusNodeId: 'node-1', agentRefs: [AGENT_REF] },
  { name: 'node-1-shared', host: 'node-1.example.internal', username: 'deploy', enabled: false, magnusNodeId: 'node-1', agentRefs: [] },
];
const refused = (body: unknown) => ({ __status: 400, body });

// Record search from the command palette (Ctrl+K). Oathweave's client list is left unmocked, so the
// palette shows its quiet "couldn't search" note beside the products that answered.
const HERMES_INSTALLATION = {
  id: 'hi-1', nodeId: 'node-1', hostname: 'node-1.example.internal', sshPort: 22, displayName: null, installMode: 'system', hermesHome: '/srv/hermes', hermesBin: '/usr/bin/hermes',
  version: '1.0.0', status: 'ready', gatewayStatus: 'running', dashboardHost: '127.0.0.1', dashboardPort: 9119, dashboardStatus: 'running', apiServerEnabled: false,
  apiServerHost: '127.0.0.1', apiServerPort: null, lastDetectedAt: T1, lastSyncedAt: T1, metadata: {}, rawStatus: {}, configuration: null, createdAt: T0, updatedAt: T1,
};
const HERMES_PROFILES = [{
  id: 'hp-1', installationId: 'hi-1', name: 'node-scout', description: 'Watches node health', profileHome: '/srv/hermes/profiles/node-scout', isDefault: false,
  providerSummary: null, modelSummary: null, distribution: null, gatewayStatus: 'running', apiServerEnabled: false, apiServerHost: '127.0.0.1', apiServerPort: null,
  apiServerKeyConfigured: false, capabilities: {}, envStatus: {}, metadata: {}, lastSyncedAt: T1, createdAt: T0, updatedAt: T1,
}];
const memorySearch = (request: Request) => {
  const query = String((request.postDataJSON() as { query?: string }).query ?? '').toLowerCase();
  return { collections_searched: ['semantic'], total_searched: AGENT_MEMORIES.length,
    results: AGENT_MEMORIES.filter((memory) => memory.content.toLowerCase().includes(query)).map((memory) => ({ collection: 'semantic', is_own: false, memory, score: 0.8 })) };
};

// ---------------------------------------------------------------- route table
// Each entry: [method, regexp on the request pathname (+search), body | (match, url, request) => body].
// Returning { __status, body } sets a status. Unmatched /api/** requests get 404 {error:'not mocked'}.
// Magnus (logical paths under /api/magnus, relative to its /api/v1)
const magnusOk = (data: unknown) => ({ success: true, data });
const MAGNUS_SESSION = { userId: 'usr_admin', role: 'ADMIN', capabilities: { hermes: true, terminal: false, agentVersion: '2.0.0', magnusVersion: '2.0.0', securityConsoleUrl: null } };
/** A Magnus 3.0.2 session: the upgrade drawer offers Allow major upgrade (allowMajor, Magnus 3.0.1). */
export const MAGNUS_SESSION_V3 = { ...MAGNUS_SESSION, capabilities: { ...MAGNUS_SESSION.capabilities, agentVersion: '3.0.2', magnusVersion: '3.0.2' } };
const timelineItem = (type: string, severity: string, title: string, minutesAgo: number, href: string, node: string | null = null) => ({
  type, severity, title, node, timestamp: new Date(NOW_MS - minutesAgo * 60_000).toISOString(), href,
});
const TIMELINE = [
  timelineItem('command', 'error', 'df -h FAILED', 4, '/commands?commandId=cmd-1', 'node-1'),
  timelineItem('deploy', 'info', 'role-apply COMPLETED', 18, '/governor/operations'),
  timelineItem('hermes', 'info', 'profile-sync COMPLETED', 25, '/orchestra/installations', 'node-2'),
  timelineItem('log', 'warn', 'Disk usage above 85% on /var', 40, '/logs', 'node-3'),
  timelineItem('audit', 'info', 'node.update', 65, '/audit'),
  timelineItem('notification', 'warning', 'Agent upgrade blocked on node-3', 90, '/notifications', 'node-3'),
  timelineItem('command', 'info', 'uptime COMPLETED', 120, '/commands?commandId=cmd-2', 'node-2'),
];
const retentionTable = (name: string, count: number, oldestAt: string | null, policy: string, cutoffs?: Record<string, string>) => ({ name, count, oldestAt, policy, ...(cutoffs ? { cutoffs } : {}) });
const RETENTION = {
  generatedAt: T1,
  policyStatus: { status: 'pass', message: 'Retention jobs are configured for every table with an automatic policy.' },
  tables: [
    retentionTable('HealthSnapshot', 182_400, T0, '24h full; 5m anomaly/extrema samples for 30d', { fullFidelityAfter: '2026-11-09T14:30:00.000Z', expiresBefore: '2026-10-11T14:30:00.000Z' }),
    retentionTable('LogEntry', 48_210, T0, '30 days'),
    retentionTable('Notification', 312, T0, 'read 14d; maximum 90d', { readBefore: '2026-10-27T14:30:00.000Z', expiresBefore: '2026-08-12T14:30:00.000Z' }),
    retentionTable('RemoteCommand', 1_204, null, 'manual review'),
    retentionTable('DeployJob', 87, null, 'manual review'),
  ],
};
const upgradeCandidate = (nodeId: string, version: string, eligible: boolean, code: string | null, reason: string | null) => ({
  nodeId, name: nodeId, version, eligible, reason, code, upgrade: null, layout: 'versioned', managed: true, preflight: null,
});
const UPGRADE_ELIGIBILITY = {
  version: '2.0.1', serverVersion: '2.0.1', upgradesEnabled: true, disabledReason: null, prerelease: false,
  release: { verified: true, integrity: 'sha512-example', reason: null },
  nodes: [
    upgradeCandidate('node-1', '2.0.0', true, null, null),
    upgradeCandidate('node-2', '2.0.0', true, null, null),
    upgradeCandidate('node-3', '1.4.2', false, 'MAJOR_VERSION', 'Agent 1.4.2 is on another major version; upgrade it by hand'),
  ],
  latestRun: {
    id: 'run-1', version: '2.0.0', integrity: 'sha512-example', actorId: 'usr_admin', status: 'succeeded', startedAt: T0, finishedAt: T0, concurrency: 1, message: null,
    canaryNodeId: 'node-1',
    nodes: [
      { nodeId: 'node-1', name: 'node-1', from: '1.9.0', state: 'confirmed', requestId: 'req-1', detail: null },
      { nodeId: 'node-2', name: 'node-2', from: '1.9.0', state: 'confirmed', requestId: 'req-2', detail: null },
    ],
  },
};

// Magnus 3.0.2's targets for a fleet still on 2.10.x: within the major, and with allowMajor, where a 2.10.3
// agent with a node key is eligible and the others say what they need first.
export const UPGRADE_ELIGIBILITY_V3 = {
  ...UPGRADE_ELIGIBILITY, version: '3.0.2', serverVersion: '3.0.2', latestRun: null,
  nodes: [
    upgradeCandidate('node-1', '2.10.3', false, 'MAJOR_VERSION', '2.10.3 -> 3.0.2 crosses a major version; pass --allow-major (allowMajor) to authorize it, or upgrade this node by hand'),
    upgradeCandidate('node-2', '2.10.2', false, 'MAJOR_VERSION', '2.10.2 -> 3.0.2 crosses a major version; pass --allow-major (allowMajor) to authorize it, or upgrade this node by hand'),
    upgradeCandidate('node-3', '3.0.1', true, null, null),
  ],
};
const UPGRADE_ELIGIBILITY_V3_MAJOR = {
  ...UPGRADE_ELIGIBILITY_V3,
  nodes: [
    upgradeCandidate('node-1', '2.10.3', true, null, null),
    upgradeCandidate('node-2', '2.10.2', false, 'MAJOR_NEEDS_STEPPING_STONE', 'magnus-agent 2.10.2 cannot verify a major-upgrade authorization; upgrade it to 2.10.3 first'),
    upgradeCandidate('node-3', '3.0.1', true, null, null),
  ],
};

// Per-node credentials (Magnus 2.10): one node with its own key, one waiting for an administrator to
// approve the binding its agent asked for from another address, one with a revoked key.
const nodeCredential = (state: string, extra: Record<string, unknown> = {}) => ({
  state, origin: state === 'none' ? null : 'LEGACY_UPGRADE', boundAt: state === 'none' ? null : T0, lastUsedAt: state === 'none' ? null : T1,
  keyFingerprint: state === 'none' ? null : '9999999988888888', evidenceSigning: state === 'active',
  legacyUse: { request: null, evidence: null, outbound: null, lastUsedAt: null }, ...extra,
});
/** Served by the node credentials test only: the setup checklist reads the same list and expects no node. */
export const CREDENTIAL_NODES = [
  { ...AGENT_NODE, health: null, agent: { ...AGENT_NODE.agent, version: '2.10.0' }, nodeCredential: nodeCredential('active') },
  { ...AGENT_NODE, health: null, id: 'node-2', name: 'node-2', hostname: 'node-2.example.internal', ipAddress: '192.0.2.12', nodeCredential: nodeCredential('none', { legacyUse: { request: { count: 12, lastUsedAt: T1 }, evidence: null, outbound: { count: 3, lastUsedAt: T1 }, lastUsedAt: T1 } }) },
  { ...AGENT_NODE, health: null, id: 'node-3', name: 'node-3', hostname: 'node-3.example.internal', ipAddress: '192.0.2.13', nodeCredential: nodeCredential('revoked') },
];
const NODE_CREDENTIAL_SUMMARY = {
  mode: 'warn', serverKey: { keyId: 'e'.repeat(64), keyFingerprint: 'eeeeeeeeeeeeeeee' }, legacyUpgrade: { open: true, until: '2026-12-01T09:00:00.000Z' },
  nodes: { total: 3, active: 1, none: 1, revoked: 1, evidenceSigning: 1 }, pendingBindings: 1,
  legacyUse: { windowHours: 24, nodes: 1, request: 12, evidence: 0, outbound: 3, lastUsedAt: T1, unattributedSinceStart: 0 },
  enforceReady: false,
  blockers: [
    { code: 'NODES_WITHOUT_KEY', count: 1, nodes: [{ id: 'node-2', name: 'node-2' }] },
    { code: 'NODES_REVOKED', count: 1, nodes: [{ id: 'node-3', name: 'node-3' }] },
    { code: 'PENDING_BINDINGS', count: 1, nodes: [{ id: 'node-2', name: 'node-2' }] },
  ],
  generatedAt: T1,
};
/**
 * The same fleet on Magnus 3.0.0 with an explicit, deprecated NODE_AUTH_MODE=warn, a server key being
 * rotated and an agent enforce mode cannot reach. Served by the deprecation test only.
 */
export const NODE_CREDENTIAL_SUMMARY_V3 = {
  ...NODE_CREDENTIAL_SUMMARY,
  modeExplicit: true,
  modeDeprecated: true,
  deprecationNotice: 'NODE_AUTH_MODE=warn is deprecated: the shared node secret is removed in the next major release. Clear the blockers, then remove NODE_AUTH_MODE so the server runs in enforce mode.',
  serverKeyRotation: {
    active: { keyId: 'e'.repeat(64), keyFingerprint: 'eeeeeeeeeeeeeeee', createdAt: T0 },
    next: { keyId: '6'.repeat(64), keyFingerprint: '6666666666666666', createdAt: T1 },
    previous: null,
    retired: [],
    agents: { keyedNodes: 1, reporting: 1, pinningActive: 1, pinningNext: 0 },
  },
  blockers: [...NODE_CREDENTIAL_SUMMARY.blockers, { code: 'AGENTS_NEED_UPGRADE', count: 1, nodes: [{ id: 'node-1', name: 'node-1' }] }],
};
/** Every key of node-1, for an administrator on a Magnus that offers key administration to the browser. */
const nodeKey = (n: string, status: string, origin: string, extra: Record<string, unknown> = {}) => ({
  keyId: n.repeat(64), keyFingerprint: n.repeat(16), status, origin, boundFqdn: 'node-1.example.internal', evidenceSigning: status === 'ACTIVE', evidenceSigningAt: status === 'ACTIVE' ? T1 : null,
  createdAt: T0, lastUsedAt: status === 'REVOKED' ? null : T1, retireAt: null, revokedAt: status === 'REVOKED' ? T1 : null, revokedBy: status === 'REVOKED' ? 'usr_admin' : null, ...extra,
});
const NODE_KEYS = [nodeKey('9', 'ACTIVE', 'LEGACY_UPGRADE', { keyFingerprint: '9999999988888888' }), nodeKey('7', 'REVOKED', 'ENROLLMENT_TOKEN')];
const PENDING_BINDING = {
  id: 'pb-1', nodeId: 'node-2', nodeName: 'node-2', keyId: 'd'.repeat(64), keyFingerprint: 'dddddddddddddddd', fqdn: 'node-2.example.internal',
  peerAddress: '198.51.100.7', recordedAddress: '192.0.2.12', status: 'PENDING', attempts: 4, createdAt: T1, lastSeenAt: T1,
  decidedAt: null, decidedBy: null, decisionReason: null,
};

// The inbox: the Hive Registry announces three feeds (events.v1); HiveSkills's feed fails, so the
// "couldn't reach" row shows beside the others' events.
const registryProduct = (id: string, displayName: string) => ({
  id, displayName, description: `${displayName} for the example installation.`,
  links: { repository: null, documentation: null, license: null, licenseSpdx: null },
  consoleSection: id, required: false, installed: true, dependencies: [],
});
// The installation record, with a setup checklist: three probes HiveXUI runs (no Magnus node has an
// agent; the legacy runtime has no Oathweave clients to look for; alice is an administrator besides
// the oldest account), settled items, and an item from a newer controller shown generically.
const setupItem = (id: string, title: string, status: string, command: string, docs: string, extra: Record<string, string> = {}) => ({ id, title, status, command, docs, ...extra });
const INSTALLATION = {
  schema: 1,
  id: 'example-lab',
  products: ['hive-registry', ...Object.keys(PRODUCTS)],
  setup: {
    updatedAt: T1,
    items: [
      setupItem('magnus-agent-enrolled', 'Install the Magnus agent on the Magnus host', 'pending', './hive.sh magnus-agent install', 'deployment/FULL.md#installing-the-agent', { product: 'magnus', check: 'magnus.agent' }),
      setupItem('oathweave-console-clients', 'Add the HiveXUI browser clients to Oathweave', 'pending', './hive.sh console-clients add', 'deployment/QUICKSTART.md#8-upgrade', { product: 'oathweave', check: 'oathweave.console-client' }),
      setupItem('ardent-packages-updated', 'Update the Ardent packages in HiveXUI (Magnus > Ardent > Installations)', 'done', './hive.sh setup done ardent-packages-updated', 'deployment/QUICKSTART.md#8-upgrade', { product: 'magnus' }),
      setupItem('certificate-renewal', 'Schedule the HTTPS certificate renewal', 'skipped', 'sudo ./scripts/console-certificate.sh schedule --config FILE', 'deployment/QUICKSTART.md#9-keep-the-certificate-current', { product: 'ingress' }),
      setupItem('first-admin', 'Create your own administrator account and stop using the initial operator', 'pending', './hive.sh setup done first-admin', 'deployment/QUICKSTART.md#6-sign-in', { product: 'oathweave', check: 'iam.first-admin' }),
      setupItem('some-future-step', 'A step from a newer controller', 'pending', './hive.sh setup done some-future-step', 'deployment/FULL.md#setup-checklist', { check: 'future.probe' }),
    ],
  },
};
// Feed paths as the Registry announces them, relative to each browser prefix after the ingress mapping.
const FEEDS: Record<string, [string, string]> = {
  magnus: ['Magnus', '/hive/events'],
  cindertrace: ['Cindertrace', '/hive/events'],
  embermend: ['Embermend', '/api/v1/hive/events'],
  hiveskills: ['HiveSkills', '/v1/hive/events'],
};
const hiveEvent = (product: string, id: string, type: string, severity: string, title: string, summary: string, minutesAgo: number, path: string, sourceRef?: string) => ({
  id: `${product}:${id}`, product, type, severity, title, summary, occurredAt: new Date(NOW_MS - minutesAgo * 60_000).toISOString(),
  link: { product, path }, ...(sourceRef ? { sourceRef } : {}),
});
const EVENTS = {
  magnus: [
    hiveEvent('magnus', 'notification:ntf-1', 'node.offline', 'critical', 'node-3 went offline', 'No heartbeat for 5 minutes.', 12, '/fleet/nodes/node-3', 'ntf-1'),
    hiveEvent('magnus', 'notification:ntf-2', 'agent.upgrade.blocked', 'warning', 'Agent upgrade blocked on node-3', 'Agent 1.4.2 is on another major version.', 90, '/fleet/ardent/profiles/node-1~lead', 'ntf-2'),
    hiveEvent('magnus', 'notification:ntf-3', 'deployment.completed', 'info', 'Role apply completed', 'role-apply finished on 3 nodes.', 300, '/fleet/notifications', 'ntf-3'),
  ],
  cindertrace: [
    hiveEvent('cindertrace', 'case:case-1:opened', 'case.opened', 'warning', 'Case opened: repeated sign-in failures', 'Five failed sign-ins for bob from one address.', 35, '/security-fusion/cases/case-1', 'case-1'),
  ],
  embermend: [
    hiveEvent('embermend', 'recommendation:plan-1:created', 'recommendation.created', 'info', 'New recommendation: protect configuration files', 'Reduce file access on node-2.', 140, '/?page=embermend&plan=plan-1', 'plan-1'),
    // A link the route table does not know shows as text.
    hiveEvent('embermend', 'recommendation:plan-2:expired', 'recommendation.expired', 'info', 'Recommendation expired', 'The plan passed its expiry before a decision.', 600, '/embermend/legacy/plan-2', 'plan-2'),
  ],
};

export const ROUTES: Array<[string, RegExp, Answer]> = [
  // Emberpath
  ['GET', /^\/api\/emberpath\/auth\/me$/, { user: ADMIN }],
  ['GET', /^\/api\/emberpath\/providers$/, { data: PROVIDERS }],
  ['GET', /^\/api\/emberpath\/providers\/codex-oauth\/status$/, { data: { authorized: false, provider: null } }],
  ['GET', /^\/api\/emberpath\/model-aliases$/, { data: ALIASES }],
  ['GET', /^\/api\/emberpath\/route-rules$/, { data: ROUTE_RULES }],
  ['GET', /^\/api\/emberpath\/heuristics$/, { data: HEURISTICS }],
  ['GET', /^\/api\/emberpath\/client-keys$/, { data: CLIENT_KEYS }],
  ['GET', /^\/api\/emberpath\/telemetry$/, { totals: { traces: 1284, failures: 37, failovers: 9 }, latestTrace: TRACES[0] }],
  ['GET', /^\/api\/emberpath\/traces$/, { data: TRACES }],
  ['GET', /^\/api\/emberpath\/audit$/, { data: AUDIT }],
  ['GET', /^\/api\/emberpath\/runtime-settings$/, { data: [] }],
  ['GET', /^\/api\/emberpath\/docs\/index$/, { docs: [], providers: PROVIDERS.map((p) => ({ ...summary(p), baseUrl: p.baseUrl, enabled: p.enabled })) }],
  ['GET', /^\/api\/emberpath\/routing\/objective$/, { data: { config: { goal: 'balanced' } } }],
  ['GET', /^\/api\/emberpath\/hive\/status$/, { generatedAt: T1, uiUrl: 'https://hive.example.com', apps: HIVE_APPS }],
  ['GET', /^\/api\/emberpath\/hive\/actors$/, { data: [] }],
  ['GET', /^\/api\/emberpath\/hive\/incidents$/, { data: [] }],
  // Oathweave: the resource principal its pages check before they load
  ['GET', /^\/api\/iam\/auth\/me$/, { user: { id: ADMIN.id, username: ADMIN.username, displayName: ADMIN.displayName, roles: ADMIN.roles, permissions: ADMIN.permissions } }],
  ['GET', /^\/api\/iam\/health(\/live)?$/, { status: 'ok' }],
  ['GET', /^\/api\/iam\/users(\?.*)?$/, { users: IAM_USERS, total: IAM_USERS.length, page: 1, limit: 100 }],
  ['GET', /^\/api\/iam\/roles$/, { roles: IAM_ROLES }],
  // ChatterMost (native Mattermost-compatible API under /api/chat/api/v4, admin under /api/chat/admin)
  ['GET', /^\/api\/chat\/api\/v4\/users\/me$/, CHAT_ME],
  ['GET', /^\/api\/chat\/api\/v4\/users\/me\/teams$/, []],
  ['GET', /^\/api\/chat\/api\/v4\/users\/me\/channels$/, []],
  ['GET', /^\/api\/chat\/api\/v4\/users\/[^/]+\/image(\?.*)?$/, { __raw: PNG_1PX, contentType: 'image/png' }],
  ['GET', /^\/api\/chat\/api\/v4\/emoji(\?.*)?$/, []],
  ['GET', /^\/api\/chat\/api\/v4\/commands(\?.*)?$/, []],
  ['POST', /^\/api\/chat\/api\/v4\/users\/search$/, CHAT_USERS],
  ['GET', /^\/api\/chat\/admin\/users$/, CHAT_USERS.map(adminChatUser)],
  ['GET', /^\/api\/chat\/admin\/invites$/, [{ id: 'inv_1', code_preview: 'ABCD…', max_uses: 5, uses: 1, expires_at: NOW_MS + 7 * 86400_000, role: 'system_user', team_ids: [], channel_ids: [], disabled_at: 0 }]],
  ['GET', /^\/api\/chat\/admin\/browser-capabilities$/, { schema: 1, bot_operation_ids: 'caller-bound-v1' }],
  // HiveSkills
  ['GET', /^\/api\/skills\/v1\/skills$/, SKILLS],
  ['GET', /^\/api\/skills\/auth\/me$/, { username: 'admin', isAdmin: true }],
  ['GET', /^\/api\/skills\/admin\/skills$/, SKILLS],
  ['GET', /^\/api\/skills\/admin\/channels$/, [{ channel: 'stable', skill_slug: 'summarize', version: '1.2.0' }]],
  ['GET', /^\/api\/skills\/admin\/targets$/, [{ name: 'target-a', host: 'target-a.example.internal', username: 'deploy', enabled: true }]],
  ['GET', /^\/api\/skills\/admin\/receipts$/, []],
  ['GET', /^\/api\/skills\/admin\/deployments$/, []],
  ['GET', /^\/api\/skills\/admin\/deployments\/capabilities$/, { enabled: false, executor: 'magnus', message: 'Managed deployment is not configured.' }],
  ['GET', /^\/api\/skills\/admin\/audit(\?.*)?$/, [{ id: 1, actor: 'admin', action: 'skill.create', subject: 'summarize', details: '{}', created_at: T1 }]],
  ['GET', /^\/api\/skills\/admin\/skills\/[^/]+\/releases$/, () => [{ skillSlug: 'summarize', version: '1.2.0', sha256: 'a'.repeat(64), notes: 'Initial release', minHermesVersion: null, maxHermesVersion: null, createdAt: T1 }]],
  // HiveMem
  ['GET', /^\/api\/memory\/profile$/, PROFILE],
  ['GET', /^\/api\/memory\/workspaces\?.*$/, WORKSPACES],
  // Magnus
  ['GET', /^\/api\/magnus\/console\/session$/, magnusOk(MAGNUS_SESSION)],
  ['GET', /^\/api\/magnus\/notifications\/unread-count$/, magnusOk({ count: 2 })],
  ['GET', /^\/api\/magnus\/ops\/timeline\?limit=120$/, magnusOk(TIMELINE)],
  ['GET', /^\/api\/magnus\/ops\/retention$/, magnusOk(RETENTION)],
  ['GET', /^\/api\/magnus\/nodes\?page=1&pageSize=\d+&query=/, { success: true, data: [{ ...AGENT_NODE, health: null }], meta: { total: 1, page: 1, pageSize: 6, hasMore: false } }],
  ['GET', /^\/api\/magnus\/orchestra\/installations$/, magnusOk([HERMES_INSTALLATION])],
  ['GET', /^\/api\/magnus\/orchestra\/profiles$/, magnusOk(HERMES_PROFILES)],
  ['POST', /^\/api\/memory\/memories\/search\?workspace_id=\*$/, (_match: RegExpMatchArray, _url: URL, request: Request) => memorySearch(request)],
  ['GET', /^\/api\/magnus\/nodes\?page=1&pageSize=\d+$/, { success: true, data: [], meta: { total: 0, page: 1, pageSize: 100, hasMore: false } }],
  ['GET', /^\/api\/magnus\/node-credentials\/summary$/, magnusOk(NODE_CREDENTIAL_SUMMARY)],
  ['GET', /^\/api\/magnus\/node-credentials\/pending-bindings\?status=PENDING$/, magnusOk([PENDING_BINDING])],
  ['GET', /^\/api\/magnus\/nodes\/system-updates\/summary$/, magnusOk({ total: 0, reporting: 0, enabled: 0, actionNeeded: 0, rebootRequired: 0, nodes: [] })],
  ['GET', /^\/api\/magnus\/nodes\/tailscale\/summary$/, magnusOk({ total: 0, reporting: 0, expiryEnabled: 0, expiringSoon: 0, expired: 0, warningDays: 14, nodes: [] })],
  ['GET', /^\/api\/magnus\/agents\/upgrade\/eligibility$/, magnusOk(UPGRADE_ELIGIBILITY)],
  ['GET', /^\/api\/magnus\/agents\/upgrade\/eligibility\?allowMajor=true$/, magnusOk(UPGRADE_ELIGIBILITY_V3_MAJOR)],
  ['GET', /^\/api\/magnus\/agents\/node-1~lead\/identity$/, magnusOk(AGENT_IDENTITY)],
  ['GET', /^\/api\/magnus\/nodes\/node-1$/, magnusOk(AGENT_NODE)],
  ['GET', /^\/api\/magnus\/nodes\/node-1\/credentials$/, magnusOk(NODE_KEYS)],
  ['GET', /^\/api\/magnus\/ardent\/installations\/node-1$/, magnusOk(ARDENT_INSTALLATION)],
  ['GET', /^\/api\/magnus\/ardent\/installations$/, magnusOk([ARDENT_INSTALLATION])],
  ['GET', /^\/api\/magnus\/ardent\/dependencies$/, magnusOk([
    { name: 'hivemem', status: 'usable', source: 'override', endpoint: 'https://memory.example.internal', capabilities: [] },
    { name: 'hiveskills', status: 'awaiting_configuration', source: 'registry', endpoint: 'https://skills.example.internal', capabilities: ['skills.pinned-release.v1'], reason: 'Magnus has no HiveSkills target credential yet' },
    { name: 'emberpath', status: 'unsupported', source: 'registry', endpoint: 'https://models.example.internal', capabilities: [], reason: 'Emberpath lacks emberpath.execution-trace.v1' },
  ])],
  ['GET', /^\/api\/magnus\/ardent\/installations\/node-1\/profiles\/lead\/tasks$/, magnusOk({ tasks: [
    { id: '0b6f7a52-5a4e-4a43-8f3f-1d2a3b4c5d6e', state: 'unknown', prompt: 'Publish the weekly digest', created_ms: NOW_MS - 3600_000,
      execution: { v: 1, root: 'hx1:studio:inst-1:request:msg-1', parent: 'hx1:studio:inst-1:task:tsk-1', self: 'hx1:ardent:node-1.lead:task:0b6f7a52-5a4e-4a43-8f3f-1d2a3b4c5d6e' },
      recovery: { status: 'awaiting_decision', reason: { code: 'UNSETTLED_EXTERNAL_WRITE', message: 'A tool call with a possible external effect was dispatched but its outcome was not recorded. Confirm whether it applied.' }, attempt: 1, actions: ['mark_applied', 'mark_not_applied', 'abandon'] } },
    { id: '1c7a8b63-6b5f-4b54-9a4b-2e3b4c5d6e7f', state: 'running', prompt: 'Summarize the incident notes', created_ms: NOW_MS - 600_000,
      recovery: { status: 'ready', reason: { code: 'RESUME_FROM_CHECKPOINT', message: 'Every interrupted tool call is settled, a read or idempotent; the task resumes at its next step.' }, attempt: 1, actions: [] } },
    { id: '2d8b9c74-7c6a-4c65-8b5c-3f4c5d6e7f80', state: 'completed', prompt: 'Draft the release notes', created_ms: NOW_MS - 86_400_000 },
  ] })],
  ['GET', /^\/api\/magnus\/ardent\/installations\/node-1\/profiles\/lead\/skills$/, magnusOk({ skills: [
    { name: 'summarize', description: 'Condense long documents.', hash: 'a'.repeat(12), enabled: true },
    { name: 'translate', description: 'Translate text between languages.', hash: 'b'.repeat(12), enabled: false },
  ] })],
  // Agent 360's filtered reads. Each product refuses a malformed filter, which is how the page knows
  // the release honours it.
  ['GET', /^\/api\/memory\/memories\/browse\?agent_id=ardent-lead&/, { limit: 25, memories: AGENT_MEMORIES, next_cursor: null, offset: 0, results: AGENT_MEMORIES, total: AGENT_MEMORIES.length }],
  ['GET', /^\/api\/memory\/stats\?agent_id=ardent-lead$/, { agents: 1, conclusions: 4, episodes: 12, memories: 128, messages: 340, queue_jobs: 0, sessions: 9, webhook_deliveries: 0, webhooks: 0, workspaces: 2 }],
  ['GET', /^\/api\/ardentstudio\/v1\/projects\?status=all&agentRef=node-1(?:~|%7E)lead$/, { projects: AGENT_PROJECTS }],
  ['GET', /^\/api\/ardentstudio\/v1\/projects\?status=all&agentRef=not-an-agent-ref$/, refused({ error: { code: 'VALIDATION_ERROR', message: 'Invalid agentRef' } })],
  ['GET', /^\/api\/security\/security-fusion\/cases\?entityType=agent&entity=actor%3Aardent-lead$/, fusion(AGENT_CASES)],
  ['GET', /^\/api\/security\/security-fusion\/cases\?entityType=agent&entity=not-an-agent$/, refused({ success: false, error: { code: 'INVALID_ENTITY_FILTER', message: 'Invalid filter' } })],
  ['GET', /^\/api\/emberpath\/traces\?actorId=ardent-lead&limit=50$/, { data: AGENT_TRACES, nextCursor: null }],
  ['GET', /^\/api\/skills\/admin\/targets\?nodeId=node-1$/, AGENT_TARGETS],
  ['GET', /^\/api\/skills\/admin\/targets\?nodeId=%21$/, refused({ error: 'Invalid target filter' })],
  // Hive Registry and the inbox's feeds
  ['GET', /^\/api\/registry\/v1\/installation$/, INSTALLATION],
  ['GET', /^\/api\/registry\/v1\/products\?installed=true$/, { schema: 1, products: Object.keys(PRODUCTS).map((id) => registryProduct(id, FEEDS[id]?.[0] ?? id)) }],
  ['GET', /^\/api\/registry\/v1\/products\/([a-z]+)\/connection$/, (match: RegExpMatchArray) => ({
    id: match[1], consolePath: null, browserPrefix: `/api/${match[1]}`, nativeApis: {}, documentation: null,
    capabilities: FEEDS[match[1]!] ? { 'events.v1': { path: FEEDS[match[1]!]![1] }, 'future.v9': { anything: true } } : {},
  })],
  ['GET', /^\/api\/magnus\/hive\/events\?limit=200$/, { data: EVENTS.magnus, nextCursor: null }],
  ['GET', /^\/api\/security\/hive\/events\?limit=200$/, { data: [...EVENTS.cindertrace, { id: 'broken' }], nextCursor: null }],
  ['GET', /^\/api\/embermend\/api\/v1\/hive\/events\?limit=200$/, { data: EVENTS.embermend, nextCursor: null }],
  ['GET', /^\/api\/skills\/v1\/hive\/events\?limit=200$/, { __status: 503, body: { error: { code: 'unavailable', message: 'unavailable' } } }],
  ['GET', /^\/api\/magnus\/notifications\?pageSize=100$/, magnusOk({ notifications: [
    { id: 'ntf-1', type: 'node', severity: 'critical', title: 'node-3 went offline', message: '', nodeName: 'node-3', isRead: false, createdAt: T1 },
    { id: 'ntf-3', type: 'deploy', severity: 'info', title: 'Role apply completed', message: '', nodeName: null, isRead: true, createdAt: T1 },
  ], total: 2 })],
  // Cindertrace
  ['GET', /^\/api\/security\/security-fusion\/overview$/, fusion({ generatedAt: T1, openCases: FUSION_CASES, sources: FUSION_SOURCES, bySeverity: [{ severity: 'high', _count: { id: 1 } }, { severity: 'medium', _count: { id: 1 } }, { severity: 'low', _count: { id: 1 } }] })],
  ['GET', /^\/api\/security\/security-fusion\/lab$/, fusion({ enabled: false, canAdmin: true, runs: [] })],
  ['GET', /^\/api\/security\/security-fusion\/cases$/, fusion(FUSION_CASES)],
  ['GET', /^\/api\/security\/security-fusion\/cases\/case-1$/, fusion({
    case: FUSION_CASES[0], events: FUSION_EVENTS.slice(0, 1), entities: FUSION_ENTITIES, evidence: FUSION_EVIDENCE,
    investigations: [], actions: [], labRunId: null, responseAvailable: false, canApprove: false, approvalMode: 'console',
  })],
  ['GET', /^\/api\/security\/security-fusion\/events\?limit=100$/, fusion(FUSION_EVENTS)],
  ['GET', /^\/api\/security\/security-fusion\/entities$/, fusion(FUSION_ENTITIES)],
  ['GET', /^\/api\/security\/security-fusion\/sources$/, fusion(FUSION_SOURCES)],
  ['GET', /^\/api\/security\/security-fusion\/source-registry$/, fusion([])],
  ['GET', /^\/api\/security\/security-fusion\/evidence$/, fusion(FUSION_EVIDENCE)],
  ['GET', /^\/api\/security\/security-fusion\/policies$/, fusion({
    eventRetentionDays: 90, preservedEvidenceDays: 365, caseArchiveDays: 365, archiveGraceDays: 30, deletionReceiptDays: 2555,
    perCaseCeilings: { events: 1000, entities: 250, relationships: 50, preservedEvidence: 100, preservedEvidenceBytes: 8388608 },
    approvalTtlMinutes: 10, allowedActions: ['service restart', 'host isolation'], deniedActions: ['credential rotation'],
    isolation: { defaultMinutes: 15, maximumMinutes: 30, defaultPolicy: 'deny' },
  })],
  ['GET', /^\/api\/security\/security-fusion\/audit\?.*$/, fusion({
    verification: { state: 'verified', legacyEntries: 0, totalEntries: 2 },
    events: [
      { id: 'sa-1', timestamp: T1, action: 'case.investigation.save', actorId: 'alice', targetId: 'case-1', verificationState: 'verified' },
      { id: 'sa-2', timestamp: T0, action: 'evidence.preserve', actorId: 'alice', targetId: 'evd-1', verificationState: 'verified' },
    ],
    total: 2,
  })],
];


// Chat: one team with a channel holding two posts, for the conversation view.
const CHAT_TEAM = { id: 'team00000000000000000000001', create_at: NOW_MS - 86400_000, update_at: NOW_MS - 86400_000, delete_at: 0, name: 'ops', display_name: 'Operations', description: '', type: 'O', company_name: '', allowed_domains: '', invite_id: '', allow_open_invite: false, scheme_id: null, group_constrained: false };
const CHAT_CHANNEL = { id: 'chan00000000000000000000001', create_at: NOW_MS - 86400_000, update_at: NOW_MS - 3600_000, delete_at: 0, team_id: CHAT_TEAM.id, type: 'O', display_name: 'Town square', name: 'town-square', header: '', purpose: 'Everyday coordination', last_post_at: NOW_MS - 600_000, total_msg_count: 2, extra_update_at: 0, creator_id: CHAT_ME.id };
const chatPost = (n: number, user: string, message: string, minutesAgo: number) => ({
  id: `post0000000000000000000000${n}`, create_at: NOW_MS - minutesAgo * 60_000, update_at: NOW_MS - minutesAgo * 60_000, edit_at: 0, delete_at: 0, is_pinned: false,
  user_id: user, channel_id: CHAT_CHANNEL.id, root_id: '', original_id: '', message, type: '', props: {}, hashtags: '', file_ids: [], pending_post_id: '', reply_count: 0, last_reply_at: 0, participants: [], metadata: {},
});
const CHAT_POSTS = { order: ['post00000000000000000000002', 'post00000000000000000000001'], posts: Object.fromEntries([chatPost(1, CHAT_USERS[1]!.id, 'Maintenance window starts at 18:00.', 30), chatPost(2, CHAT_ME.id, 'Thanks, node-2 is drained.', 10)].map((post) => [post.id, post])), next_post_id: '', prev_post_id: '' };
// Embermend: an operator with a finding, accepted risk and a profile assignment, and no recommendation yet.
const EMBERMEND_SCOPE = { installationId: 'installation-1', applicationIds: ['app-1'], targetIds: ['node-1'] };
const EMBERMEND_FINDING = { finding: { id: 'finding-1', scope: EMBERMEND_SCOPE, kind: 'hardening', identity: 'b'.repeat(64), component: 'sshd', weakness: 'password-auth', title: 'SSH allows password sign-in', severity: 'high', confidence: 0.9, validity: 'validated', rationale: 'The daemon accepts passwords.', evidenceIds: [], classifications: [], priority: 70 }, occurrences: [] };
// Ardent Project Studio: one project with a team, a conversation and a message, and one Ardent agent.
const STUDIO_READY = { status: 'ready', checks: { database: { status: 'ok', error: null }, magnus: { status: 'ok', error: null }, hivemem: { status: 'ok', error: null }, agents: { status: 'ok', available: 1 } } };
const STUDIO_PROFILE = { id: 'lead', name: 'Lead', backend: 'llamacpp', apiPort: 9910, running: true, a2aEnabled: false, channels: {}, error: null, nodeId: 'node-1', nodeName: 'node one', hostname: 'node-1.example.com', installationVersion: '2.2.0', reachable: true };
const STUDIO_BASE = '\\/api\\/ardentstudio\\/v1';
const studioRoute = (method: string, path: string, answer: Answer): [string, RegExp, Answer] => [method, new RegExp(`^${STUDIO_BASE}${path}$`), answer];
const MOCK_ROUTES: Array<[string, RegExp, Answer]> = [
  studioRoute('GET', '\\/health\\/ready', STUDIO_READY),
  ['GET', /^\/api\/magnus\/ardent\/profiles$/, { success: true, data: [STUDIO_PROFILE] }],
  studioRoute('GET', '\\/projects(\\?.*)?', { projects: [studio.summary(), studio.summary({ id: studio.OTHER_PROJECT_ID, name: 'Market scan' })] }),
  studioRoute('GET', `\\/projects\\/${studio.PROJECT_ID}`, studio.project()),
  studioRoute('GET', `\\/projects\\/${studio.PROJECT_ID}\\/snapshot`, studio.snapshot({ conversations: [studio.conversation()], summary: studio.summary({ access: { mode: 'members', role: 'owner' } } as never) })),
  studioRoute('GET', `\\/conversations\\/[^/]+\\/messages(\\?.*)?`, { messages: [studio.message()] }),
  studioRoute('GET', '\\/agents(\\?.*)?', { agents: [studio.agent()] }),
  studioRoute('GET', '\\/templates(\\?.*)?', { templates: [studio.templateSummary()] }),
  studioRoute('GET', `\\/projects\\/${studio.PROJECT_ID}\\/deliverables`, { deliverables: [], imports: [] }),
  studioRoute('GET', `\\/projects\\/${studio.PROJECT_ID}\\/tasks(\\?.*)?`, { tasks: [studio.task()] }),
  studioRoute('GET', `\\/projects\\/${studio.PROJECT_ID}\\/workflow-runs(\\?.*)?`, { runs: [] }),
  studioRoute('GET', `\\/projects\\/${studio.PROJECT_ID}\\/team\\/proposals`, { proposals: [] }),
  studioRoute('POST', `\\/projects\\/${studio.PROJECT_ID}\\/team\\/validate`, { issues: [], can_publish: true, can_start_room: true, agent_facts: 'complete' }),
  studioRoute('GET', `\\/projects\\/${studio.PROJECT_ID}\\/members`, { project_id: studio.PROJECT_ID, mode: 'members', revision: 2, access: { mode: 'members', role: 'owner' }, members: [
    { kind: 'subject', subject: 'alice-sub', issuer: 'https://identity.example.com', role: 'owner', user_id: 'usr_alice', display_name: 'Alice Example', added_by: 'admin', added_at: T0 },
    { kind: 'oathweave_role', name: 'analysts', role: 'viewer', added_by: 'admin', added_at: T0 },
  ] }),
  studioRoute('GET', '\\/people(\\?.*)?', { people: [{ user_id: 'usr_bob', subject: 'bob-sub', issuer: 'https://identity.example.com', display_name: 'Bob Example' }], truncated: false }),
  studioRoute('GET', '\\/agents\\/[^/]+\\/presentation', { agent_ref: 'node-1~lead', display_name: 'Lead', portrait: null, avatar_file_id: null, updated_by: null, updated_at: null }),
  ['GET', /^\/api\/chat\/api\/v4\/users\/me\/teams$/, [CHAT_TEAM]],
  ['GET', /^\/api\/chat\/api\/v4\/users\/me\/teams\/[^/]+\/channels$/, [CHAT_CHANNEL]],
  ['GET', /^\/api\/chat\/api\/v4\/channels\/[^/]+\/posts(\?.*)?$/, CHAT_POSTS],
  ['GET', /^\/api\/chat\/api\/v4\/channels\/[^/]+\/pinned$/, { order: [], posts: {}, next_post_id: '', prev_post_id: '' }],
  ['GET', /^\/api\/chat\/api\/v4\/channels\/[^/]+\/members$/, []],
  ['GET', /^\/api\/chat\/api\/v4\/users\/[a-z0-9]+$/, (match: RegExpMatchArray) => CHAT_USERS.find((user) => match[0].endsWith(user.id)) ?? CHAT_ME],
  ['POST', /^\/api\/chat\/api\/v4\/users\/ids$/, CHAT_USERS],
  ['POST', /^\/api\/chat\/api\/v4\/channels\/members\/[^/]+\/view$/, { status: 'OK' }],
  ['GET', /^\/api\/iam\/auth\/mfa\/status$/, { enabled: true, totpConfigured: true, recoveryCodesRemaining: 8 }],
  ['GET', /^\/api\/iam\/mfa\/webauthn\/credentials$/, { data: [{ id: 'passkey-1', friendlyName: 'Desk key', deviceType: 'singleDevice', backedUp: false, credentialId: 'credential-1', lastUsedAt: null, createdAt: T0 }] }],
  ['GET', /^\/api\/embermend\/api\/v1\/recommendations$/, []],
  ['GET', /^\/api\/embermend\/api\/v1\/findings$/, [EMBERMEND_FINDING]],
  ['GET', /^\/api\/embermend\/api\/v1\/access$/, { actorId: 'admin', kind: 'operator', permissions: ['read', 'evidence', 'approve', 'execute', 'exception'], scope: EMBERMEND_SCOPE }],
  ['GET', /^\/api\/embermend\/api\/v1\/readiness$/, { status: 'degraded', serviceAvailable: true, assessmentReady: false, managedDispatch: false, eligibleTargets: 0, blockers: ['NO_FRESH_ENROLLED_ASSESSMENT_TARGET'], capabilities: null }],
  ['GET', /^\/api\/embermend\/api\/v1\/exceptions$/, [{ id: 'exception-1', scope: EMBERMEND_SCOPE, findingIds: ['finding-1'], owner: 'platform-team', rationale: 'Legacy jump host until it is retired.', compensatingControls: ['vpn-only'], expiresAt: '2027-01-31T23:59:59.000Z', status: 'active' }]],
  ['GET', /^\/api\/embermend\/api\/v1\/profile-assignments$/, [{ id: 'assignment-1', scope: EMBERMEND_SCOPE, profileId: 'ubuntu-baseline', profileVersion: '1.2.0', targetIds: ['node-1'], impact: 'Read-only checks', supersedes: null }]],
];

/** The browser clock tests freeze at, so relative times read the same on every run. */
export const FIXED_NOW = new Date(NOW_MS);

/** Serve the runtime and product APIs from fixtures. `log` collects requests that had no fixture. */
/** Oathweave's browser API as HiveXUI uses it: the session, authorization, code exchange and keys. */
const SIGNING = generateKeyPair('RS256', { extractable: true });
async function identity(page: Page, route: import('@playwright/test').Route, target: string, request: Request, signedOut: boolean): Promise<boolean> {
  const answer = async (status: number, json: unknown) => { await route.fulfill({ status, json }); return true; };
  if (target === '/api/iam/browser/session')
    return signedOut ? answer(401, { error: 'UNAUTHORIZED', message: 'Sign in to continue' }) : answer(200, { principal: { sub: ADMIN.id, username: ADMIN.username, roles: ADMIN.roles, permissions: ADMIN.permissions } });
  if (target === '/api/iam/oauth/jwks') return answer(200, { keys: [{ ...await exportJWK((await SIGNING).publicKey), kid: 'a11y', alg: 'RS256', use: 'sig' }] });
  if (target === '/api/iam/oauth/authorize' && request.method() === 'POST') {
    const body = request.postDataJSON() as { clientId: string; state: string; nonce: string };
    const code = Buffer.from(JSON.stringify({ client: body.clientId, nonce: body.nonce })).toString('base64url');
    return answer(200, { code, state: body.state, iss: ISSUER });
  }
  if (target === '/api/iam/oauth/token' && request.method() === 'POST') {
    const body = request.postDataJSON() as { code: string };
    const { client, nonce } = JSON.parse(Buffer.from(body.code, 'base64url').toString()) as { client: string; nonce: string };
    const access = `fixture-access-${client}`;
    const at_hash = createHash('sha256').update(access).digest().subarray(0, 16).toString('base64url');
    // Sign with the page's clock, which most tests freeze: the page checks the token's times.
    const now = Math.floor((await page.evaluate(() => Date.now())) / 1000);
    const id = await new SignJWT({ nonce, at_hash, auth_time: now }).setProtectedHeader({ alg: 'RS256', kid: 'a11y' })
      .setSubject(ADMIN.id).setIssuer(ISSUER).setAudience(client).setIssuedAt(now).setExpirationTime(now + 300).sign((await SIGNING).privateKey);
    return answer(200, { access_token: access, id_token: id, token_type: 'Bearer', expires_in: 900 });
  }
  return false;
}

export async function installMocks(page: Page, log: string[] = [], options: { signedOut?: boolean } = {}): Promise<string[]> {
  // Chat opens a websocket; accept it locally (never forwarded) so the page shows "Connected".
  await page.routeWebSocket(/\/api\/chat\/api\/v4\/websocket/, () => {});
  await page.route(/\/runtime\.json(\?.*)?$/, (route) => route.fulfill({ json: RUNTIME }));
  await page.route(/\/api\//, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const target = url.pathname + url.search;
    if (await identity(page, route, target, request, options.signedOut ?? false)) return;
    for (const [method, pattern, value] of [...MOCK_ROUTES, ...ROUTES]) {
      if (method !== request.method()) continue;
      const match = target.match(pattern);
      if (!match) continue;
      const body = typeof value === 'function' ? value(match, url, request) : value;
      const special = body as { __raw?: Buffer; contentType?: string; __status?: number; body?: unknown } | null;
      if (special?.__raw) return route.fulfill({ body: special.__raw, contentType: special.contentType ?? 'application/octet-stream' });
      if (special?.__status) return route.fulfill({ status: special.__status, json: special.body ?? {} });
      return route.fulfill({ json: body });
    }
    log.push(`UNMOCKED ${request.method()} ${target}`);
    return route.fulfill({ status: 404, json: { error: 'not mocked', message: 'not mocked' } });
  });
  return log;
}
