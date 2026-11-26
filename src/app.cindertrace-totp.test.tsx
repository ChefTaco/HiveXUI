// @vitest-environment jsdom
// Cindertrace's local sign-in with TOTP: the password first, then the six-digit code in its own field.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type, type Mounted } from './modules/magnus/test-dom';

const runtime = { schema: 1, mode: 'local', products: { cindertrace: '/api/cindertrace' } };
let bodies: Array<Record<string, unknown>> = [];
let view: Mounted | undefined;
beforeEach(() => {
  stubBrowser();
  bodies = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), 'https://console.example.com').pathname;
    if (path === '/runtime.json') return Response.json(runtime);
    if (path === '/api/cindertrace/auth/local/session') return Response.json({ error: 'Authentication required' }, { status: 401 });
    if (path === '/api/cindertrace/auth/local/login') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if (body.totp === undefined) return Response.json({ error: 'Authentication code required', totpRequired: true }, { status: 401 });
      if (body.totp !== '246810') return Response.json({ error: 'Invalid credentials', totpRequired: true }, { status: 401 });
      return Response.json({ ok: true, username: 'analyst', userId: 'local:analyst', role: 'OPERATOR' });
    }
    return Response.json({ error: 'not here' }, { status: 404 });
  }));
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.unstubAllGlobals();
});
async function until(found: () => unknown) {
  const deadline = Date.now() + 3_000;
  while (!found() && Date.now() < deadline) await settle(10);
  expect(found()).toBeTruthy();
}
async function password() {
  await type(document.querySelector('input[autocomplete="username"]'), 'analyst');
  await type(document.querySelector('input[type="password"]'), 'obviously-fake-password');
  await click(button('Sign in'));
}

describe('Cindertrace sign-in with an authenticator code', () => {
  it('asks for the 6-digit code after the password, says when it is wrong, and signs in with the right one', async () => {
    vi.resetModules();
    const { initializeRuntime } = await import('./lib/runtime');
    await initializeRuntime();
    const { App } = await import('./app');
    view = await mount(<App />);
    await until(() => document.querySelector('input[autocomplete="username"]'));
    await password();
    await until(() => document.querySelector('input[autocomplete="one-time-code"]'));
    const field = document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!;
    expect(field.closest('label')?.textContent).toContain('Authentication code');
    expect(field.inputMode).toBe('numeric');
    expect(document.querySelector('[role="alert"]')).toBeNull();

    await type(field, '135791');
    await click(button('Verify and sign in'));
    await until(() => document.querySelector('[role="alert"]'));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('That authentication code is not valid or was already used');

    await password();
    await until(() => document.querySelector('input[autocomplete="one-time-code"]'));
    await type(document.querySelector('input[autocomplete="one-time-code"]'), '246810');
    await click(button('Verify and sign in'));
    await until(() => document.querySelector('.app-shell'));
    expect(bodies.map((body) => body.totp ?? null)).toEqual([null, '135791', null, '246810']);
  });
});
