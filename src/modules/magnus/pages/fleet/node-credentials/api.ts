// Per-node credentials (Magnus docs/NODE_CREDENTIALS.md), over the routes Magnus publishes to the browser.
// Since Magnus c158e8c an ADMIN lists, revokes and resets a node's keys in the browser. Issuing an
// enrollment token is still not a browser route (its answer is a secret): model.ts shows its CLI steps.
import { z } from 'zod';
import {
  nodeCredentialDowngradeCheckResponseSchema,
  nodeCredentialFleetSummaryResponseSchema,
  nodeCredentialResetResponseSchema,
  nodeCredentialRevokeResponseSchema,
  nodeCredentialSchema,
  nodeCredentialsResponseSchema,
  pendingBindingDecisionResponseSchema,
  pendingBindingsResponseSchema,
} from '@contracts/magnus/browser';
import { magnus, segment } from '../../../api/client';
import { MagnusApiError, MagnusContractError } from '../../../api/errors';

export type NodeCredential = z.output<typeof nodeCredentialSchema>;
export type CredentialSummary = z.output<typeof nodeCredentialFleetSummaryResponseSchema>['data'];
export type EnforceBlocker = CredentialSummary['blockers'][number];
export type PendingBinding = z.output<typeof pendingBindingsResponseSchema>['data'][number];
export type DowngradeCheck = z.output<typeof nodeCredentialDowngradeCheckResponseSchema>['data'];
export type NodeKey = z.output<typeof nodeCredentialsResponseSchema>['data'][number];
export type RevokeResult = z.output<typeof nodeCredentialRevokeResponseSchema>['data'];
export type ResetResult = z.output<typeof nodeCredentialResetResponseSchema>['data'];

/** Magnus takes a reason of 1 to 500 characters after trimming, for the audit log. */
export const REASON_MAX = 500;
/** The reason to send: trimmed, cut to the limit, and left out when empty. */
export function reasonBody(reason: string | undefined): { reason?: string } {
  const trimmed = reason?.trim().slice(0, REASON_MAX).trim();
  return trimmed ? { reason: trimmed } : {};
}

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
  return (await magnus.post(`/node-credentials/pending-bindings/${segment(id)}/reject`, pendingBindingDecisionResponseSchema, { body: reasonBody(reason) })).data;
}

/**
 * Every key of the node, newest first (ADMIN). Null when this Magnus, or its ingress, does not offer the
 * route to the browser: the card then shows the CLI steps instead, as before.
 */
export const listNodeKeys = (nodeId: string, signal?: AbortSignal): Promise<NodeKey[] | null> =>
  unlessMissing(magnus.get(`/nodes/${segment(nodeId)}/credentials`, nodeCredentialsResponseSchema, { signal }).then(({ data }) => data));

/** One confirmed action: the reason for the audit log, and the idempotency key made when it was confirmed. */
export interface KeyAction {
  reason?: string | undefined;
  idempotencyKey: string;
}

/** Revoke every valid key of the node (ADMIN). Its agent is refused until it is enrolled again or reset. */
export const revokeNodeKeys = async (nodeId: string, action: KeyAction): Promise<RevokeResult> =>
  (await magnus.post(`/nodes/${segment(nodeId)}/credentials/revoke`, nodeCredentialRevokeResponseSchema, { body: reasonBody(action.reason), idempotencyKey: action.idempotencyKey })).data;

/** Forget the node's keys, so Magnus accepts the shared secret from it again (ADMIN). Refused in enforce mode. */
export const resetNodeKeys = async (nodeId: string, action: KeyAction): Promise<ResetResult> =>
  (await magnus.post(`/nodes/${segment(nodeId)}/credentials/reset`, nodeCredentialResetResponseSchema, { body: reasonBody(action.reason), idempotencyKey: action.idempotencyKey })).data;

/** The operator's words for a refused revoke or reset, from Magnus's error code. */
export function keyActionErrorMessage(error: unknown, kind: 'revoke' | 'reset'): string {
  if (error instanceof MagnusContractError) return error.message;
  if (!(error instanceof MagnusApiError)) return error instanceof Error && error.message ? error.message : String(error);
  switch (error.code) {
    case 'NODE_CREDENTIAL_NOT_FOUND':
      return 'The node has no valid key left to revoke. The list below is read again.';
    case 'NOT_FOUND':
      return 'Magnus has no such node any more. It may have been deleted.';
    case 'NODE_AUTH_ENFORCED':
      return 'The server runs NODE_AUTH_MODE=enforce, which has no credential reset. Keep an agent of 2.10.0 or later on the node, or enroll it again with a token.';
    case 'DUPLICATE_REQUEST':
      return 'Magnus already took this request. Read the node again to see its result.';
    case 'VALIDATION_ERROR':
      return `Magnus refused the request: ${error.message.replace(/[.\s]+$/u, '')}. A reason is 1 to 500 characters.`;
    case 'FORBIDDEN':
      return `Only a Magnus administrator can ${kind} a node's keys.`;
    default:
      if (error.notFound) return `This Magnus does not offer ${kind === 'revoke' ? 'revoking' : 'resetting'} keys in the UI. Use the API steps under "Manage this node's key".`;
      if (error.forbidden) return `Only a Magnus administrator can ${kind} a node's keys.`;
      return error.message;
  }
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
