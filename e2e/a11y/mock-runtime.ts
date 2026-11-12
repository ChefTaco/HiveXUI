// A mocked HiveXUI runtime for browser tests that need no backends: a legacy runtime.json and
// made-up product API answers served through Playwright request interception. Every value is
// fictional (example.com hosts, alice, bob and carol). Unmocked API calls get a 404.
import type { Page, Request } from '@playwright/test';

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
const RUNTIME = {
  schema: 1,
  mode: 'legacy',
  products: {
    emberpath: '/api/emberpath',
    oathweave: '/api/iam',
    hivemem: '/api/memory',
    hiveskills: '/api/skills',
    chattermost: '/api/chat',
    cindertrace: '/api/security',
    embermend: '/api/embermend',
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
  provider('prv_a', 'router-a', 'Router A', 'OPENAI_GENERIC', 'https://router-a.example.com/v1', 'healthy', ['model-large', 'model-small']),
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

// ---------------------------------------------------------------- route table
// Each entry: [method, regexp on the request pathname (+search), body | (match, url, request) => body].
// Returning { __status, body } sets a status. Unmatched /api/** requests get 404 {error:'not mocked'}.
export const ROUTES: Array<[string, RegExp, Answer]> = [
  // Emberpath (legacy console API; also serves /api/auth/me and /api/hive/* in legacy mode)
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
  ['GET', /^\/api\/emberpath\/hive\/status$/, { generatedAt: T1, uiUrl: 'https://hive.example.com', apps: [] }],
  ['GET', /^\/api\/emberpath\/hive\/actors$/, { data: [] }],
  ['GET', /^\/api\/emberpath\/hive\/incidents$/, { data: [] }],
  // Oathweave
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
];


/** The browser clock tests freeze at, so relative times read the same on every run. */
export const FIXED_NOW = new Date(NOW_MS);

/** Serve the runtime and product APIs from fixtures. `log` collects requests that had no fixture. */
export async function installMocks(page: Page, log: string[] = []): Promise<string[]> {
  // Chat opens a websocket; accept it locally (never forwarded) so the page shows "Connected".
  await page.routeWebSocket(/\/api\/chat\/api\/v4\/websocket/, () => {});
  await page.route(/\/runtime\.json(\?.*)?$/, (route) => route.fulfill({ json: RUNTIME }));
  await page.route(/\/api\//, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const target = url.pathname + url.search;
    for (const [method, pattern, value] of ROUTES) {
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
