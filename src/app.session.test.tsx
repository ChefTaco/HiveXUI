// @vitest-environment jsdom
// The session ends in one place for every page and tab: the console returns to sign-in at the same
// address, and says why.
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type, type Mounted } from './modules/magnus/test-dom';
import { resetSessionEvents, sessionEnded } from './lib/session-events';

const { me } = vi.hoisted(() => ({ me: vi.fn() }));
vi.mock('./lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/api')>();
  return { ...actual, adminApi: { ...actual.adminApi, me } };
});
vi.mock('./lib/store', () => ({
  StoreProvider: ({ children }: { children: ReactNode }) => children,
  useStore: () => ({
    data: { providers: [], traces: [], audit: [], actors: [], incidents: [], clientKeys: [], telemetry: null },
    loading: true,
    refreshing: false,
    error: null,
    loadIssues: [],
    lastSync: null,
    refresh: async () => {},
    resourceFreshness: {},
    onAuthExpired: () => {},
  }),
}));

let view: Mounted | undefined;
beforeEach(() => {
  stubBrowser();
  me.mockResolvedValue({ user: { id: 'user-1', username: 'operator', roles: ['admin'] } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  me.mockReset();
  resetSessionEvents();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

async function until(found: () => unknown) {
  const deadline = Date.now() + 3_000;
  while (!found() && Date.now() < deadline) await settle(10);
  expect(found()).toBeTruthy();
}

describe('the end of a session', () => {
  it('returns to sign-in at the same address, and the same page opens after signing in again', async () => {
    history.replaceState(null, '', '/?page=keys');
    const { App } = await import('./app');
    view = await mount(<App />);
    await until(() => document.querySelector('.app-shell'));
    await settle(0);
    sessionEnded('expired');
    await until(() => document.querySelector('input[type="password"]'));
    expect(document.querySelector('.app-shell')).toBeNull();
    expect(document.body.textContent).toContain('Your session ended. Sign in again to continue where you were.');
    expect(location.pathname + location.search).toBe('/?page=keys');
  });

  it('follows a sign-out in another tab', async () => {
    const { App } = await import('./app');
    view = await mount(<App />);
    await until(() => document.querySelector('.app-shell'));
    await settle(0);
    const other = new BroadcastChannel('hivexui-session');
    other.postMessage({ type: 'signed-out' });
    await until(() => document.querySelector('input[type="password"]'));
    expect(document.body.textContent).toContain('You signed out in another tab.');
    other.close();
  });

  it('ignores a session end while already signed out', async () => {
    me.mockRejectedValue(Object.assign(new Error('Sign in to continue'), { status: 401 }));
    const { App } = await import('./app');
    view = await mount(<App />);
    await until(() => document.querySelector('input[type="password"]'));
    sessionEnded('expired');
    await settle(10);
    expect(document.body.textContent).not.toContain('Your session ended');
  });
});

describe('the native console sign-in with a second factor', () => {
  it('asks for the code and sends it with the password again (Emberpath MFA_REQUIRED)', async () => {
    me.mockRejectedValue(Object.assign(new Error('Sign in to continue'), { status: 401 }));
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'https://console.example.com').pathname;
      if (path !== '/api/auth/login') return new Response('Not found', { status: 404 });
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if (!body.mfaCode) return Response.json({ error: 'MFA_REQUIRED', code: 'MFA_REQUIRED', message: 'This account uses multi-factor authentication.', methods: ['totp'] }, { status: 401 });
      return Response.json({ ok: true, user: { id: 'user-1', username: 'operator', roles: ['admin'] } });
    }));
    const { App } = await import('./app');
    view = await mount(<App />);
    await until(() => document.querySelector('input[type="password"]'));
    await type(document.querySelector('input[autocomplete="username"]'), 'operator');
    await type(document.querySelector('input[type="password"]'), 'obviously-fake-password');
    await click(button('Sign in'));
    await until(() => document.querySelector('input[autocomplete="one-time-code"]'));
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await type(document.querySelector('input[autocomplete="one-time-code"]'), ' 123456 ');
    await click(button('Verify and sign in'));
    await until(() => document.querySelector('.app-shell'));
    expect(bodies).toEqual([
      { username: 'operator', password: 'obviously-fake-password' },
      { username: 'operator', password: 'obviously-fake-password', mfaCode: '123456' },
    ]);
  });

  it('starts over after a wrong code', async () => {
    me.mockRejectedValue(Object.assign(new Error('Sign in to continue'), { status: 401 }));
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (!body.mfaCode) return Response.json({ error: 'MFA_REQUIRED', code: 'MFA_REQUIRED', methods: ['totp'] }, { status: 401 });
      return Response.json({ error: 'Invalid credentials' }, { status: 401 });
    }));
    const { App } = await import('./app');
    view = await mount(<App />);
    await until(() => document.querySelector('input[type="password"]'));
    await type(document.querySelector('input[autocomplete="username"]'), 'operator');
    await type(document.querySelector('input[type="password"]'), 'obviously-fake-password');
    await click(button('Sign in'));
    await until(() => document.querySelector('input[autocomplete="one-time-code"]'));
    await type(document.querySelector('input[autocomplete="one-time-code"]'), '000000');
    await click(button('Verify and sign in'));
    await until(() => document.querySelector('[role="alert"]'));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Invalid credentials');
    expect(document.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe('');
  });
});
