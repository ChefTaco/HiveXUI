import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearAccess,
  setStepUpProvider,
  setAccessProvider,
  configureEndpoint,
  createApiFetch,
  rememberAccess,
} from './transport';

afterEach(() => {
  clearAccess();
  setAccessProvider(undefined);
});
describe('product API transport', () => {
  it('omits identity cookies on bearer-authorized product requests', async () => {
    configureEndpoint('emberpath', '/api/emberpath');
    setAccessProvider(async () => {});
    rememberAccess(
      'emberpath',
      'obviously-fake-resource-token',
      Date.now() + 60000,
    );
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true }));
    await createApiFetch(request)('/api/providers', { credentials: 'include' });
    expect(request.mock.calls[0]![1]!.credentials).toBe('omit');
  });
  it('rejects arbitrary and credential-bearing endpoint URLs', () => {
    for (const endpoint of [
      'https://external.example.com/api',
      '//external.example.com/api',
      '/api/../redirect',
      '/api/test?token=example',
      '/api/test\\escape',
    ]) {
      expect(() => configureEndpoint('oathweave', endpoint)).toThrow();
    }
  });
  it('sends only the selected resource token and refuses redirects', async () => {
    configureEndpoint('oathweave', '/api/oathweave');
    rememberAccess(
      'oathweave',
      'obviously-fake-identity-token',
      Date.now() + 60000,
    );
    rememberAccess(
      'emberpath',
      'obviously-fake-routing-token',
      Date.now() + 60000,
    );
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true }));
    await createApiFetch(request)('/api/iam/users');
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe('/api/oathweave/users');
    expect(new Headers(init!.headers).get('authorization')).toBe(
      'Bearer obviously-fake-identity-token',
    );
    expect(init!.redirect).toBe('error');
  });
  it('clears all resource credentials on logout', async () => {
    rememberAccess('emberpath', 'obviously-fake-token', Date.now() + 60000);
    clearAccess();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true }));
    await createApiFetch(request)('/api/providers');
    expect(
      new Headers(request.mock.calls[0]![1]!.headers).has('authorization'),
    ).toBe(false);
  });
  it('never sends a bearer to an arbitrary request URL', async () => {
    const request = vi.fn<typeof fetch>();
    await expect(
      createApiFetch(request)('https://external.example.com/api'),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    expect(() =>
      rememberAccess('emberpath', 'obviously-fake-token', Date.now() - 100),
    ).toThrow();
  });
  it('uses the resource bearer only for chat exchange, then uses the native cookie', async () => {
    configureEndpoint('chattermost', '/api/chat');
    rememberAccess(
      'chattermost',
      'obviously-fake-chat-resource',
      Date.now() + 60000,
    );
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        String(input).endsWith('/session')
          ? Response.json({ expires_at: Date.now() + 60000 })
          : Response.json({ id: 'fake-user' }),
      );
    const send = createApiFetch(request);
    await send('/api/chat/api/v4/users/me');
    await send('/api/chat/api/v4/users/me');
    expect(request.mock.calls).toHaveLength(3);
    expect(request.mock.calls[0]![0]).toBe(
      '/api/chat/api/v4/auth/oathweave/session',
    );
    expect(
      new Headers(request.mock.calls[0]![1]!.headers).get('authorization'),
    ).toBe('Bearer obviously-fake-chat-resource');
    expect(
      new Headers(request.mock.calls[1]![1]!.headers).has('authorization'),
    ).toBe(false);
    expect(request.mock.calls[1]![1]!.credentials).toBe('include');
  });
});

it('rejects encoded route traversal before acquiring or forwarding credentials', async () => {
  const request = vi.fn<typeof fetch>();
  for (const path of [
    '/api/iam/%2e%2e/providers',
    '/api/iam/users%2f..%2fproviders',
    '/api/iam/%252e%252e/providers',
    '/api/iam/%5cusers',
    '/api/iam/%zz',
  ]) {
    await expect(createApiFetch(request)(path)).rejects.toThrow(
      'Invalid API path',
    );
  }
  expect(request).not.toHaveBeenCalled();
});

it('step-up never replays a durable operation or consumes an approval twice', async () => {
  const verify = vi.fn(async () => {});
  setStepUpProvider(verify);
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json({ error: 'STEP_UP_REQUIRED' }, { status: 403 }),
    );
  try {
    const response = await createApiFetch(request)('/api/providers', {
      method: 'POST',
      body: '{}',
    });
    expect(request).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledOnce();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: 'RETRY_AFTER_STEP_UP',
    });
  } finally {
    setStepUpProvider(undefined);
  }
});
