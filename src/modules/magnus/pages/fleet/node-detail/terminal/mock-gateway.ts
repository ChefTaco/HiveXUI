// A test double of the fleet gateway's browser API, to the shapes in its README: strict bodies, bearer
// only, no option in a URL but sessionId, 16 KiB of input. Tests only; nothing in the console imports it.
export interface MockCall {
  verb: string;
  method: string;
  url: string;
  body: Record<string, unknown> | null;
  authorization: string | null;
  credentials: RequestCredentials | undefined;
}
type Answer = Response | Promise<Response> | null;
const refuse = (status: number, error: string, message = 'Refused.', extra: object = {}) => Response.json({ error, message, ...extra }, { status });

export function mockGateway() {
  const calls: MockCall[] = [];
  const streams: Array<{ controller: ReadableStreamDefaultController<Uint8Array>; signal: AbortSignal | null | undefined }> = [];
  const state = {
    status: { state: 'open', nodeId: 'node-1', idleDeadline: '2026-11-05T12:00:00.000Z', expiresAt: '2026-11-05T13:00:00.000Z' } as object,
    sessions: 0,
    /** Answer a verb in the test's own way. Return null to fall through. */
    override: null as ((call: MockCall) => Answer) | null,
  };
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    const parsed = new URL(url, 'https://console.example.com');
    const verb = parsed.pathname.split('/').pop() ?? '';
    const authorization = new Headers(init?.headers).get('authorization');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null;
    const call: MockCall = { verb, method: init?.method ?? 'GET', url, body, authorization, credentials: init?.credentials };
    calls.push(call);
    const custom = state.override?.(call);
    if (custom) return custom;
    if (!authorization?.startsWith('Bearer ')) return refuse(401, 'UNAUTHORIZED');
    const keys = [...parsed.searchParams.keys()];
    if (call.method === 'POST' ? keys.length > 0 : keys.some((key) => key !== 'sessionId')) return refuse(400, 'CREDENTIAL_IN_URL');
    const fields = Object.keys(body ?? {}).sort().join();
    switch (verb) {
      case 'open':
        if (fields !== 'cols,nodeId,rows') return refuse(400, 'INVALID_REQUEST');
        state.sessions += 1;
        return Response.json({ sessionId: `session-${state.sessions}`, nodeId: body!.nodeId, openedAt: '2026-11-05T12:00:00.000Z', expiresAt: '2026-11-05T13:00:00.000Z', idleTimeoutSeconds: 900, maxLifetimeSeconds: 3600 }, { status: 201 });
      case 'input':
        if (fields !== 'data,sessionId' || !body!.data) return refuse(400, 'INVALID_REQUEST');
        if (new TextEncoder().encode(String(body!.data)).byteLength > 16 * 1024) return refuse(413, 'PAYLOAD_TOO_LARGE');
        return Response.json({ ok: true });
      case 'resize':
        return fields === 'cols,rows,sessionId' ? Response.json({ ok: true }) : refuse(400, 'INVALID_REQUEST');
      case 'renew':
        return Response.json({ ok: true, tokenExpiresAt: '2026-11-05T12:15:00.000Z' });
      case 'close':
        return Response.json({ ok: true });
      case 'status':
        return Response.json(state.status);
      case 'stream': {
        const stream = new ReadableStream<Uint8Array>({ start: (controller) => { streams.push({ controller, signal: init?.signal }); } });
        init?.signal?.addEventListener('abort', () => {
          try { streams.at(-1)?.controller.error(new DOMException('Aborted', 'AbortError')); } catch { /* it had ended */ }
        });
        return new Response(stream, { headers: { 'Content-Type': 'application/octet-stream' } });
      }
      default:
        return refuse(404, 'NOT_FOUND');
    }
  };
  return {
    request,
    calls,
    state,
    streams,
    of: (verb: string) => calls.filter((call) => call.verb === verb),
    emit: (text: string) => streams.at(-1)!.controller.enqueue(new TextEncoder().encode(text)),
    endStream: () => streams.at(-1)!.controller.close(),
    dropStream: () => streams.at(-1)!.controller.error(new TypeError('network error')),
  };
}
export { refuse as gatewayRefusal };
