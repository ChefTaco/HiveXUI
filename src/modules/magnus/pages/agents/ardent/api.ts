import { z } from 'zod';
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

/** How long a node may take, as the old console allowed. */
const actionTimeout = (action: string): number => (action === 'package-install' ? 620_000 : action === 'profile-import-hermes' ? 100_000 : action.startsWith('service-') ? 125_000 : 55_000);

export const ardentAction = <S extends z.ZodType>(nodeId: string, profileId: string, action: string, schema: S, options: { body?: unknown; target?: string | undefined } = {}): Promise<z.output<S>> =>
  magnus
    .post(`${base(nodeId, profileId)}/action`, ok(schema), { body: { action, ...(options.target ? { target: options.target } : {}), body: options.body ?? {} }, timeoutMs: actionTimeout(action) })
    .then((response) => (response as { data: z.output<S> }).data);

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
