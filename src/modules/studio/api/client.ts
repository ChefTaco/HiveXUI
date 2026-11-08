// The Studio service's browser API, over the console's apiFetch, which attaches the Oathweave token
// for product ardentstudio. Paths and shapes come from the vendored contract
// (@contracts/ardentstudio.generated); every answer is parsed with its schema before a page sees it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  ARDENT_STUDIO_API_PREFIX,
  errorResponseSchema,
  IDEMPOTENCY_HEADER,
  readyResponseSchema,
} from '@contracts/ardentstudio.generated';
import { apiFetch } from '../../../lib/transport';
import { handleUnauthorized, randomId } from '../../magnus/api/client';

export const STUDIO_API = ARDENT_STUDIO_API_PREFIX;
const PROBE_TIMEOUT_MS = 5000;
const READ_TIMEOUT_MS = 30_000;
const WRITE_TIMEOUT_MS = 120_000;
/** Uploads go up to 64 MiB, which takes a while on a slow link. */
const UPLOAD_TIMEOUT_MS = 15 * 60_000;
/** How often the top bar re-checks while the tab is visible. */
export const PROBE_INTERVAL_MS = 30_000;

export type StudioConnection =
  | { state: 'checking' }
  /** `degraded` names the dependencies the service reports down while it still serves projects. */
  | { state: 'ready'; degraded: readonly string[] }
  | { state: 'denied' | 'unavailable'; message: string };

const DEPENDENCY: Record<string, string> = {
  magnus: 'Magnus is unavailable: agents cannot be listed or reached.',
  hivemem: 'HiveMem unavailable: references are stored but not searchable by agents.',
  agents: 'No Ardent agent is available right now.',
};

/** Never rejects: every failure is a state the page explains. */
export async function probeStudio(signal?: AbortSignal, send: typeof apiFetch = apiFetch): Promise<StudioConnection> {
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  try {
    const response = await send(`${STUDIO_API}/health/ready`, {
      headers: { Accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (response.status === 401 || response.status === 403)
      return { state: 'denied', message: 'This identity is not allowed to use Ardent Project Studio.' };
    // A page served in the service's place is not an answer from it.
    const json = (response.headers.get('content-type') ?? '').includes('application/json');
    const body = json ? readyResponseSchema.safeParse(await response.json().catch(() => null)) : null;
    // Not ready still serves projects when only a dependency is down; without its database it serves nothing.
    if (body?.success && body.data.checks.database.status === 'ok') {
      const { checks } = body.data;
      const degraded = (['magnus', 'hivemem', 'agents'] as const).filter((name) => checks[name].status !== 'ok').map((name) => DEPENDENCY[name]!);
      return { state: 'ready', degraded };
    }
    return { state: 'unavailable', message: `The Studio service did not pass its readiness check (HTTP ${response.status}).` };
  } catch {
    return { state: 'unavailable', message: 'The Studio service could not be reached.' };
  }
}

/** The connection the top bar shows and every page reads, re-checked on a timer and on Retry. */
export function useStudioConnection(probe: typeof probeStudio = probeStudio): { connection: StudioConnection; retry: () => void } {
  const [connection, setConnection] = useState<StudioConnection>({ state: 'checking' });
  const controller = useRef<AbortController | null>(null);
  const check = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const next = await probe(current.signal);
    if (!current.signal.aborted) setConnection(next);
  }, [probe]);
  useEffect(() => {
    void check();
    const timer = setInterval(() => {
      if (!document.hidden) void check();
    }, PROBE_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      controller.current?.abort();
    };
  }, [check]);
  const retry = useCallback(() => {
    setConnection({ state: 'checking' });
    void check();
  }, [check]);
  return { connection, retry };
}

/** A non-success answer from the Studio service. `message` is written for the operator. */
export class StudioApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    /** The service's `error.details`, such as the active tasks that block an archive. */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'StudioApiError';
  }
  get notFound(): boolean {
    return this.status === 404;
  }
  get conflict(): boolean {
    return this.status === 409;
  }
}

/** A 2xx answer that does not match the vendored contract. Nothing from it is shown. */
export class StudioContractError extends Error {
  constructor(readonly applied: boolean) {
    super(applied ? 'The change was applied, but its result could not be read. Refresh to confirm.' : 'The Studio service answered in an unexpected format.');
    this.name = 'StudioContractError';
  }
}

export type Query = Record<string, string | number | boolean | undefined | null>;

/** `/projects/{id}` relative to the API prefix, with each value encoded, plus a query. */
export function studioPath(path: string, query?: Query): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith(STUDIO_API)) throw new Error('Studio paths are relative to the API prefix and start with /');
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  const text = search.toString();
  return STUDIO_API + path + (text ? '?' + text : '');
}
export const segment = (value: string): string => encodeURIComponent(value);

/** A fresh key per user action; a repeated request with the same key replays the first answer. */
export const idempotencyKey = (): string => `hivexui-${randomId()}`;

const FALLBACK: Record<number, string> = {
  401: 'Sign in again to continue',
  403: 'This identity is not allowed to do this in Ardent Project Studio',
  404: 'Not found',
  409: 'This changed elsewhere, or is not allowed in its current state',
  413: 'The file is larger than the Studio service accepts',
  415: 'The Studio service does not accept this file type',
  429: 'Too many requests. Wait a moment and try again.',
};

/** The error for a non-success answer, read from its body. */
export async function studioFailure(response: Response): Promise<StudioApiError> {
  if (response.status === 401) void handleUnauthorized();
  const parsed = errorResponseSchema.safeParse(await response.json().catch(() => null));
  const error = parsed.success ? parsed.data.error : undefined;
  const message = error?.message ?? FALLBACK[response.status] ?? (response.status >= 500 ? 'The Studio service could not complete this request' : 'The request was rejected');
  return new StudioApiError(response.status, message, error?.code, error?.details);
}

export interface RequestOptions {
  query?: Query | undefined;
  signal?: AbortSignal | undefined;
}
export interface WriteOptions extends RequestOptions {
  body?: unknown;
  /** One per user action, so a retried click cannot create twice. Defaults to a new key. */
  idempotencyKey?: string | undefined;
}

async function call<S extends z.ZodType>(method: string, path: string, schema: S, options: WriteOptions & { raw?: Blob; contentType?: string; timeoutMs?: number } = {}): Promise<z.output<S>> {
  const mutation = method !== 'GET';
  const headers = new Headers({ Accept: 'application/json', 'x-trace-id': randomId() });
  if (mutation) headers.set(IDEMPOTENCY_HEADER, options.idempotencyKey ?? idempotencyKey());
  let body: BodyInit | undefined;
  if (options.raw) {
    headers.set('Content-Type', options.contentType ?? 'application/octet-stream');
    body = options.raw;
  } else if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }
  const timeout = AbortSignal.timeout(options.timeoutMs ?? (mutation ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS));
  const response = await apiFetch(studioPath(path, options.query), {
    method,
    headers,
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    ...(body !== undefined ? { body } : {}),
  });
  if (!response.ok) throw await studioFailure(response);
  const parsed = schema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) {
    // Field names only: a response can hold data that must not reach the console.
    console.warn(`Studio response for ${method} ${path} failed its contract:`, parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.')}: ${issue.code}`));
    throw new StudioContractError(mutation);
  }
  return parsed.data;
}

export const studio = {
  get: <S extends z.ZodType>(path: string, schema: S, options?: RequestOptions) => call('GET', path, schema, options),
  post: <S extends z.ZodType>(path: string, schema: S, options?: WriteOptions) => call('POST', path, schema, options),
  patch: <S extends z.ZodType>(path: string, schema: S, options?: WriteOptions) => call('PATCH', path, schema, options),
  put: <S extends z.ZodType>(path: string, schema: S, options?: WriteOptions) => call('PUT', path, schema, options),
  delete: <S extends z.ZodType>(path: string, schema: S, options?: WriteOptions) => call('DELETE', path, schema, options),
  /** The raw body with its MIME type, as the files route takes it. */
  upload: <S extends z.ZodType>(path: string, schema: S, file: Blob, contentType: string, options?: WriteOptions) =>
    call('POST', path, schema, { ...options, raw: file, contentType, timeoutMs: UPLOAD_TIMEOUT_MS }),
};
