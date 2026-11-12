// Embermend's browser API, over the shared transport. Embermend answers a refusal with a bare code
// ({error:"CODE"}), so the operator sees the message for its status and the code stays on the error.
import { hiveApiError, type HiveApiError } from '../../lib/api-error';
import { apiFetch } from '../../lib/transport';

export const EMBERMEND_API = '/api/embermend/api/v1/';

/** What the operator is told for a refusal with this status. */
export function embermendMessage(status: number): string {
  if (status === 403) return 'Your current access does not allow this action.';
  if (status === 409) return 'The recommendation or its execution conditions changed. Refresh and review the current revision.';
  return 'Embermend could not complete the request. Refresh to inspect the retained outcome before trying another action.';
}

export function embermendFailure(response: Response): Promise<HiveApiError> {
  return hiveApiError(response, { trustMessage: false, fallback: embermendMessage });
}

/** A GET without a body, a POST with one. Answers the parsed JSON; the caller validates it. */
export async function embermendRequest(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await apiFetch(EMBERMEND_API + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await embermendFailure(response);
  return response.json();
}
