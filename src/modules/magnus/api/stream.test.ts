import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccess } from '../../../lib/transport';
import { backoffDelay, openStream, type StreamState } from './stream';
import type { SseEvent } from './sse';

const encode = (text: string) => new TextEncoder().encode(text);
function eventStream(...frames: string[]) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encode(frame));
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}
function openForever(signal?: AbortSignal | null, frame = 'event: connected\ndata: {}\n\n') {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encode(frame));
      signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
    },
  }));
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function start(request: typeof fetch, extra: Partial<Parameters<typeof openStream>[0]> = {}) {
  const events: SseEvent[] = [];
  const states: StreamState[] = [];
  const handle = openStream({ path: '/events/stream', onEvent: (event) => events.push(event), onState: (state) => states.push(state), request, random: () => 1, ...extra });
  return { events, states, handle };
}

describe('backoff', () => {
  it('doubles to the ceiling, with jitter in the upper half', () => {
    expect([0, 1, 2, 3, 20].map((attempt) => backoffDelay(attempt, 1000, 60_000, () => 1))).toEqual([1000, 2000, 4000, 8000, 60_000]);
    expect(backoffDelay(3, 1000, 60_000, () => 0)).toBe(4000);
  });
});

describe('the fetch stream', () => {
  it('asks for the stream with fetch and delivers its events across chunks', async () => {
    const request = vi.fn<typeof fetch>().mockImplementationOnce(async () => eventStream('event: node:status\ndata: {"a"', ':1}\n\n')).mockImplementation(async (_path, init) => openForever(init?.signal));
    const { events, handle } = start(request);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([{ event: 'node:status', data: '{"a":1}' }]);
    expect(String(request.mock.calls[0]![0])).toBe('/api/magnus/events/stream');
    expect(new Headers(request.mock.calls[0]![1]!.headers).get('accept')).toBe('text/event-stream');
    handle.close();
  });
  it('reconnects after the server closes at token expiry, through apiFetch, so with a fresh token', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => eventStream('data: x\n\n'));
    const { handle } = start(request);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2100);
    expect(request.mock.calls.length).toBeGreaterThanOrEqual(2);
    handle.close();
  });
  it('backs off instead of hammering a failing API, and honors Retry-After', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response('down', { status: 503 }));
    const { handle } = start(request);
    await vi.advanceTimersByTimeAsync(60_000);
    // 2s, 4s, 8s, 16s, 32s: five retries in the first minute, not sixty.
    expect(request.mock.calls.length).toBeLessThanOrEqual(6);
    handle.close();
    const limited = vi.fn<typeof fetch>().mockImplementation(async () => new Response('', { status: 429, headers: { 'retry-after': '30' } }));
    const second = start(limited);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(limited).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1100);
    expect(limited).toHaveBeenCalledTimes(2);
    second.handle.close();
  });
  it('resets the backoff after a healthy connection', async () => {
    let call = 0;
    const request = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => {
      call += 1;
      return call === 1 ? new Response('', { status: 503 }) : call === 2 ? openForever(init?.signal) : eventStream();
    });
    const { handle } = start(request, { idleTimeoutMs: 40_000 });
    await vi.advanceTimersByTimeAsync(2100);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(40_000);
    await vi.advanceTimersByTimeAsync(1100);
    expect(request).toHaveBeenCalledTimes(3);
    handle.close();
  });
  it('treats a silent connection as dead', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => openForever(init?.signal));
    const { handle } = start(request, { idleTimeoutMs: 75_000 });
    await vi.advanceTimersByTimeAsync(74_000);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(request).toHaveBeenCalledTimes(2);
    handle.close();
  });
  it('stops and aborts on logout, and does not reconnect', async () => {
    let signal: AbortSignal | null | undefined;
    const request = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => {
      signal = init?.signal;
      return openForever(init?.signal);
    });
    const { states } = start(request);
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toContain('open');
    clearAccess();
    await vi.advanceTimersByTimeAsync(0);
    expect(signal?.aborted).toBe(true);
    expect(states.at(-1)).toBe('stopped');
    await vi.advanceTimersByTimeAsync(600_000);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('stops when closed, even while waiting to reconnect', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response('', { status: 500 }));
    const { handle, states } = start(request);
    await vi.advanceTimersByTimeAsync(10);
    handle.close();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe('stopped');
  });
  it.each([[403], [404]])('gives up on %i, which retrying cannot fix', async (status) => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response('', { status }));
    const { states } = start(request);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe('stopped');
  });
  it('stops after repeated 401s rather than looping forever', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response('', { status: 401 }));
    const { states } = start(request);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(request).toHaveBeenCalledTimes(3);
    expect(states.at(-1)).toBe('stopped');
  });
});
