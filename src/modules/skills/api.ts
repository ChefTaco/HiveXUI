import { z } from 'zod';
import { apiFetch } from '../../lib/transport';
import { hiveApiError, parseAnswer, readJsonAnswer } from '../../lib/api-error';
import {
  SkillSchema,
  ReleaseSchema,
  ManagedDeploymentSchema, DeploymentApprovalSchema, DeploymentCapabilitiesSchema,
  CreateSkillSchema,
  UploadReleaseSchema,
  EnrollTargetSchema,
  AuthMeSchema, EmptyResponseSchema, OkSchema, EnrollmentResponseSchema, UpdateSkillSchema, UpdateTargetSchema, PromoteReleaseSchema,
  SkillListSchema, ReleaseListSchema, ChannelListSchema, TargetListSchema, ReceiptListSchema, DeploymentJobListSchema, AuditListSchema,
  HiveAuditPage,
  type UpdateSkill, type UpdateTarget,
  type CreateSkill,
  type UploadRelease,
  type EnrollTarget,
} from '../../../contracts/hiveskills.generated';

/**
 * GET /v1/skills/:slug: a public catalog entry with the release promoted on the channel (null when none
 * is). The generated contract does not describe this payload, so it is typed here from the registry.
 */
export const CatalogEntrySchema = SkillSchema.extend({
  release: z.object({ version: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), notes: z.string().nullable().optional(), createdAt: z.string().optional() }).nullable(),
});
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

/**
 * GET /admin/updates: the registry's own release and the newer one its update check found. The
 * browser contract does not describe it; this follows HiveSkills' `UpdateStatus`.
 */
export const UpdateStatusSchema = z.object({
  enabled: z.boolean(),
  installed: z.string().max(64),
  checkedAt: z.string().optional(),
  available: z.string().max(64).optional(),
  notesUrl: z.string().max(2000).optional(),
  summary: z.string().max(5000).optional(),
  newRequiredEnv: z.array(z.object({ name: z.string() }).passthrough()).optional(),
  migrations: z.array(z.object({ impact: z.string().optional() }).passthrough()).optional(),
  stale: z.boolean().optional(),
  error: z.string().max(2000).optional(),
});
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;
/** The largest page the audit export serves. */
export const AUDIT_EXPORT_PAGE = 200;

export function createSkillsApi(send: typeof apiFetch = apiFetch) {
  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    method = 'GET',
    body?: object,
  ): Promise<T> {
    const response = await send('/api/skills' + path, {
      method,
      ...(body
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {}),
    });
    if (!response.ok)
      throw await hiveApiError(response, { fallback: 'The registry could not complete this request' });
    return parseAnswer(schema, response.status === 204 ? null : await readJsonAnswer(response, 'HiveSkills', method !== 'GET'), 'HiveSkills', method !== 'GET');
  }
  return {
    updates: () => request('/admin/updates', UpdateStatusSchema),
    /** One page of the HiveAuditRecord v1 export, oldest first; `nextCursor` continues it. */
    auditExport: (after?: string) => request('/v1/audit/export?limit=' + AUDIT_EXPORT_PAGE + (after ? '&after=' + encodeURIComponent(after) : ''), HiveAuditPage),
    catalog: () => request('/v1/skills', SkillListSchema),
    catalogEntry: (slug: string, channel: 'stable' | 'canary' = 'stable') =>
      request('/v1/skills/' + encodeURIComponent(slug) + (channel === 'stable' ? '' : '?channel=' + channel), CatalogEntrySchema),
    me: () =>
      request(
        '/auth/me',
        AuthMeSchema,
      ),
    skills: () => request('/admin/skills', SkillListSchema),
    releases: (slug: string) =>
      request(
        '/admin/skills/' + encodeURIComponent(slug) + '/releases',
        ReleaseListSchema,
      ),
    channels: () => request('/admin/channels', ChannelListSchema),
    targets: () => request('/admin/targets', TargetListSchema),
    receipts: () =>
      request('/admin/receipts', ReceiptListSchema),
    deploymentCapabilities: () => request('/admin/deployments/capabilities',DeploymentCapabilitiesSchema),
    prepareDeployment: (target:string) => request('/admin/deployments/'+encodeURIComponent(target),ManagedDeploymentSchema,'POST',{}),
    deployment: (id:string) => request('/admin/deployments/jobs/'+encodeURIComponent(id),ManagedDeploymentSchema),
    approveDeployment: (id:string,publicationSha256:string) => request('/admin/deployments/jobs/'+encodeURIComponent(id)+'/approve',ManagedDeploymentSchema,'POST',DeploymentApprovalSchema.parse({publicationSha256})),
    reconcileDeployment: (id:string) => request('/admin/deployments/jobs/'+encodeURIComponent(id)+'/reconcile',ManagedDeploymentSchema,'POST',{}),
    deployments: () =>
      request('/admin/deployments', DeploymentJobListSchema),
    audit: (before?: number) =>
      request(
        '/admin/audit?limit=50' + (before ? '&before=' + before : ''),
        AuditListSchema,
      ),
    create: (body: CreateSkill) =>
      request(
        '/admin/skills',
        SkillSchema,
        'POST',
        CreateSkillSchema.parse(body),
      ),
    update: (
      slug: string,
      body: UpdateSkill,
    ) =>
      request(
        '/admin/skills/' + encodeURIComponent(slug),
        SkillSchema,
        'PATCH',
        UpdateSkillSchema.parse(body),
      ),
    remove: (slug: string) =>
      request('/admin/skills/' + encodeURIComponent(slug), EmptyResponseSchema, 'DELETE'),
    upload: (slug: string, body: UploadRelease) =>
      request(
        '/admin/skills/' + encodeURIComponent(slug) + '/releases',
        ReleaseSchema,
        'POST',
        UploadReleaseSchema.parse(body),
      ),
    promote: (slug: string, channel: 'stable' | 'canary', version: string) =>
      request(
        '/admin/channels/' + channel + '/' + encodeURIComponent(slug),
        OkSchema,
        'PUT',
        PromoteReleaseSchema.parse({ version }),
      ),
    withdraw: (slug: string, channel: 'stable' | 'canary') =>
      request(
        '/admin/channels/' + channel + '/' + encodeURIComponent(slug),
        EmptyResponseSchema,
        'DELETE',
      ),
    target: (
      name: string,
      body: UpdateTarget,
    ) =>
      request(
        '/admin/targets/' + encodeURIComponent(name),
        OkSchema,
        'PUT',
        UpdateTargetSchema.parse(body),
      ),
    enroll: (name: string, body: EnrollTarget) =>
      request(
        '/admin/targets/' + encodeURIComponent(name) + '/enroll',
        EnrollmentResponseSchema,
        'POST',
        EnrollTargetSchema.parse(body),
      ),
  };
}
export const skillsApi = createSkillsApi();
