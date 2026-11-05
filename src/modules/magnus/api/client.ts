// The module's API client, over the console's apiFetch. It replaces the old console's ky client and
// lib/api-client.ts. apiFetch attaches the Oathweave token and handles step-up: a safe read repeats
// once after verification, a mutation never does. This file adds no retry of its own.
import { z } from 'zod';
import { apiFetch } from '../../../lib/transport';
import { browserIdentity } from '../../../lib/runtime';
import { agentDisabledMessage, MagnusApiError, MagnusContractError } from './errors';
import { rateGate } from './rate-gate';

export const MAGNUS_API = '/api/magnus';
const READ_TIMEOUT_MS = 30_000;
const WRITE_TIMEOUT_MS = 120_000;

export type Query = Record<string, string | number | boolean | undefined | null>;
export interface RequestOptions {
  query?: Query | undefined;
  signal?: AbortSignal | undefined;
  /** Sent as x-idempotency-key, which POST /commands requires. Create it with idempotencyKey(). */
  idempotencyKey?: string | undefined;
  timeoutMs?: number | undefined;
}
export interface WriteOptions extends RequestOptions {
  body?: unknown;
}

/** Encode one value for a path: `/nodes/${segment(id)}`. */
export const segment = (value: string): string => encodeURIComponent(value);
/** Random, without crypto.randomUUID, which is missing outside a secure context. */
export const randomId = (): string => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
export const idempotencyKey = randomId;

export function apiPath(path: string, query?: Query): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith(MAGNUS_API)) throw new Error('Magnus paths are relative to /api/v1 and start with /');
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== null) search.set(key, String(value));
  const text = search.toString();
  return MAGNUS_API + path + (text ? (path.includes('?') ? '&' : '?') + text : '');
}

let authExpired: (() => void) | undefined;
/** The module's mount registers the shell's sign-out here. */
export const setAuthExpiredHandler = (handler: (() => void) | undefined): void => {
  authExpired = handler;
};
/** A 401 means this session may be gone. Sign out only if Oathweave agrees, as the shell's store does. */
export async function handleUnauthorized(): Promise<void> {
  const identity = browserIdentity();
  try {
    if (identity) await identity.me();
    else authExpired?.();
  } catch {
    authExpired?.();
  }
}

async function failure(response: Response): Promise<MagnusApiError> {
  if (response.status === 401) void handleUnauthorized();
  const body: unknown = await response.clone().json().catch(() => null);
  const disabled = agentDisabledMessage(body);
  if (disabled) return new MagnusApiError(response.status, disabled, 'AGENT_NOT_PRIVILEGED');
  const shape = z.object({
    message: z.string().optional(),
    error: z.union([z.string(), z.object({ code: z.string().optional(), message: z.string().optional() })]).optional(),
  }).safeParse(body);
  const parsed = shape.success ? shape.data : {};
  const inner = typeof parsed.error === 'object' ? parsed.error : undefined;
  const code = inner?.code ?? (typeof parsed.error === 'string' ? parsed.error : undefined);
  const text = inner?.message ?? parsed.message ?? (typeof parsed.error === 'string' && !/^[A-Z_]+$/.test(parsed.error) ? parsed.error : undefined);
  const fallback = response.status === 401 ? 'Sign in again to continue' : response.status === 403 ? 'Your Magnus role does not allow this' : response.status === 429 ? 'Too many requests. Wait a moment and try again.' : response.status >= 500 ? 'The Magnus API could not complete this request' : 'The request was rejected';
  return new MagnusApiError(response.status, text ?? fallback, code);
}

async function call<S extends z.ZodType>(method: string, path: string, schema: S, options: WriteOptions = {}): Promise<z.output<S>> {
  const mutation = method !== 'GET';
  await rateGate(path, options.signal);
  const headers = new Headers({ Accept: 'application/json' });
  headers.set('x-trace-id', randomId());
  if (options.idempotencyKey) headers.set('x-idempotency-key', options.idempotencyKey);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const timeout = AbortSignal.timeout(options.timeoutMs ?? (mutation ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS));
  const response = await apiFetch(apiPath(path, options.query), {
    method,
    headers,
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!response.ok) throw await failure(response);
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // Field names only: a response can hold data that must not reach the console.
    console.warn(`Magnus response for ${method} ${path} failed its contract:`, parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.')}: ${issue.code}`));
    throw new MagnusContractError(path, mutation);
  }
  return parsed.data;
}

/**
 * Every call names the response schema: from @contracts/magnus/browser where one exists, otherwise a
 * local zod schema in the page's directory. Paths are relative to /api/v1.
 */
export const magnus = {
  get: <S extends z.ZodType>(path: string, schema: S, options?: RequestOptions) => call('GET', path, schema, options),
  post: <S extends z.ZodType>(path: string, schema: S, options?: WriteOptions) => call('POST', path, schema, options),
  patch: <S extends z.ZodType>(path: string, schema: S, options?: WriteOptions) => call('PATCH', path, schema, options),
  put: <S extends z.ZodType>(path: string, schema: S, options?: WriteOptions) => call('PUT', path, schema, options),
  delete: <S extends z.ZodType>(path: string, schema: S, options?: WriteOptions) => call('DELETE', path, schema, options),
};
