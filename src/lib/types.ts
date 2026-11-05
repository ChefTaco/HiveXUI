// Shared admin-plane entity contracts (owned locally by the UI).

export interface AdminUser {
  id: string;
  username: string;
  displayName?: string | null;
  roles?: string[];
  permissions?: string[];
}

export interface HiveActor {
  id: string;
  kind: 'user' | 'service-account' | 'system-user' | 'router-key' | 'memory-agent';
  label: string;
  status: 'active' | 'inactive' | 'unknown';
  sources: string[];
  identifiers: Record<string, unknown>;
  capabilities: string[];
  lastActivityAt: string | null;
  linkedResourceCount: number;
}

export interface HiveActorCreateRequest {
  workspaceId?: string;
  owningProject?: string;
  expiresHours?: number;
  agentId: string;
  displayName: string;
  description?: string;
  iamClientId: string;
  roleIds?: string[];
  scopes?: string[];
  hostLabel?: string;
  allowedIps?: string[];
}

export interface HiveActorLifecycleRequest {
  operationId?: string;
  kind?: HiveActor['kind'];
  label?: string;
  identifiers?: Record<string, unknown>;
}

export interface HiveActorLifecycleResponse extends Record<string, unknown> {
  ok: boolean;
  identifiers?: Record<string, unknown>;
  secrets?: Record<string, string | null>;
  steps?: Array<Record<string, unknown>>;
}

export interface HiveIncidentEvent {
  id: string;
  service: 'router' | 'iam' | 'memory';
  kind: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: string;
  title: string;
  requestId: string | null;
  actor: string | null;
  outcome: string | null;
  details: Record<string, unknown>;
}

export interface HiveIncident {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  status: 'open' | 'resolved';
  title: string;
  summary: string;
  startedAt: string;
  endedAt: string;
  requestIds: string[];
  services: string[];
  actors: string[];
  events: HiveIncidentEvent[];
}

export type { MemoryConsoleData, MemorySearchResponse } from './memory-dashboard-api';

export type {
  HiveAppKey,
  HiveAppState,
  HiveAppStatus,
  HiveHealthCheck,
  HiveStatusResponse as HiveStatus,
  TlsCertificateStatus,
} from '@contracts/service-health-schemas.js';

export type {CreateIamClientRequest,CreateIamRoleRequest,CreateIamServiceAccountRequest,CreateIamSystemUserRequest,CreateIamUserRequest,IamAuditEvent,IamAuditStats,IamClient,IamPasswordPolicy,IamRole,IamSession,IamServiceAccount,IamSystemUser,IamUser,UpdateIamClientRequest,UpdateIamRoleRequest,UpdateIamServiceAccountRequest,UpdateIamSystemUserRequest,UpdateIamUserRequest,IamAssignRolesRequest,IamRotatePasswordRequest,IamRoleSummary,IamRoleAssignment} from '@contracts/oathweave-browser.generated';

export type {Provider, ProviderModel, ProviderWriteRequest, ProviderModelWriteRequest, ModelAliasWriteRequest, ConfigImportRequest,
  CodexOAuthStatus, CodexOAuthStart, CodexOAuthCheck, ModelAlias, RouteRule, HeuristicRule, RouteRuleWriteRequest,
  HeuristicWriteRequest, ClientKeyMetadataInput, ClientKeyCreateRequest, ClientKeyUpdateRequest, ClientKey, Telemetry,
  Trace, AuditEvent, RoutingTestResult, RuntimeSetting, RoutingGoal, RoutingObjectiveConfig} from '@contracts/emberpath-model-admin.generated';

export type {ApiDoc} from '@contracts/emberpath-model-admin.generated';
