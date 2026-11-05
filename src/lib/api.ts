import {
  MemoryWriteSchema,
  type MemoryWrite,
} from '@contracts/memory-operations.js';
import { apiFetch, clearAccess } from './transport';
import { browserIdentity, enrollmentInstallationId } from './runtime';
import { readConsoleHealth } from './suite-health';
import { EnrollmentInventorySchema, EnrollmentResultSchema, EnrollmentRequestSchema, LegacyEnrollmentReceiptSchema, EnrollmentInstallationsSchema } from '@contracts/oathweave.generated.js';
import type {
  AdminUser,
  ApiDoc,
  AuditEvent,
  ClientKey,
  ClientKeyCreateRequest,
  ClientKeyUpdateRequest,
  ConfigImportRequest,
  CodexOAuthCheck,
  CodexOAuthStart,
  CodexOAuthStatus,
  CreateIamClientRequest,
  CreateIamRoleRequest,
  CreateIamServiceAccountRequest,
  CreateIamSystemUserRequest,
  CreateIamUserRequest,
  HeuristicRule,
  HeuristicWriteRequest,
  HiveStatus,
  HiveActor,
  HiveActorCreateRequest,
  HiveIncident,
  HiveActorLifecycleRequest,
  HiveActorLifecycleResponse,
  IamAuditEvent,
  IamAuditStats,
  IamClient,
  IamPasswordPolicy,
  IamRole,
  IamSession,
  IamServiceAccount,
  IamSystemUser,
  IamUser,
  MemoryConsoleData,
  MemorySearchResponse,
  ModelAlias,
  ModelAliasWriteRequest,
  Provider,
  ProviderWriteRequest,
  RoutingTestResult,
  RouteRule,
  RouteRuleWriteRequest,
  RoutingObjectiveConfig,
  RuntimeSetting,
  Telemetry,
  Trace,
  UpdateIamClientRequest,
  UpdateIamRoleRequest,
  UpdateIamServiceAccountRequest,
  UpdateIamSystemUserRequest,
  UpdateIamUserRequest,
} from './types';
import type {
  IamAssignRolesRequest,
  IamRotatePasswordRequest,
  JsonRequestBody,
} from '@contracts/ui-api.generated.js';

function enrollmentPath(suffix = '') {
  const installation = enrollmentInstallationId();
  return '/api/iam/enrollments' + suffix + (installation ? '?installationId=' + encodeURIComponent(installation) : '');
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface RequestOptions<TBody extends JsonRequestBody = JsonRequestBody> {
  method?: string;
  body?: TBody;
  headers?: Record<string, string> | undefined;
}

async function request<T, TBody extends JsonRequestBody = JsonRequestBody>(
  path: string,
  options: RequestOptions<TBody> = {},
): Promise<T> {
  const body = options.body !== undefined ? JSON.stringify(options.body) : null;
  const response = await apiFetch(path, {
    method: options.method ?? 'GET',
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
    credentials: 'include',
    ...(body ? { body } : {}),
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    const text = await response.text();
    if (text) {
      try {
        const parsed = JSON.parse(text) as { error?: string; message?: string };
        message = parsed.message ?? parsed.error ?? text;
      } catch {
        message = text;
      }
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function iamPath(path: string): string {
  return `/api/iam/${path.replace(/^\/+/, '')}`;
}

function rows(value: unknown, keys: string[]): Array<Record<string, unknown>> {
  const source = Array.isArray(value)
    ? value
    : keys
        .map((key) =>
          value && typeof value === 'object'
            ? (value as Record<string, unknown>)[key]
            : null,
        )
        .find(Array.isArray);
  return Array.isArray(source)
    ? source.filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === 'object' && !Array.isArray(row),
      )
    : [];
}

/** Read-only summaries are composed in the browser using the user's resource token. */
async function memoryConsole(allowed: (permission: string) => boolean = () => true): Promise<MemoryConsoleData> {
  const paths = [
    'stats',
    'queue/status?limit=8',
    'memories/browse?limit=12&workspace_id=*',
    'sessions?limit=8&workspace_id=*',
    'agents',
    'graph/entities?limit=12&workspace_id=*',
  ];
  const results = await Promise.allSettled(
    paths.map((path, index) =>
      allowed(['memories:read', 'queue:read', 'memories:read', 'sessions:read', 'agents:read', 'memories:read'][index]!) ? request<Record<string, unknown>>('/api/memory/' + path) : Promise.resolve(null),
    ),
  );
  const value = (index: number) =>
    results[index]?.status === 'fulfilled' ? results[index].value : null;
  const failures = results.flatMap((result, index) =>
    result.status === 'rejected'
      ? [
          `${paths[index]!.split('?')[0]}: ${result.reason instanceof Error ? result.reason.message : 'Unavailable'}`,
        ]
      : [],
  );
  if (results.every((result) => result.status === 'rejected'))
    throw new Error(
      'Memory is unavailable or this identity has no permitted memory resources',
    );
  const memories = value(2);
  return {
    configured: true,
    stats: value(0),
    queue: value(1),
    memories: rows(memories, ['results', 'memories', 'items']),
    memoryTotal: memories?.total ?? null,
    sessions: rows(value(3), ['results', 'sessions', 'items']),
    agents: rows(value(4), ['agents', 'results', 'items']),
    graphEntities: rows(value(5), ['entities', 'results', 'items', 'nodes']),
    issues: failures,
  };
}

export const adminApi = {
  // ---- auth ----
  login(username: string, password: string) {
    const identity = browserIdentity();
    if (identity) return identity.login(username, password);
    return request<{ ok: boolean; user: AdminUser }>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    });
  },
  async logout() {
    const identity = browserIdentity();
    if (identity) {
      await identity.logout();
      return { ok: true };
    }
    try {
      return await request<{ ok: boolean }>('/api/auth/logout', {
        method: 'POST',
      });
    } finally {
      clearAccess();
    }
  },
  me() {
    const identity = browserIdentity();
    if (identity) return identity.me();
    return request<{ user: AdminUser }>('/api/auth/me');
  },

  resourceMe(product: 'emberpath' | 'oathweave') {
    return request<{ user: AdminUser }>(
      product === 'emberpath' ? '/api/auth/me' : '/api/iam/auth/me',
    );
  },

  // ---- hive console ----
  hiveStatus() {
    return browserIdentity()
      ? readConsoleHealth()
      : request<HiveStatus>('/api/hive/status');
  },
  hiveActorInstallations() {
    return request('/api/iam/enrollments/installations').then(value => EnrollmentInstallationsSchema.parse(value));
  },
  async hiveActors() {
    if (browserIdentity()) return EnrollmentInventorySchema.parse(await request(enrollmentPath()));
    return request<{ data: HiveActor[] }>('/api/hive/actors');
  },
  createHiveActor(body: HiveActorCreateRequest) {
    if (browserIdentity()) return request(enrollmentPath(), { method: 'POST', body: EnrollmentRequestSchema.parse(body) }).then(value => EnrollmentResultSchema.parse(value));
    return request<HiveActorLifecycleResponse, HiveActorCreateRequest>(
      '/api/hive/actors',
      { method: 'POST', body },
    );
  },
  disableHiveActor(id: string, body: HiveActorLifecycleRequest) {
    if (browserIdentity()) return request(enrollmentPath(`/${encodeURIComponent(id)}/disable`), { method: 'POST', body: { operationId: body.operationId } }).then(value => EnrollmentResultSchema.parse(value));
    return request<HiveActorLifecycleResponse, HiveActorLifecycleRequest>(
      `/api/hive/actors/${encodeURIComponent(id)}/disable`,
      { method: 'POST', body },
    );
  },
  rotateHiveActor(id: string, body: HiveActorLifecycleRequest) {
    if (browserIdentity()) return request(enrollmentPath(`/${encodeURIComponent(id)}/rotate`), { method: 'POST', body: { operationId: body.operationId } }).then(value => EnrollmentResultSchema.parse(value));
    return request<HiveActorLifecycleResponse, HiveActorLifecycleRequest>(
      `/api/hive/actors/${encodeURIComponent(id)}/rotate`,
      { method: 'POST', body },
    );
  },
  resumeHiveActor(id: string, operationId: string) {
    return request(enrollmentPath(`/${encodeURIComponent(id)}/operations/${encodeURIComponent(operationId)}/resume`), { method: 'POST' }).then(value => EnrollmentResultSchema.parse(value));
  },
  recoverHiveActorOperation(id: string, operationId: string) {
    return request(enrollmentPath(`/${encodeURIComponent(id)}/operations/${encodeURIComponent(operationId)}`)).then(value => EnrollmentResultSchema.parse(value));
  },
  recoverLegacyActorReceipt(id: string) {
    return request(enrollmentPath(`/${encodeURIComponent(id)}/receipt`)).then(value => LegacyEnrollmentReceiptSchema.parse(value));
  },
  hiveIncidents() {
    return request<{ data: HiveIncident[] }>('/api/hive/incidents');
  },
  memoryConsole(allowed?: (permission: string) => boolean) {
    return memoryConsole(allowed);
  },
  searchMemory(params: {
    query?: string;
    workspaceId?: string;
    scope?: string;
    limit?: number;
    offset?: number;
  }) {
    const search = new URLSearchParams();
    search.set('workspace_id', params.workspaceId ?? '*');
    if (params.scope) search.set('scope', params.scope);
    search.set('limit', String(params.limit ?? 25));
    if (params.query) {
      search.set('explain', 'true');
      return request<MemorySearchResponse>(
        `/api/memory/memories/search?${search}`,
        {
          method: 'POST',
          body: {
            query: params.query,
            workspace_id: params.workspaceId ?? '*',
            limit: params.limit ?? 25,
            offset: params.offset ?? 0,
            ...(params.scope ? { scope: params.scope } : {}),
          },
        },
      );
    }
    search.set('cursor', String(params.offset ?? 0));
    return request<MemorySearchResponse>(
      `/api/memory/memories/browse?${search}`,
    );
  },
  createMemory(body: MemoryWrite) {
    return request<Record<string, unknown>>('/api/memory/memories', {
      method: 'POST',
      body: MemoryWriteSchema.parse(body),
    });
  },
  getMemory(id: string) {
    return request<Record<string, unknown>>(
      `/api/memory/memories/${encodeURIComponent(id)}`,
    );
  },
  updateMemory(id: string, body: Record<string, unknown>) {
    return request<Record<string, unknown>>(
      `/api/memory/memories/${encodeURIComponent(id)}`,
      { method: 'PUT', body },
    );
  },
  deleteMemory(id: string) {
    return request<void>(
      `/api/memory/memories/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
  },
  memoryGraph(id: string) {
    return request<Record<string, unknown>>(
      `/api/memory/memories/${encodeURIComponent(id)}/graph`,
    );
  },
  memoryQueue(limit = 12) {
    return request<Record<string, unknown>>(
      `/api/memory/queue/status?limit=${limit}`,
    );
  },
  runMemoryQueueJob(id: string) {
    return request<Record<string, unknown>>(
      `/api/memory/queue/jobs/${encodeURIComponent(id)}/run`,
      { method: 'POST', body: {} },
    );
  },
  retryMemoryQueueJob(id: string) {
    return request<Record<string, unknown>>(
      `/api/memory/queue/jobs/${encodeURIComponent(id)}/retry`,
      { method: 'POST', body: {} },
    );
  },
  cancelMemoryQueueJob(id: string) {
    return request<Record<string, unknown>>(
      `/api/memory/queue/jobs/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
  },
  memoryConflicts(body: Record<string, unknown>) {
    return request<Record<string, unknown>>('/api/memory/memories/conflicts', {
      method: 'POST',
      body,
    });
  },
  memoryWebhooks() {
    return request<Record<string, unknown>>('/api/memory/webhooks');
  },
  memoryWebhookDeliveries(limit = 10) {
    return request<Record<string, unknown>>(
      `/api/memory/webhooks/deliveries?limit=${limit}`,
    );
  },

  // ---- IAM operations ----
  iamHealth() {
    return request<Record<string, unknown>>(iamPath('health'));
  },
  iamUsers() {
    return request<{
      users: IamUser[];
      total: number;
      page: number;
      limit: number;
    }>(iamPath('users?limit=100'));
  },
  createIamUser(body: CreateIamUserRequest) {
    return request<{ user: IamUser }>(iamPath('users'), {
      method: 'POST',
      body,
    });
  },
  updateIamUser(id: string, body: UpdateIamUserRequest) {
    return request<{ user: IamUser }>(iamPath(`users/${id}`), {
      method: 'PATCH',
      body,
    });
  },
  deleteIamUser(id: string) {
    return request<{ success: boolean }>(iamPath(`users/${id}`), {
      method: 'DELETE',
    });
  },
  assignIamUserRoles(id: string, roleIds: string[]) {
    const body: IamAssignRolesRequest = { roleIds };
    return request<{ success: boolean }, IamAssignRolesRequest>(
      iamPath(`users/${id}/roles`),
      { method: 'POST', body },
    );
  },
  removeIamUserRole(id: string, roleId: string) {
    return request<{ success: boolean }>(
      iamPath(`users/${id}/roles/${roleId}`),
      { method: 'DELETE' },
    );
  },
  lockIamUser(id: string) {
    return request<{ success: boolean }>(iamPath(`users/${id}/lock`), {
      method: 'POST',
    });
  },
  unlockIamUser(id: string) {
    return request<{ success: boolean }>(iamPath(`users/${id}/unlock`), {
      method: 'POST',
    });
  },
  rotateIamUserPassword(id: string, password: string) {
    const body: IamRotatePasswordRequest = { password };
    return request<{ success: boolean }, IamRotatePasswordRequest>(
      iamPath(`users/${id}/rotate-password`),
      { method: 'POST', body },
    );
  },
  iamRoles() {
    return request<{ roles: IamRole[] }>(iamPath('roles'));
  },
  createIamRole(body: CreateIamRoleRequest) {
    return request<{ role: IamRole }>(iamPath('roles'), {
      method: 'POST',
      body,
    });
  },
  updateIamRole(id: string, body: UpdateIamRoleRequest) {
    return request<{ role: IamRole }>(iamPath(`roles/${id}`), {
      method: 'PATCH',
      body,
    });
  },
  deleteIamRole(id: string) {
    return request<{ success: boolean }>(iamPath(`roles/${id}`), {
      method: 'DELETE',
    });
  },
  iamServiceAccounts() {
    return request<{ serviceAccounts: IamServiceAccount[] }>(
      iamPath('service-accounts'),
    );
  },
  createIamServiceAccount(body: CreateIamServiceAccountRequest) {
    return request<{ id: string; apiKey: string; warning: string }>(
      iamPath('service-accounts'),
      { method: 'POST', body },
    );
  },
  updateIamServiceAccount(id: string, body: UpdateIamServiceAccountRequest) {
    return request<{ serviceAccount: IamServiceAccount }>(
      iamPath(`service-accounts/${id}`),
      { method: 'PATCH', body },
    );
  },
  deleteIamServiceAccount(id: string) {
    return request<{ success: boolean }>(iamPath(`service-accounts/${id}`), {
      method: 'DELETE',
    });
  },
  rotateIamServiceAccount(id: string) {
    return request<{ apiKey: string; warning: string }>(
      iamPath(`service-accounts/${id}/rotate`),
      { method: 'POST' },
    );
  },
  iamClients() {
    return request<{ clients: IamClient[] }>(iamPath('clients'));
  },
  createIamClient(body: CreateIamClientRequest) {
    return request<{ client: IamClient }>(iamPath('clients'), {
      method: 'POST',
      body,
    });
  },
  updateIamClient(id: string, body: UpdateIamClientRequest) {
    return request<{ client: IamClient }>(iamPath(`clients/${id}`), {
      method: 'PATCH',
      body,
    });
  },
  deleteIamClient(id: string) {
    return request<{ success: boolean }>(iamPath(`clients/${id}`), {
      method: 'DELETE',
    });
  },
  iamSystemUsers() {
    return request<{ systemUsers: IamSystemUser[] }>(iamPath('system-users'));
  },
  createIamSystemUser(body: CreateIamSystemUserRequest) {
    return request<{ systemUser: IamSystemUser }>(iamPath('system-users'), {
      method: 'POST',
      body,
    });
  },
  updateIamSystemUser(id: string, body: UpdateIamSystemUserRequest) {
    return request<{ systemUser: IamSystemUser }>(
      iamPath(`system-users/${id}`),
      { method: 'PATCH', body },
    );
  },
  deleteIamSystemUser(id: string) {
    return request<{ success: boolean }>(iamPath(`system-users/${id}`), {
      method: 'DELETE',
    });
  },
  iamSessions() {
    return request<{ sessions: IamSession[] }>(iamPath('sessions'));
  },
  revokeIamSession(id: string) {
    return request<{ success: boolean }>(iamPath(`sessions/${id}`), {
      method: 'DELETE',
    });
  },
  iamAudit() {
    return request<{
      events: IamAuditEvent[];
      total: number;
      page: number;
      limit: number;
    }>(iamPath('audit?limit=50'));
  },
  iamAuditStats() {
    return request<IamAuditStats>(iamPath('audit/stats'));
  },
  iamPasswordPolicy() {
    return request<{ policy: IamPasswordPolicy }>(iamPath('password-policy'));
  },
  updateIamPasswordPolicy(body: Partial<IamPasswordPolicy>) {
    return request<{ policy: IamPasswordPolicy }, Partial<IamPasswordPolicy>>(
      iamPath('password-policy'),
      { method: 'PATCH', body },
    );
  },

  // ---- providers ----
  providers() {
    return request<{ data: Provider[] }>('/api/providers');
  },
  createProvider(body: ProviderWriteRequest) {
    return request<{ data: Provider }>('/api/providers', {
      method: 'POST',
      body,
    });
  },
  updateProvider(id: string, body: ProviderWriteRequest) {
    return request<{ data: Provider }>(`/api/providers/${id}`, {
      method: 'PUT',
      body,
    });
  },
  deleteProvider(id: string) {
    return request<{ ok: boolean }>(`/api/providers/${id}`, {
      method: 'DELETE',
    });
  },
  codexOAuthStatus() {
    return request<{ data: CodexOAuthStatus }>(
      '/api/providers/codex-oauth/status',
    );
  },
  startCodexOAuth() {
    return request<{ data: CodexOAuthStart }>(
      '/api/providers/codex-oauth/start',
      { method: 'POST' },
    );
  },
  checkCodexOAuth(loginId: string) {
    return request<{ data: CodexOAuthCheck }>(
      '/api/providers/codex-oauth/check',
      { method: 'POST', body: { loginId } },
    );
  },

  // ---- model aliases ----
  aliases() {
    return request<{ data: ModelAlias[] }>('/api/model-aliases');
  },
  createAlias(body: ModelAliasWriteRequest) {
    return request<{ data: ModelAlias }>('/api/model-aliases', {
      method: 'POST',
      body,
    });
  },
  updateAlias(id: string, body: ModelAliasWriteRequest) {
    return request<{ data: ModelAlias }>(`/api/model-aliases/${id}`, {
      method: 'PUT',
      body,
    });
  },
  deleteAlias(id: string) {
    return request<{ ok: boolean }>(`/api/model-aliases/${id}`, {
      method: 'DELETE',
    });
  },

  // ---- route rules ----
  routeRules() {
    return request<{ data: RouteRule[] }>('/api/route-rules');
  },
  runRoutingTest(body: {
    category?: string;
    modelAlias: string;
    prompt: string;
    maxResponseChars?: number;
  }) {
    return request<{ data: RoutingTestResult }>('/api/testing/run', {
      method: 'POST',
      body,
    });
  },
  createRouteRule(body: RouteRuleWriteRequest) {
    return request<{ data: RouteRule }>('/api/route-rules', {
      method: 'POST',
      body,
    });
  },
  updateRouteRule(id: string, body: RouteRuleWriteRequest) {
    return request<{ data: RouteRule }>(`/api/route-rules/${id}`, {
      method: 'PUT',
      body,
    });
  },
  deleteRouteRule(id: string) {
    return request<{ ok: boolean }>(`/api/route-rules/${id}`, {
      method: 'DELETE',
    });
  },

  // ---- heuristics ----
  heuristics() {
    return request<{ data: HeuristicRule[] }>('/api/heuristics');
  },
  createHeuristic(body: HeuristicWriteRequest) {
    return request<{ data: HeuristicRule }>('/api/heuristics', {
      method: 'POST',
      body,
    });
  },
  updateHeuristic(id: string, body: HeuristicWriteRequest) {
    return request<{ data: HeuristicRule }>(`/api/heuristics/${id}`, {
      method: 'PUT',
      body,
    });
  },
  deleteHeuristic(id: string) {
    return request<{ ok: boolean }>(`/api/heuristics/${id}`, {
      method: 'DELETE',
    });
  },

  // ---- client keys ----
  clientKeys() {
    return request<{ data: ClientKey[] }>('/api/client-keys');
  },
  createClientKey(body: ClientKeyCreateRequest) {
    return request<{ data: ClientKey & { apiKey: string } }>(
      '/api/client-keys',
      { method: 'POST', body },
    );
  },
  updateClientKey(id: string, body: ClientKeyUpdateRequest) {
    return request<{ data: ClientKey }>(`/api/client-keys/${id}`, {
      method: 'PUT',
      body,
    });
  },
  rotateClientKey(id: string) {
    return request<{ data: ClientKey & { apiKey: string } }>(
      `/api/client-keys/${id}/rotate`,
      { method: 'POST' },
    );
  },
  deleteClientKey(id: string) {
    return request<{ ok: boolean }>(`/api/client-keys/${id}`, {
      method: 'DELETE',
    });
  },

  // ---- observability ----
  telemetry() {
    return request<Telemetry>('/api/telemetry');
  },
  traces() {
    return request<{ data: Trace[] }>('/api/traces');
  },
  audit() {
    return request<{ data: AuditEvent[] }>('/api/audit');
  },

  // ---- settings / config ----
  runtimeSettings() {
    return request<{ data: RuntimeSetting[] }>('/api/runtime-settings');
  },
  routingObjective() {
    return request<{ data: { config: RoutingObjectiveConfig } }>(
      '/api/routing/objective',
    );
  },
  updateRoutingObjective(body: RoutingObjectiveConfig) {
    return request<{ data: { config: RoutingObjectiveConfig } }>(
      '/api/routing/objective',
      { method: 'PUT', body },
    );
  },
  exportConfig() {
    return request<Record<string, unknown>>('/api/config/export');
  },
  importConfig(body: ConfigImportRequest) {
    return request<{ ok: boolean }>('/api/config/import', {
      method: 'POST',
      body,
    });
  },

  // ---- docs ----
  docsIndex() {
    return request<{ docs: ApiDoc[]; providers: Provider[] }>(
      '/api/docs/index',
    );
  },
};
