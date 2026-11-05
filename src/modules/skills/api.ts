import { z } from 'zod';
import { apiFetch } from '../../lib/transport';
import {
  SkillSchema,
  ReleaseSchema,
  ChannelSchema,
  TargetSchema,
  AuditSchema,
  ReceiptSchema,
  DeploymentJobSchema,
  ManagedDeploymentSchema, DeploymentApprovalSchema, DeploymentCapabilitiesSchema,
  CreateSkillSchema,
  UploadReleaseSchema,
  EnrollTargetSchema,
  type CreateSkill,
  type UploadRelease,
  type EnrollTarget,
} from '../../../contracts/hiveskills.generated';

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
    if (!response.ok) {
      const error: unknown = await response.json().catch(() => null);
      throw new Error(
        error &&
          typeof error === 'object' &&
          'error' in error &&
          typeof error.error === 'string'
          ? error.error
          : 'The registry could not complete this request',
      );
    }
    return schema.parse(response.status === 204 ? null : await response.json());
  }
  return {
    catalog: () => request('/v1/skills', z.array(SkillSchema)),
    me: () =>
      request(
        '/auth/me',
        z.object({ username: z.string(), isAdmin: z.boolean() }),
      ),
    skills: () => request('/admin/skills', z.array(SkillSchema)),
    releases: (slug: string) =>
      request(
        '/admin/skills/' + encodeURIComponent(slug) + '/releases',
        z.array(ReleaseSchema),
      ),
    channels: () => request('/admin/channels', z.array(ChannelSchema)),
    targets: () => request('/admin/targets', z.array(TargetSchema)),
    receipts: () =>
      request('/admin/receipts', z.array(ReceiptSchema)),
    deploymentCapabilities: () => request('/admin/deployments/capabilities',DeploymentCapabilitiesSchema),
    prepareDeployment: (target:string) => request('/admin/deployments/'+encodeURIComponent(target),ManagedDeploymentSchema,'POST',{}),
    deployment: (id:string) => request('/admin/deployments/jobs/'+encodeURIComponent(id),ManagedDeploymentSchema),
    approveDeployment: (id:string,publicationSha256:string) => request('/admin/deployments/jobs/'+encodeURIComponent(id)+'/approve',ManagedDeploymentSchema,'POST',DeploymentApprovalSchema.parse({publicationSha256})),
    reconcileDeployment: (id:string) => request('/admin/deployments/jobs/'+encodeURIComponent(id)+'/reconcile',ManagedDeploymentSchema,'POST',{}),
    deployments: () =>
      request('/admin/deployments', z.array(DeploymentJobSchema)),
    audit: (before?: number) =>
      request(
        '/admin/audit?limit=50' + (before ? '&before=' + before : ''),
        z.array(AuditSchema),
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
      body: {
        name: string;
        description: string;
        enabled: boolean;
        homepage: string | null;
      },
    ) =>
      request(
        '/admin/skills/' + encodeURIComponent(slug),
        SkillSchema,
        'PATCH',
        body,
      ),
    remove: (slug: string) =>
      request('/admin/skills/' + encodeURIComponent(slug), z.null(), 'DELETE'),
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
        z.object({ ok: z.literal(true) }),
        'PUT',
        { version },
      ),
    withdraw: (slug: string, channel: 'stable' | 'canary') =>
      request(
        '/admin/channels/' + channel + '/' + encodeURIComponent(slug),
        z.null(),
        'DELETE',
      ),
    target: (
      name: string,
      body: { host: string; username: string; enabled: boolean },
    ) =>
      request(
        '/admin/targets/' + encodeURIComponent(name),
        z.object({ ok: z.literal(true) }),
        'PUT',
        body,
      ),
    enroll: (name: string, body: EnrollTarget) =>
      request(
        '/admin/targets/' + encodeURIComponent(name) + '/enroll',
        z.object({
          target: z.string(),
          token: z.string(),
          oneTime: z.literal(true),
        }),
        'POST',
        EnrollTargetSchema.parse(body),
      ),
  };
}
export const skillsApi = createSkillsApi();
