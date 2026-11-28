import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SseEvent } from '@hivemagnus/hive-common/sse';
import { clearAccess } from '../../../lib/transport';
import { openStream, type StreamState } from './stream';

const unauthorized = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('./client', async (importOriginal) => ({ ...(await importOriginal<typeof import('./client')>()), handleUnauthorized: unauthorized }));

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
beforeEach(() => {
  vi.useFakeTimers();
  // The upper end of the jitter, so the waits are exact.
  vi.spyOn(Math, 'random').mockReturnValue(1);
  unauthorized.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function start(request: typeof fetch, extra: Partial<Parameters<typeof openStream>[0]> = {}) {
  const events: SseEvent[] = [];
  const states: StreamState[] = [];
  const details: Array<string | undefined> = [];
  const handle = openStream({ path: '/events/stream', onEvent: (event) => events.push(event), onState: (state, detail) => { states.push(state); details.push(detail); }, request, ...extra });
  return { events, states, details, handle };
}

describe('backoff', () => {
  it('doubles to the ceiling, with jitter in the upper half', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response('', { status: 503 }));
    const { details, handle } = start(request, { maxDelayMs: 8000 });
    await vi.advanceTimersByTimeAsync(2000 + 4000 + 8000 + 8000 + 1);
    expect(details.filter((detail) => detail?.startsWith('Reconnecting'))).toEqual(['Reconnecting in 2s', 'Reconnecting in 4s', 'Reconnecting in 8s', 'Reconnecting in 8s', 'Reconnecting in 8s']);
    handle.close();
    vi.mocked(Math.random).mockReturnValue(0);
    const low = start(request, { maxDelayMs: 8000 });
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 1);
    expect(low.details.filter((detail) => detail?.startsWith('Reconnecting'))).toEqual(['Reconnecting in 1s', 'Reconnecting in 2s', 'Reconnecting in 4s']);
    low.handle.close();
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
    const { states, details } = start(request);
    await vi.advanceTimersByTimeAsync(600_000);
    // One renewal through handleUnauthorized, then a 401 on the renewed connection ends it.
    expect(unauthorized).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toBe('stopped');
    expect(details.at(-1)).toBe('Sign in again to receive live updates');
  });
  it('renews after a 401 and keeps following, renewing again after a later one', async () => {
    let call = 0;
    const request = vi.fn<typeof fetch>().mockImplementation(async () => {
      call += 1;
      return call === 1 || call === 3 ? new Response('', { status: 401 }) : eventStream('data: x\n\n');
    });
    const { states, events, handle } = start(request);
    await vi.advanceTimersByTimeAsync(5000);
    expect(unauthorized).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(states).not.toContain('stopped');
    handle.close();
  });
  it('reports connecting, open and retrying with the wait, and connecting again', async () => {
    let call = 0;
    const request = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => {
      call += 1;
      return call === 1 ? new Response('', { status: 503 }) : call === 2 ? eventStream('data: x\n\n') : openForever(init?.signal);
    });
    const { states, details, handle } = start(request);
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual(['connecting', 'retrying']);
    expect(details[1]).toBe('Reconnecting in 2s');
    await vi.advanceTimersByTimeAsync(2000);
    // A connection that delivered an event and closed reconnects without backoff, but never
    // sooner than minDelayMs after the previous connection started.
    expect(states).toEqual(['connecting', 'retrying', 'connecting', 'open', 'retrying', 'connecting']);
    expect(details[4]).toBe('Reconnecting in 1s');
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenCalledTimes(3);
    expect(states.slice(6)).toEqual(['open']);
    handle.close();
    expect(states.at(-1)).toBe('stopped');
  });
  it.each([
    [403, 'Your Magnus role does not allow this stream'],
    [404, 'This stream is not available'],
  ])('stops on %i with the reason', async (status, reason) => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response('', { status }));
    const { states, details } = start(request);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['connecting', 'stopped']);
    expect(details.at(-1)).toBe(reason);
    expect(unauthorized).not.toHaveBeenCalled();
  });
  it('shows the page\'s own message for a refused stream', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response('', { status: 403 }));
    const { details } = start(request, { deniedMessage: 'This identity may not read this project' });
    await vi.advanceTimersByTimeAsync(0);
    expect(details.at(-1)).toBe('This identity may not read this project');
  });
  it('reads events up to 4 MiB, the limit Ardent Studio uses for the same streams, and stops above it', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024);
    const request = vi.fn<typeof fetch>().mockImplementationOnce(async () => eventStream(`event: task:output\ndata: ${big}\n\n`)).mockImplementation(async (_path, init) => openForever(init?.signal));
    const { events, handle } = start(request);
    await vi.advanceTimersByTimeAsync(0);
    expect(events[0]?.data.length).toBe(big.length);
    handle.close();
    const tooBig = vi.fn<typeof fetch>().mockImplementation(async () => eventStream(`data: ${'y'.repeat(4 * 1024 * 1024)}\n\n`));
    const refused = start(tooBig);
    await vi.advanceTimersByTimeAsync(0);
    expect(refused.events).toEqual([]);
    expect(refused.details.at(-1)).toBe('The stream sent an event too large to read');
    refused.handle.close();
  });
  it('keeps the stream when a page handler throws on one event', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const request = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => openForever(init?.signal, 'event: bad\ndata: 1\n\nevent: good\ndata: 2\n\n'));
    const seen: string[] = [];
    const states: StreamState[] = [];
    const handle = openStream({ path: '/events/stream', request, onState: (state) => states.push(state), onEvent: (event) => {
      if (event.event === 'bad') throw new Error('render failed');
      seen.push(event.event);
    } });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seen).toEqual(['good']);
    expect(request).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['connecting', 'open']);
    handle.close();
  });
  it('reads url() for every connection, sends the trace headers and no Last-Event-ID', async () => {
    let cursor = 4;
    const request = vi.fn<typeof fetch>().mockImplementation(async () => eventStream('id: 9\ndata: x\n\n'));
    const { handle } = start(request, { url: () => `/api/ardentstudio/v1/projects/p1/stream?after=${cursor}` });
    await vi.advanceTimersByTimeAsync(0);
    cursor = 7;
    await vi.advanceTimersByTimeAsync(1000);
    handle.close();
    expect(request.mock.calls.map(([path]) => String(path))).toEqual(['/api/ardentstudio/v1/projects/p1/stream?after=4', '/api/ardentstudio/v1/projects/p1/stream?after=7']);
    const headers = new Headers(request.mock.calls[1]![1]!.headers);
    expect(headers.get('cache-control')).toBe('no-cache');
    expect(headers.get('x-trace-id')).toBeTruthy();
    expect(headers.get('x-trace-id')).not.toBe(new Headers(request.mock.calls[0]![1]!.headers).get('x-trace-id'));
    expect(headers.has('last-event-id')).toBe(false);
  });
});
