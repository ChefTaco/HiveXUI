import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { consoleSessionResponseSchema, nodeListResponseSchema } from '@contracts/magnus/browser';
import { clearAccess, configureEndpoint, rememberAccess, setStepUpProvider } from '../../../lib/transport';
import { apiPath, magnus, segment } from './client';
import { agentDisabledMessage, MagnusApiError, MagnusContractError } from './errors';

const SESSION = { success: true, data: { userId: 'alice', role: 'OPERATOR', capabilities: { hermes: false, agentVersion: '1', magnusVersion: '1', securityConsoleUrl: null } } };
const request = vi.fn<typeof fetch>();
const called = (index = 0) => ({ url: String(request.mock.calls[index]![0]), init: request.mock.calls[index]![1]! });

beforeEach(() => {
  request.mockReset();
  vi.stubGlobal('fetch', request);
  configureEndpoint('magnus', '/api/magnus');
  rememberAccess('magnus', 'fake-magnus-token', Date.now() + 600_000);
  rememberAccess('emberpath', 'fake-emberpath-token', Date.now() + 600_000);
});
afterEach(() => {
  clearAccess();
  setStepUpProvider(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Magnus requests', () => {
  it('reach the Magnus prefix with the Magnus token and never the Emberpath one', async () => {
    request.mockResolvedValue(Response.json(SESSION));
    await magnus.get('/console/session', consoleSessionResponseSchema);
    const { url, init } = called();
    expect(url).toBe('/api/magnus/console/session');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer fake-magnus-token');
    expect(headers.get('x-trace-id')).toBeTruthy();
    expect(init.credentials).toBe('include');
    expect(init.redirect).toBe('error');
  });
  it('builds query strings, dropping unset values, and encodes path values', async () => {
    expect(apiPath('/nodes', { page: 2, status: undefined, tag: null, query: 'a b' })).toBe('/api/magnus/nodes?page=2&query=a+b');
    expect(segment('a/b')).toBe('a%2Fb');
    expect(() => apiPath('nodes')).toThrow();
    expect(() => apiPath('/api/magnus/nodes')).toThrow();
  });
  it('sends the idempotency key and a JSON body on a mutation', async () => {
    request.mockResolvedValue(Response.json({ ok: true }));
    await magnus.post('/commands', z.object({ ok: z.boolean() }), { body: { a: 1 }, idempotencyKey: 'key-1' });
    const { init } = called();
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    const headers = new Headers(init.headers);
    expect(headers.get('x-idempotency-key')).toBe('key-1');
    expect(headers.get('content-type')).toBe('application/json');
  });
});

describe('contract validation', () => {
  it('returns the parsed body and strips fields the contract leaves out', async () => {
    request.mockResolvedValue(Response.json({ ...SESSION, data: { ...SESSION.data, nodeManagerSecret: 'fake' } }));
    const result = await magnus.get('/console/session', consoleSessionResponseSchema);
    expect(result.data.role).toBe('OPERATOR');
    expect('nodeManagerSecret' in result.data).toBe(false);
  });
  it('refuses a read that does not match, without logging its values', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    request.mockResolvedValue(Response.json({ success: true, data: [{ id: 'sensitive-value' }], meta: {} }));
    const error = await magnus.get('/nodes', nodeListResponseSchema).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MagnusContractError);
    expect((error as MagnusContractError).applied).toBe(false);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive-value');
  });
  it('says a mutation was applied when only its answer was unreadable, so nobody repeats it', async () => {
    request.mockResolvedValue(Response.json({ surprise: true }));
    const error = await magnus.post('/nodes/register', z.object({ success: z.literal(true) }), { body: {} }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MagnusContractError);
    expect((error as MagnusContractError).applied).toBe(true);
    expect((error as Error).message).toMatch(/applied/);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('API errors', () => {
  it('reads the shared error envelope', async () => {
    request.mockResolvedValue(Response.json({ success: false, error: { code: 'INVALID_STATE', message: 'Node is offline' } }, { status: 409 }));
    const error = (await magnus.get('/x', z.unknown()).catch((caught: unknown) => caught)) as MagnusApiError;
    expect(error).toBeInstanceOf(MagnusApiError);
    expect(error).toMatchObject({ status: 409, code: 'INVALID_STATE', message: 'Node is offline' });
  });
  it('reads an inline error without a code, and a bare code', async () => {
    request.mockResolvedValueOnce(Response.json({ success: false, error: { message: 'No code here' } }, { status: 409 }));
    expect(await magnus.get('/x', z.unknown()).catch((caught: unknown) => caught)).toMatchObject({ message: 'No code here' });
    request.mockResolvedValueOnce(Response.json({ error: 'NOT_LINKED' }, { status: 403 }));
    expect(await magnus.get('/x', z.unknown()).catch((caught: unknown) => caught)).toMatchObject({ code: 'NOT_LINKED', forbidden: true });
  });
  it('survives a body that is not JSON', async () => {
    request.mockResolvedValue(new Response('<html>', { status: 502 }));
    expect(await magnus.get('/x', z.unknown()).catch((caught: unknown) => caught)).toMatchObject({ status: 502, message: 'The Magnus API could not complete this request' });
  });
  it('recognizes a feature an unprivileged agent has disabled', async () => {
    expect(agentDisabledMessage({ error: 'AGENT_NOT_PRIVILEGED', feature: 'cron' })).toBe('Cron management is disabled on this node (its agent runs unprivileged).');
    expect(agentDisabledMessage('users is disabled: agent is not privileged')).toBe('User management is disabled on this node (its agent runs unprivileged).');
    expect(agentDisabledMessage({ error: 'other' })).toBeNull();
    request.mockResolvedValue(Response.json({ error: 'AGENT_NOT_PRIVILEGED', feature: 'cron' }, { status: 403 }));
    expect(await magnus.get('/x', z.unknown()).catch((caught: unknown) => caught)).toMatchObject({ code: 'AGENT_NOT_PRIVILEGED' });
  });
});

describe('step-up', () => {
  const required = () => Response.json({ error: 'STEP_UP_REQUIRED' }, { status: 403 });
  it('repeats a safe read once, through the transport', async () => {
    setStepUpProvider(async () => {});
    request.mockResolvedValueOnce(required()).mockResolvedValueOnce(Response.json(SESSION));
    await expect(magnus.get('/console/session', consoleSessionResponseSchema)).resolves.toMatchObject({ success: true });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('never repeats a read twice', async () => {
    setStepUpProvider(async () => {});
    request.mockImplementation(async () => required());
    await expect(magnus.get('/console/session', consoleSessionResponseSchema)).rejects.toBeInstanceOf(MagnusApiError);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each([['post'], ['patch'], ['put'], ['delete']] as const)('never replays a %s, and asks the operator to submit it again', async (method) => {
    const verified = vi.fn(async () => {});
    setStepUpProvider(verified);
    request.mockImplementation(async () => required());
    const error = (await magnus[method]('/nodes/a', z.unknown(), { body: {} }).catch((caught: unknown) => caught)) as MagnusApiError;
    expect(verified).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(error.retryAfterStepUp).toBe(true);
    expect(error.message).toMatch(/submit the operation again/);
  });
  it('does not retry an ordinary failure itself', async () => {
    request.mockResolvedValue(Response.json({ error: { message: 'boom' } }, { status: 500 }));
    await expect(magnus.get('/x', z.unknown())).rejects.toBeInstanceOf(MagnusApiError);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
