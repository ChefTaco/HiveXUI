import { z } from 'zod';
import {
  ardentAgentOperationAcceptedResponseSchema,
  ardentAgentOperationResponseSchema,
  type ardentAgentDeployRequestSchema,
} from '@contracts/magnus/browser';
import { apiFetch } from '../../../../../lib/transport';
import { apiPath, magnus, segment } from '../../../api/client';
import { MagnusApiError } from '../../../api/errors';
import { ardentInstallationResponseSchema, ardentInstallationsResponseSchema, ardentProfilesResponseSchema } from './schemas';

const ok = <T extends z.ZodType>(data: T) => z.object({ success: z.literal(true), data });
const base = (nodeId: string, profileId: string) => `/ardent/installations/${segment(nodeId)}/profiles/${segment(profileId)}`;

export const listInstallations = (signal?: AbortSignal) => magnus.get('/ardent/installations', ardentInstallationsResponseSchema, { signal }).then((response) => response.data);
export const readInstallation = (nodeId: string, signal?: AbortSignal) => magnus.get(`/ardent/installations/${segment(nodeId)}`, ardentInstallationResponseSchema, { signal }).then((response) => response.data);
export const listProfiles = (signal?: AbortSignal) => magnus.get('/ardent/profiles', ardentProfilesResponseSchema, { signal }).then((response) => response.data);

/** A profile resource, read through the node. `resource` is one of the paths routes/ardent.ts allows. */
export const readResource = <S extends z.ZodType>(nodeId: string, profileId: string, resource: string, schema: S, signal?: AbortSignal): Promise<z.output<S>> =>
  magnus.get(`${base(nodeId, profileId)}/${resource}`, ok(schema), { signal }).then((response) => (response as { data: z.output<S> }).data);

/** New Agent: starts the deploy operation and answers its ID. ADMIN only. */
export const deployAgent = (request: z.input<typeof ardentAgentDeployRequestSchema>): Promise<string> =>
  magnus.post('/ardent/agents', ardentAgentOperationAcceptedResponseSchema, { body: request }).then((response) => response.data.operationId);
export const readAgentOperation = (operationId: string, signal?: AbortSignal) =>
  magnus.get(`/ardent/agents/operations/${segment(operationId)}`, ardentAgentOperationResponseSchema, { signal }).then((response) => response.data);
/** Reruns a failed operation from its first unfinished step. */
export const resumeAgentOperation = (operationId: string): Promise<string> =>
  magnus.post(`/ardent/agents/operations/${segment(operationId)}/resume`, ardentAgentOperationAcceptedResponseSchema).then((response) => response.data.operationId);
/** Enroll an existing, running profile in HiveMem (or rotate its credential). */
export const enableHiveMem = (nodeId: string, profileId: string): Promise<string> =>
  magnus.post(`${base(nodeId, profileId)}/hivemem`, ardentAgentOperationAcceptedResponseSchema).then((response) => response.data.operationId);
export const agentOperationStreamPath = (operationId: string): string => `/ardent/agents/operations/${segment(operationId)}/stream`;

/** How long a node may take, as the old console allowed. */
const actionTimeout = (action: string): number => (action === 'package-install' ? 620_000 : action.startsWith('service-') ? 125_000 : 55_000);

export const ardentAction = <S extends z.ZodType>(nodeId: string, profileId: string, action: string, schema: S, options: { body?: unknown; target?: string | undefined } = {}): Promise<z.output<S>> =>
  magnus
    .post(`${base(nodeId, profileId)}/action`, ok(schema), { body: { action, ...(options.target ? { target: options.target } : {}), body: options.body ?? {} }, timeoutMs: actionTimeout(action) })
    .then((response) => (response as { data: z.output<S> }).data);

/**
 * One profile's actions and resource reads. The profile editors take one, so a surface other than the
 * fleet profile page (Agent Studio) can route the same edits through its own service.
 */
export interface ArdentProfileClient {
  action<S extends z.ZodType>(action: string, schema: S, options?: { body?: unknown; target?: string | undefined }): Promise<z.output<S>>;
  read<S extends z.ZodType>(resource: string, schema: S, signal?: AbortSignal): Promise<z.output<S>>;
}
/** The default: straight to the node through Magnus. */
export const magnusProfileClient = (nodeId: string, profileId: string): ArdentProfileClient => ({
  action: (action, schema, options) => ardentAction(nodeId, profileId, action, schema, options),
  read: (resource, schema, signal) => readResource(nodeId, profileId, resource, schema, signal),
});

export function saveBlob(blob: Blob, name: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** Artifacts are bytes, so this is the one read that does not go through a JSON schema. */
export async function fetchArtifact(nodeId: string, profileId: string, artifactId: string, expectedBytes: number): Promise<Blob> {
  const response = await apiFetch(apiPath(`${base(nodeId, profileId)}/artifacts/${segment(artifactId)}`));
  if (!response.ok || response.headers.get('content-type') !== 'application/octet-stream') throw new MagnusApiError(response.status, `The artifact could not be downloaded (HTTP ${response.status})`);
  const bytes = await response.blob();
  if (bytes.size !== expectedBytes) throw new Error('The artifact differs in size from the task record');
  return bytes;
}
