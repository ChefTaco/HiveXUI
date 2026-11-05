// A POST whose failure status still carries the result. POST /files/update answers 502 with its task
// list when every task failed, and POST /webhooks/:id/test answers 502 with the reason. magnus.post
// keeps only a message, which would lose both. Sent once, and never repeated: apiFetch answers a
// mutation's step-up with RETRY_AFTER_STEP_UP, and the operator submits again.
import { z } from 'zod';
import { apiFetch } from '../../../../../lib/transport';
import { apiPath, handleUnauthorized, randomId } from '../../../api/client';
import { agentDisabledMessage, MagnusApiError, MagnusContractError } from '../../../api/errors';

const WRITE_TIMEOUT_MS = 120_000;
const failureShape = z.object({
  message: z.string().optional(),
  error: z.union([z.string(), z.object({ code: z.string().optional(), message: z.string().optional() })]).optional(),
});

export function failureFromBody(status: number, body: unknown): MagnusApiError {
  const disabled = agentDisabledMessage(body);
  if (disabled) return new MagnusApiError(status, disabled, 'AGENT_NOT_PRIVILEGED');
  const shape = failureShape.safeParse(body);
  const parsed = shape.success ? shape.data : {};
  const inner = typeof parsed.error === 'object' ? parsed.error : undefined;
  const code = inner?.code ?? (typeof parsed.error === 'string' ? parsed.error : undefined);
  const text = inner?.message ?? parsed.message ?? (typeof parsed.error === 'string' && !/^[A-Z_]+$/.test(parsed.error) ? parsed.error : undefined);
  const fallback = status === 401 ? 'Sign in again to continue' : status === 403 ? 'Your Magnus role does not allow this' : status === 429 ? 'Too many requests. Wait a moment and try again.' : status >= 500 ? 'The Magnus API could not complete this request' : 'The request was rejected';
  return new MagnusApiError(status, text ?? fallback, code);
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
  if (!response.ok) throw failureFromBody(response.status, parsedBody);
  throw new MagnusContractError(path, true);
}
