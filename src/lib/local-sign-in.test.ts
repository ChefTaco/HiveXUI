// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const suite = {
  schema: 1,
  products: { cindertrace: '/api/cindertrace', emberpath: '/api/emberpath' },
  identity: {
    issuer: 'https://identity.example.com',
    apiPrefix: '/api/oathweave',
    clients: { cindertrace: 'hivexui-cindertrace', emberpath: 'hivexui-emberpath' },
  },
};
const local = { schema: 1, mode: 'local', products: { cindertrace: '/api/cindertrace' } };

type Call = { url: string; init: RequestInit };
let calls: Call[];
function serve(runtime: unknown, answers: Record<string, () => Response> = {}) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      calls.push({ url: input, init });
      if (input === '/runtime.json') return Response.json(runtime);
      const answer = answers[input];
      if (answer) return answer();
      return new Response('not here', { status: 404 });
    }),
  );
}
async function fresh() {
  vi.resetModules();
  return {
    runtime: await import('./runtime'),
    api: await import('./api'),
    transport: await import('./transport'),
  };
}

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('local runtime schema', () => {
  it('accepts exactly Cindertrace without suite identity', async () => {
    const { runtimeSchema } = await import('./runtime');
    expect(runtimeSchema.safeParse(local).success).toBe(true);
    expect(runtimeSchema.safeParse({ ...local, identity: suite.identity }).success).toBe(false);
    expect(runtimeSchema.safeParse({ ...local, products: { ...local.products, emberpath: '/api/emberpath' } }).success).toBe(false);
    expect(runtimeSchema.safeParse({ ...local, products: {} }).success).toBe(false);
  });
});

describe('Cindertrace local sign-in', () => {
  it('signs in with Cindertrace, sending its cookie, and reaches no other product', async () => {
    serve(local, {
      '/api/cindertrace/auth/local/login': () => Response.json({ ok: true, username: 'admin', userId: 'local-admin', role: 'ADMIN' }),
    });
    const { runtime, api, transport } = await fresh();
    await runtime.initializeRuntime();
    expect(runtime.localSignIn()).toBe(true);
    expect(runtime.localSignInOffered()).toBe(false);
    expect(runtime.browserIdentity()).toBeUndefined();
    expect(runtime.productInstalled('cindertrace')).toBe(true);
    expect(runtime.productInstalled('emberpath')).toBe(false);

    const { user } = await api.adminApi.login('admin', 'correct horse battery');
    expect(user).toEqual({ id: 'local-admin', username: 'admin', roles: ['ADMIN'] });
    const login = calls.find((call) => call.url.endsWith('/auth/local/login'))!;
    expect(login.init.method).toBe('POST');
    expect(login.init.credentials).toBe('include');
    expect(new Headers(login.init.headers).get('Authorization')).toBeNull();

    // An unconfigured product is refused rather than sent to a legacy alias.
    await expect(transport.apiFetch('/api/emberpath/admin/providers')).rejects.toThrow('not configured');
    expect(calls.some((call) => call.url.startsWith('/api/admin') || call.url.startsWith('/api/emberpath'))).toBe(false);
  });

  it('asks for the authenticator code when Cindertrace wants one, and words a wrong code and a rate limit', async () => {
    const bodies: unknown[] = [];
    let answer: () => Response = () => Response.json({ error: 'Authentication code required', totpRequired: true }, { status: 401 });
    serve(local, { '/api/cindertrace/auth/local/login': () => answer() });
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
      if (input.endsWith('/auth/local/login')) bodies.push(JSON.parse(String(init.body)));
      return original(input, init);
    }));
    const { runtime, api } = await fresh();
    await runtime.initializeRuntime();
    const { SecondFactorRequired } = await import('./second-factor');
    const required = await api.adminApi.login('analyst', 'correct horse battery').catch((error: unknown) => error);
    expect(required).toBeInstanceOf(SecondFactorRequired);
    expect((required as InstanceType<typeof SecondFactorRequired>).kind).toBe('totp');

    answer = () => Response.json({ error: 'Invalid credentials', totpRequired: true }, { status: 401 });
    await expect(api.adminApi.login('analyst', 'correct horse battery', '123 456')).rejects.toThrow('That authentication code is not valid or was already used');
    await expect(api.adminApi.login('analyst', 'correct horse battery', '12345')).rejects.toThrow('Enter the 6 digits');

    answer = () => Response.json({ error: 'Too many login attempts' }, { status: 429, headers: { 'retry-after': '30' } });
    await expect(api.adminApi.login('analyst', 'correct horse battery', '654321')).rejects.toThrow('Too many sign-in attempts. Try again in 30 seconds.');

    answer = () => Response.json({ ok: true, username: 'analyst', userId: 'local:analyst', role: 'VIEWER' });
    expect((await api.adminApi.login('analyst', 'correct horse battery', '654321')).user.roles).toEqual(['VIEWER']);
    expect(bodies).toEqual([
      { username: 'analyst', password: 'correct horse battery' },
      { username: 'analyst', password: 'correct horse battery', totp: '123456' },
      { username: 'analyst', password: 'correct horse battery', totp: '654321' },
      { username: 'analyst', password: 'correct horse battery', totp: '654321' },
    ]);
  });

  it('treats a refused session as signed out and validates the profile', async () => {
    serve(local, {
      '/api/cindertrace/auth/local/session': () => Response.json({ error: 'Authentication required' }, { status: 401 }),
    });
    const { runtime, api } = await fresh();
    await runtime.initializeRuntime();
    await expect(api.adminApi.me()).rejects.toMatchObject({ status: 401 });

    serve(local, {
      '/api/cindertrace/auth/local/session': () => Response.json({ username: 'admin', userId: 'x', role: 'ROOT', provider: 'local' }),
    });
    const second = await fresh();
    await second.runtime.initializeRuntime();
    await expect(second.api.adminApi.me()).rejects.toThrow();
  });

  it('signs out through Cindertrace', async () => {
    serve(local, { '/api/cindertrace/auth/local/logout': () => Response.json({ ok: true }) });
    const { runtime, api } = await fresh();
    await runtime.initializeRuntime();
    await expect(api.adminApi.logout()).resolves.toEqual({ ok: true });
    expect(calls.some((call) => call.url === '/api/cindertrace/auth/local/logout' && call.init.method === 'POST')).toBe(true);
  });
});

describe('suite recovery sign-in', () => {
  it('is offered on a suite with Cindertrace and stays off until chosen', async () => {
    serve(suite);
    const { runtime } = await fresh();
    await runtime.initializeRuntime().catch(() => undefined);
    expect(runtime.localSignInOffered()).toBe(true);
    expect(runtime.localSignIn()).toBe(false);
  });

  it('switches the tab to Cindertrace only once chosen', async () => {
    sessionStorage.setItem('hivexui.sign-in', 'cindertrace');
    serve(suite);
    const { runtime } = await fresh();
    await runtime.initializeRuntime();
    expect(runtime.localSignIn()).toBe(true);
    expect(runtime.browserIdentity()).toBeUndefined();
    expect(runtime.productInstalled('emberpath')).toBe(false);
    expect(runtime.productInstalled('cindertrace')).toBe(true);
  });

  it('is not offered without Cindertrace, and a stored choice is ignored there', async () => {
    sessionStorage.setItem('hivexui.sign-in', 'cindertrace');
    serve({ ...suite, products: { emberpath: '/api/emberpath' }, identity: { ...suite.identity, clients: { emberpath: 'hivexui-emberpath' } } });
    const { runtime } = await fresh();
    await runtime.initializeRuntime().catch(() => undefined);
    expect(runtime.localSignInOffered()).toBe(false);
    expect(runtime.localSignIn()).toBe(false);
  });
});
