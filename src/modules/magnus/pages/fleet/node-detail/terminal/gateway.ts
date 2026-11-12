// The fleet gateway's browser API. Every call goes through the console's transport, so it carries a
// current bearer token in its header, sends no cookies, and answers step-up as any other mutation
// does: the operator is asked, and nothing is replayed. Nothing here logs a request or a response,
// because both hold what a person typed or what a node printed.
import { z } from 'zod';
import { failureMeta, readApiFailure, type HiveApiErrorMeta } from '../../../../../../lib/api-error';
import { createApiFetch } from '../../../../../../lib/transport';
import { apiPath, handleUnauthorized } from '../../../../api/client';
import { MagnusApiError, MagnusContractError } from '../../../../api/errors';

export interface TerminalSize {
  cols: number;
  rows: number;
}

const CONTROL_TIMEOUT_MS = 30_000;
/** Opening runs an SSH handshake and two audit writes, so it may take a while. */
const OPEN_TIMEOUT_MS = 120_000;
const SIZE_LIMITS = { cols: 500, rows: 200 };

const openedSchema = z.object({
  sessionId: z.string().min(1),
  nodeId: z.string(),
  openedAt: z.string(),
  expiresAt: z.string(),
  idleTimeoutSeconds: z.number(),
  maxLifetimeSeconds: z.number(),
});
export type OpenedTerminal = z.output<typeof openedSchema>;
const okSchema = z.object({ ok: z.literal(true) });
const renewedSchema = okSchema.extend({ tokenExpiresAt: z.string() });
const statusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('open'), nodeId: z.string(), idleDeadline: z.string(), expiresAt: z.string() }),
  z.object({ state: z.literal('ended'), reason: z.string() }),
]);
export type TerminalStatus = z.output<typeof statusSchema>;
const refusalSchema = z.object({ error: z.string().optional(), message: z.string().optional(), reason: z.string().optional() });

/** A refusal: its code decides what the panel says, and the code from RESOURCE_ADMISSION_REFUSED is kept. */
export class TerminalRefusal extends MagnusApiError {
  override name = 'TerminalRefusal';
  constructor(status: number, message: string, code: string | undefined, readonly reason: string | undefined, meta: HiveApiErrorMeta = {}) {
    super(status, message, code, undefined, meta);
  }
}

const clamp = (value: number, limit: number): number => Math.min(limit, Math.max(1, Math.floor(value) || 1));
export const clampSize = ({ cols, rows }: TerminalSize): TerminalSize => ({ cols: clamp(cols, SIZE_LIMITS.cols), rows: clamp(rows, SIZE_LIMITS.rows) });

export type TerminalGateway = ReturnType<typeof createTerminalGateway>;

export function createTerminalGateway(request: typeof fetch = (input, init) => fetch(input, init)) {
  // The transport drops its token before it tells anyone about a sign-out, so closing a shell at that
  // moment needs the one this session last sent. It lives only as long as this session's closure.
  let lastSent: { url: string; authorization: string } | null = null;
  const send = createApiFetch((input, init) => {
    const authorization = new Headers(init?.headers).get('authorization');
    if (authorization && typeof input === 'string') lastSent = { url: input.replace(/\/terminal\/[a-z]+(\?.*)?$/, '/terminal/close'), authorization };
    return request(input, init);
  });

  async function refusal(response: Response): Promise<TerminalRefusal> {
    if (response.status === 401) void handleUnauthorized();
    const failure = await readApiFailure(response, { fallback: 'The fleet gateway refused this request.' });
    const parsed = refusalSchema.safeParse(failure.body);
    const body = parsed.success ? parsed.data : {};
    return new TerminalRefusal(response.status, body.message ?? 'The fleet gateway refused this request.', body.error, body.reason, failureMeta(failure));
  }

  async function post<S extends z.ZodType>(verb: string, schema: S, body: unknown, options: { timeoutMs?: number; keepalive?: boolean } = {}): Promise<z.output<S>> {
    const path = `/terminal/${verb}`;
    const response = await send(apiPath(path), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? CONTROL_TIMEOUT_MS),
      ...(options.keepalive ? { keepalive: true } : {}),
    });
    if (!response.ok) throw await refusal(response);
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new MagnusContractError(path, true);
    return parsed.data;
  }

  return {
    /** Never repeated. A step-up answer here means the operator opens again. */
    open: (nodeId: string, size: TerminalSize) => post('open', openedSchema, { nodeId, ...clampSize(size) }, { timeoutMs: OPEN_TIMEOUT_MS }),
    input: (sessionId: string, data: string) => post('input', okSchema, { sessionId, data }),
    resize: (sessionId: string, size: TerminalSize) => post('resize', okSchema, { sessionId, ...clampSize(size) }),
    renew: (sessionId: string) => post('renew', renewedSchema, { sessionId }),
    close: (sessionId: string) => post('close', okSchema, { sessionId }, { keepalive: true }),
    async status(sessionId: string): Promise<TerminalStatus> {
      const path = '/terminal/status';
      const response = await send(apiPath(path, { sessionId }), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS) });
      if (!response.ok) throw await refusal(response);
      const parsed = statusSchema.safeParse(await response.json().catch(() => undefined));
      if (!parsed.success) throw new MagnusContractError(path, false);
      return parsed.data;
    },
    /** Raw bytes as the node wrote them. A newer reader replaces an older one, so this holds one. */
    async stream(sessionId: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
      const response = await send(apiPath('/terminal/stream', { sessionId }), { headers: { Accept: 'application/octet-stream' }, signal });
      if (!response.ok) throw await refusal(response);
      if (!response.body) throw new MagnusContractError('/terminal/stream', false);
      return response.body;
    },
    /**
     * Close with the token this session last sent, for when the transport no longer holds one: a
     * sign-out, or a page going away, where there is no time to mint another. Best effort.
     */
    closeNow(sessionId: string): void {
      if (!lastSent) return;
      void request(lastSent.url, {
        method: 'POST',
        headers: { Authorization: lastSent.authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
        credentials: 'omit',
        redirect: 'error',
        keepalive: true,
      }).catch(() => undefined);
    },
    forget(): void {
      lastSent = null;
    },
  };
}
