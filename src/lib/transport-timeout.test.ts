import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiFetch, READ_TIMEOUT_MS, RequestTimeoutError, WRITE_TIMEOUT_MS } from './transport';

/** A product that never answers: the request settles only when its signal aborts. */
const hung = vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
  init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
}));
afterEach(() => {
  vi.useRealTimers();
  hung.mockClear();
});

describe('request deadlines', () => {
  it('fails a read with no answer after the read deadline, naming the wait and the request ID', async () => {
    vi.useFakeTimers();
    const send = createApiFetch(hung);
    const answer = send('/api/hivemem/v1/memories').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS - 1);
    expect(hung.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await answer;
    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect((error as Error).message).toBe('The product did not answer within 30 seconds. Try again in a moment.');
    expect((error as RequestTimeoutError).requestId).toMatch(/\S/);
  });

  it('gives a write the longer deadline', async () => {
    vi.useFakeTimers();
    const send = createApiFetch(hung);
    const answer = send('/api/hivemem/v1/memories', { method: 'POST', body: '{}' }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    expect(hung.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS - READ_TIMEOUT_MS);
    expect(await answer).toBeInstanceOf(RequestTimeoutError);
  });

  it('leaves a caller with its own signal, and uploads, to their own deadlines', async () => {
    const send = createApiFetch(async () => Response.json({}));
    const controller = new AbortController();
    const recorded = vi.fn<typeof fetch>(async () => Response.json({}));
    const watched = createApiFetch(recorded);
    await watched('/api/hivemem/v1/memories', { signal: controller.signal });
    expect(recorded.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    await watched('/api/hivemem/v1/upload', { method: 'POST', body: new Blob(['x']) });
    expect(recorded.mock.calls[1]?.[1]?.signal).toBeUndefined();
    expect((await send('/api/hivemem/v1/memories')).status).toBe(200);
  });

  it('never cuts off reading a body once the headers arrived', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const send = createApiFetch(async (_input, init) => {
      signal = init?.signal ?? undefined;
      return Response.json({});
    });
    await send('/api/hivemem/v1/memories');
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS * 2);
    expect(signal?.aborted).toBe(false);
  });
});
