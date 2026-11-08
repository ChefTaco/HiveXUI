import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { consoleSessionResponseSchema, nodeListResponseSchema } from '@contracts/magnus/browser';
import { clearAccess, configureEndpoint, rememberAccess, setStepUpProvider } from '../../../lib/transport';
import { apiPath, magnus, segment } from './client';
import { agentDisabledMessage, MagnusApiError, MagnusContractError } from './errors';
import { readCooldown } from './rate-gate';

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

describe('rate-limited Ardent reads', () => {
  const limited = (seconds: string) => Response.json({ error: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': seconds } });
  const OK = z.object({ ok: z.boolean() });
  /** Move the fake clock in small steps, so timers set after a few awaits still fire on time. */
  const tick = async (ms: number) => {
    for (let passed = 0; passed < ms; passed += 50) await vi.advanceTimersByTimeAsync(Math.min(50, ms - passed));
  };
  beforeEach(() => {
    readCooldown.clear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    readCooldown.clear();
  });

  it('wait out Retry-After once and ask again, holding the other Ardent reads meanwhile', async () => {
    request.mockResolvedValueOnce(limited('3')).mockImplementation(async () => Response.json({ ok: true }));
    const first = magnus.get('/ardent/installations/node-1/profiles/lead/skills', OK);
    await tick(50);
    expect(request).toHaveBeenCalledTimes(1);
    // Another read on the bridge waits for the same cooldown instead of using up the budget.
    const second = magnus.get('/ardent/installations/node-1/profiles/lead/config', OK);
    await tick(2_800);
    expect(request).toHaveBeenCalledTimes(1);
    // Reads elsewhere and mutations are not held.
    await magnus.get('/nodes', OK);
    await magnus.post('/ardent/installations/node-1/profiles/lead/action', OK, { body: {} });
    expect(request).toHaveBeenCalledTimes(3);
    await tick(300);
    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(5);
  });

  it('give a longer Retry-After to the caller, in words and as a number', async () => {
    request.mockImplementation(async () => limited('45'));
    const error = (await magnus.get('/ardent/profiles', OK).catch((caught: unknown) => caught)) as MagnusApiError;
    expect(error).toMatchObject({ status: 429, code: 'RATE_LIMITED', retryAfterMs: 45_000, message: 'Too many requests. Try again in 45 seconds.' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('ask again only once, and never repeat a mutation or a read outside the bridge', async () => {
    request.mockImplementation(async () => limited('1'));
    const read = magnus.get('/ardent/profiles', OK).catch((caught: unknown) => caught);
    await tick(1_100);
    expect(await read).toMatchObject({ status: 429 });
    expect(request).toHaveBeenCalledTimes(2);
    readCooldown.clear();
    await expect(magnus.post('/ardent/agents', OK, { body: {} })).rejects.toMatchObject({ status: 429, retryAfterMs: 1_000 });
    await expect(magnus.get('/nodes', OK)).rejects.toMatchObject({ status: 429 });
    expect(request).toHaveBeenCalledTimes(4);
  });
});
