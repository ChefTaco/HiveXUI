// Per-node credentials (Magnus docs/NODE_CREDENTIALS.md), over the routes Magnus publishes to the browser.
// The key administration routes (/nodes/{nodeId}/credentials, .../revoke, .../reset, .../enrollment-token)
// are deliberately not browser routes, so nothing here calls them: model.ts shows their CLI and API steps.
import { z } from 'zod';
import {
  nodeCredentialDowngradeCheckResponseSchema,
  nodeCredentialFleetSummaryResponseSchema,
  nodeCredentialSchema,
  pendingBindingDecisionResponseSchema,
  pendingBindingsResponseSchema,
} from '@contracts/magnus/browser';
import { magnus, segment } from '../../../api/client';
import { MagnusApiError } from '../../../api/errors';

export type NodeCredential = z.output<typeof nodeCredentialSchema>;
export type CredentialSummary = z.output<typeof nodeCredentialFleetSummaryResponseSchema>['data'];
export type EnforceBlocker = CredentialSummary['blockers'][number];
export type PendingBinding = z.output<typeof pendingBindingsResponseSchema>['data'][number];
export type DowngradeCheck = z.output<typeof nodeCredentialDowngradeCheckResponseSchema>['data'];

/**
 * A Magnus older than per-node credentials, or an ingress that does not offer these routes yet, answers
 * 404. That is not a failure to show: the caller hides what needs the feature.
 */
async function unlessMissing<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof MagnusApiError && error.notFound) return null;
    throw error;
  }
}

/** The fleet's progress towards NODE_AUTH_MODE=enforce (ADMIN, OPERATOR). Null when this Magnus has no such route. */
export const readCredentialSummary = (signal?: AbortSignal): Promise<CredentialSummary | null> =>
  unlessMissing(magnus.get('/node-credentials/summary', nodeCredentialFleetSummaryResponseSchema, { signal }).then(({ data }) => data));

/** Bindings refused for their address and still waiting (ADMIN). Null when this Magnus has no such route. */
export const listPendingBindings = (options: { nodeId?: string | undefined; signal?: AbortSignal | undefined } = {}): Promise<PendingBinding[] | null> =>
  unlessMissing(magnus.get('/node-credentials/pending-bindings', pendingBindingsResponseSchema, { query: { status: 'PENDING', nodeId: options.nodeId }, signal: options.signal }).then(({ data }) => data));

/** Bind the waiting key as the node's first credential (ADMIN). */
export const approvePendingBinding = async (id: string): Promise<PendingBinding> =>
  (await magnus.post(`/node-credentials/pending-bindings/${segment(id)}/approve`, pendingBindingDecisionResponseSchema, { body: {} })).data;

/** Refuse the waiting key (ADMIN). The reason goes to the audit log. */
export async function rejectPendingBinding(id: string, reason?: string): Promise<PendingBinding> {
  const trimmed = reason?.trim().slice(0, 500);
  return (await magnus.post(`/node-credentials/pending-bindings/${segment(id)}/reject`, pendingBindingDecisionResponseSchema, { body: trimmed ? { reason: trimmed } : {} })).data;
}

/** What installing agent version `to` on this node needs first (ADMIN, OPERATOR). */
export const checkDowngrade = async (nodeId: string, to: string, signal?: AbortSignal): Promise<DowngradeCheck> =>
  (await magnus.get('/node-credentials/downgrade-check', nodeCredentialDowngradeCheckResponseSchema, { query: { nodeId, to: to.trim() }, signal })).data;

/** The operator's words for a refused decision: Magnus's message, and what the status means here. */
export function decisionErrorMessage(error: unknown): string {
  if (!(error instanceof MagnusApiError)) return error instanceof Error ? error.message : String(error);
  const said = error.message.replace(/[.\s]+$/u, '');
  if (error.status === 409) return `${said}. The node has a key by now, or the server runs in enforce mode: enroll it with a token instead.`;
  if (error.status === 410) return `${said}. The agent has not asked for seven days: enroll the node with a token instead.`;
  return error.message;
}

/** A 404 that is not about the node means this Magnus, or its ingress, has no downgrade check. */
export function downgradeErrorMessage(error: unknown): string {
  if (error instanceof MagnusApiError && error.notFound && !/node/iu.test(error.message)) return 'This Magnus does not answer the downgrade check. Read the rollback section of its NODE_CREDENTIALS.md before installing an older agent.';
  return error instanceof Error && error.message ? error.message : 'The check failed';
}
