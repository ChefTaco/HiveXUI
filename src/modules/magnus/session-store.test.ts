import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccess, configureEndpoint } from '../../lib/transport';
import { sessionStore } from './session-store';

const body = (overrides = {}) => ({ success: true, data: { userId: 'alice', role: 'VIEWER', capabilities: { hermes: true, agentVersion: '1.2.3', magnusVersion: '1.2.3', securityConsoleUrl: 'https://security.example.com', ...overrides } } });
const request = vi.fn<typeof fetch>();
beforeEach(() => {
  request.mockReset();
  vi.stubGlobal('fetch', request);
  configureEndpoint('magnus', '/api/magnus');
  sessionStore.reset();
});
afterEach(() => vi.unstubAllGlobals());

describe('the Magnus session', () => {
  it('loads once, and keeps securityConsoleUrl out of reach so nothing can link out', async () => {
    request.mockImplementation(async () => Response.json(body()));
    await Promise.all([sessionStore.load(), sessionStore.load()]);
    await sessionStore.load();
    expect(request).toHaveBeenCalledTimes(1);
    const state = sessionStore.get();
    expect(state).toEqual({ status: 'ready', session: { userId: 'alice', role: 'VIEWER', capabilities: { hermes: true, agentVersion: '1.2.3', magnusVersion: '1.2.3' } } });
    expect(JSON.stringify(state)).not.toContain('security.example.com');
  });
  it('separates an identity with no Magnus access from an unreachable API, and Retry reloads', async () => {
    request.mockResolvedValueOnce(Response.json({ error: { message: 'No link for this identity' } }, { status: 403 }));
    await sessionStore.load();
    expect(sessionStore.get()).toEqual({ status: 'denied', message: 'No link for this identity' });
    request.mockResolvedValueOnce(new Response('', { status: 502 }));
    await sessionStore.load(true);
    expect(sessionStore.get().status).toBe('error');
    request.mockResolvedValueOnce(Response.json(body()));
    await sessionStore.load(true);
    expect(sessionStore.get().status).toBe('ready');
  });
  it('forgets the session on logout, and a late answer cannot bring it back', async () => {
    request.mockImplementation(async () => Response.json(body()));
    await sessionStore.load();
    clearAccess();
    expect(sessionStore.get().status).toBe('loading');
    let answer!: (response: Response) => void;
    request.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const pending = sessionStore.load();
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'));
    clearAccess();
    answer(Response.json(body()));
    await pending;
    expect(sessionStore.get().status).toBe('loading');
  });
  it('tells listeners', async () => {
    const listener = vi.fn();
    const unsubscribe = sessionStore.subscribe(listener);
    request.mockImplementation(async () => Response.json(body()));
    await sessionStore.load();
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});
