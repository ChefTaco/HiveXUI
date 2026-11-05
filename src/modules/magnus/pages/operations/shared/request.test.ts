import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { formatBytes } from './parts';
import { failureFromBody, postKeepingBody } from './request';

const schema = z.object({ data: z.object({ reason: z.string() }) });
const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('postKeepingBody', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('returns a failure body that matches the schema, and sends the request once', async () => {
    const fetchMock = vi.fn(async () => answer(502, { data: { reason: 'connection refused' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(postKeepingBody('/webhooks/a/test', schema)).resolves.toEqual({ data: { reason: 'connection refused' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('throws the API message for a failure with another shape, without repeating it', async () => {
    const fetchMock = vi.fn(async () => answer(409, { success: false, error: { code: 'STALE_NODE_BLOCKED', message: 'blocked for stale node(s): a' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(postKeepingBody('/files/update', schema, {})).rejects.toMatchObject({ status: 409, code: 'STALE_NODE_BLOCKED', message: 'blocked for stale node(s): a' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('says the change was applied when a success cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(201, { unexpected: true })));
    await expect(postKeepingBody('/files/update', schema, {})).rejects.toMatchObject({ applied: true });
  });
});

describe('failureFromBody', () => {
  it('reads each failure shape, and hides bare codes', () => {
    expect(failureFromBody(400, { message: 'bad' }).message).toBe('bad');
    expect(failureFromBody(403, { error: 'RETRY_AFTER_STEP_UP', message: 'Identity verified.' })).toMatchObject({ code: 'RETRY_AFTER_STEP_UP', retryAfterStepUp: true, message: 'Identity verified.' });
    expect(failureFromBody(500, { error: 'INTERNAL' }).message).toBe('The Magnus API could not complete this request');
  });
});

describe('formatBytes', () => {
  it('picks a unit', () => {
    expect(formatBytes(12)).toBe('12 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 ** 2)).toBe('3.0 MB');
  });
});
