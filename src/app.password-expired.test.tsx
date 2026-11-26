// @vitest-environment jsdom
// An expired Oathweave password opens password recovery on the sign-in form: Oathweave has no
// signed-out password change, so a recovery code is the way to set a new one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type, type Mounted } from './modules/magnus/test-dom';

const runtime = {
  schema: 1,
  products: { oathweave: '/api/iam' },
  identity: { issuer: 'https://identity.example.com', apiPrefix: '/api/oathweave', clients: { oathweave: 'hivexui-oathweave' } },
};

let view: Mounted | undefined;
beforeEach(() => {
  stubBrowser();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'https://console.example.com').pathname;
    if (path === '/runtime.json') return Response.json(runtime);
    if (path === '/api/oathweave/browser/session') return Response.json({ error: 'LOGIN_REQUIRED' }, { status: 401 });
    if (path === '/api/oathweave/auth/login') return Response.json({ passwordExpired: true, message: 'Your password has expired and must be changed' }, { status: 403 });
    return new Response('Not found', { status: 404 });
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

describe('an expired password at sign-in', () => {
  it('opens password recovery and says why', async () => {
    vi.resetModules();
    const { initializeRuntime } = await import('./lib/runtime');
    await initializeRuntime();
    const { App } = await import('./app');
    view = await mount(<App />);
    await until(() => document.querySelector('input[autocomplete="username"]'));
    await type(document.querySelector('input[autocomplete="username"]'), 'operator');
    await type(document.querySelector('input[type="password"]'), 'obviously-fake-password');
    await click(button('Sign in'));
    await until(() => button('Request recovery'));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Your Oathweave password has expired. Request a recovery code below');
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
});
