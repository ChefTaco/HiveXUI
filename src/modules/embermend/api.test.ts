import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HiveApiError } from '../../lib/api-error';
import { embermendRequest } from './api';

const { api } = vi.hoisted(() => ({ api: vi.fn<(path: string, init?: RequestInit) => Promise<Response>>() }));
vi.mock('../../lib/transport', () => ({ apiFetch: api }));

beforeEach(() => api.mockReset());

describe('Embermend client', () => {
  it('reads with GET and writes JSON with POST through the shared transport', async () => {
    api.mockImplementation(async () => Response.json([{ id: 'fixture' }]));
    await expect(embermendRequest('recommendations')).resolves.toEqual([{ id: 'fixture' }]);
    await embermendRequest('decisions', { decision: 'approve' });
    expect(api.mock.calls[0]![0]).toBe('/api/embermend/api/v1/recommendations');
    expect(api.mock.calls[0]![1]?.method).toBe('GET');
    expect(api.mock.calls[1]![1]?.method).toBe('POST');
    expect(new Headers(api.mock.calls[1]![1]?.headers).get('content-type')).toBe('application/json');
    expect(api.mock.calls[1]![1]?.body).toBe('{"decision":"approve"}');
  });

  it.each([
    [403, 'Your current access does not allow this action.'],
    [409, 'The recommendation or its execution conditions changed. Refresh and review the current revision.'],
    [500, 'Embermend could not complete the request. Refresh to inspect the retained outcome before trying another action.'],
  ])('answers a %s refusal with a HiveApiError, its message and the product code', async (status, message) => {
    api.mockResolvedValue(Response.json({ error: 'STALE_DECISION' }, { status, headers: { 'x-request-id': 'fixture-request' } }));
    const error = await embermendRequest('decisions', {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HiveApiError);
    expect(error).toMatchObject({ status, message, code: 'STALE_DECISION', shape: 'code', requestId: 'fixture-request' });
  });

  it('never shows the product text, even in the suite envelope', async () => {
    api.mockResolvedValue(Response.json({ error: { code: 'internal', message: 'stack trace' } }, { status: 500 }));
    const error = (await embermendRequest('findings').catch((caught: unknown) => caught)) as HiveApiError;
    expect(error.message).not.toContain('stack trace');
    expect(error.shape).toBe('envelope');
  });
});
