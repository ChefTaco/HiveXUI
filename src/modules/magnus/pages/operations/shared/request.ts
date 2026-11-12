// A POST whose failure status still carries the result. POST /files/update answers 502 with its task
// list when every task failed, and POST /webhooks/:id/test answers 502 with the reason. magnus.post
// keeps only a message, which would lose both. Sent once, and never repeated: apiFetch answers a
// mutation's step-up with RETRY_AFTER_STEP_UP, and the operator submits again.
import { z } from 'zod';
import { apiFetch } from '../../../../../lib/transport';
import { apiFailureFromBody } from '../../../../../lib/api-error';
import { apiPath, handleUnauthorized, magnusFallback, magnusFailure, randomId } from '../../../api/client';
import { MagnusContractError, type MagnusApiError } from '../../../api/errors';

const WRITE_TIMEOUT_MS = 120_000;

export function failureFromBody(status: number, body: unknown, response?: Response): MagnusApiError {
  return magnusFailure(apiFailureFromBody(status, body, { fallback: magnusFallback, response }));
}

/** Returns the parsed body for a success, and for a failure whose body matches the schema. Otherwise throws. */
export async function postKeepingBody<S extends z.ZodType>(path: string, schema: S, body?: unknown): Promise<z.output<S>> {
  const headers = new Headers({ Accept: 'application/json', 'x-trace-id': randomId() });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await apiFetch(apiPath(path), {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 401) void handleUnauthorized();
  const parsedBody: unknown = await response.json().catch(() => undefined);
  const parsed = schema.safeParse(parsedBody);
  if (parsed.success) return parsed.data;
  if (!response.ok) throw failureFromBody(response.status, parsedBody, response);
  throw new MagnusContractError(path, true);
}
