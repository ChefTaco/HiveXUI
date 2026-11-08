import {createEmberpathApi} from './emberpath-api';
import { memoryDashboardApi } from './memory-dashboard-api';
import { readConsoleIncidents } from './console-incidents';
import { apiFetch, clearAccess } from './transport';
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
  ...createIamApi(apiFetch, (message,status)=>new ApiError(message,status)),

  ...createEmberpathApi(request),


};
