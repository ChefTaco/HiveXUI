import {createEmberpathApi} from './emberpath-api';
import { memoryDashboardApi } from './memory-dashboard-api';
import { readConsoleIncidents } from './console-incidents';
import { apiFetch, clearAccess } from './transport';
import { failureMeta, HiveApiError, readApiFailure, readJsonAnswer, type HiveApiErrorOptions } from './api-error';
import {createIamApi} from './iam-api';
import { browserIdentity, enrollmentInstallationId } from './runtime';
import { readConsoleHealth } from './suite-health';
import { EnrollmentInventorySchema, EnrollmentResultSchema, EnrollmentRequestSchema, LegacyEnrollmentReceiptSchema, EnrollmentInstallationsSchema, EnrollmentLifecycleRequestSchema, BrowserResourceUserResponseSchema } from '@contracts/oathweave-browser.generated';
import type {
  AdminUser,
  HiveStatus,
  HiveActor,
  HiveActorCreateRequest,
  HiveIncident,
  HiveActorLifecycleRequest,
  HiveActorLifecycleResponse,
} from './types';
import type {
  JsonRequestBody,
} from '@contracts/ui-api.generated.js';

function enrollmentPath(suffix = '') {
  const installation = enrollmentInstallationId();
  return '/api/iam/enrollments' + suffix + (installation ? '?installationId=' + encodeURIComponent(installation) : '');
}

/** A failed request to Emberpath, Oathweave or the native console API that pages tell apart by status. */
export class ApiError extends HiveApiError {
  override name = 'ApiError';
  constructor(message: string, status: number, options: HiveApiErrorOptions = {}) {
    super(status, message, options);
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
    const failure = await readApiFailure(response, { fallback: (status) => `Request failed with status ${status}` });
    // A bare code ({error:"CODE"}) was shown as the message before, so it still is.
    throw new ApiError(failure.remoteMessage ?? failure.code ?? failure.message, response.status, { ...failureMeta(failure), code: failure.code });
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await readJsonAnswer(response, 'The product', (options.method ?? 'GET') !== 'GET')) as T;
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
    return product === 'oathweave'
      ? request('/api/iam/auth/me').then(value=>BrowserResourceUserResponseSchema.parse(value))
      : createEmberpathApi(request).emberpathMe();
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
    if (browserIdentity()) return request(enrollmentPath(`/${encodeURIComponent(id)}/disable`), { method: 'POST', body: EnrollmentLifecycleRequestSchema.parse({ operationId: body.operationId }) }).then(value => EnrollmentResultSchema.parse(value));
    return request<HiveActorLifecycleResponse, HiveActorLifecycleRequest>(
      `/api/hive/actors/${encodeURIComponent(id)}/disable`,
      { method: 'POST', body },
    );
  },
  rotateHiveActor(id: string, body: HiveActorLifecycleRequest) {
    if (browserIdentity()) return request(enrollmentPath(`/${encodeURIComponent(id)}/rotate`), { method: 'POST', body: EnrollmentLifecycleRequestSchema.parse({ operationId: body.operationId }) }).then(value => EnrollmentResultSchema.parse(value));
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
    if (browserIdentity()) return readConsoleIncidents();
    return request<{ data: HiveIncident[] }>('/api/hive/incidents');
  },
  ...memoryDashboardApi,

  // ---- IAM operations ----
  ...createIamApi(apiFetch, (failure)=>new ApiError(failure.message,failure.status,{...failureMeta(failure),code:failure.code})),

  ...createEmberpathApi(request),


};
