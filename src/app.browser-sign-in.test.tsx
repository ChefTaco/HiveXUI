// @vitest-environment jsdom
// HiveXUI signs in only through Oathweave (or Cindertrace's local store). A console configured
// without Oathweave browser sign-in says what to configure; it never offers a password form that a
// product would check.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, settle, stubBrowser, type Mounted } from './modules/magnus/test-dom';

let view: Mounted | undefined;
let requests: string[] = [];
const legacy = { schema: 1, mode: 'legacy', products: { emberpath: '/api/emberpath' } };
beforeEach(() => {
  stubBrowser();
  requests = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'https://console.example.com').pathname;
    requests.push(path);
    if (path === '/runtime.json') return Response.json(legacy);
    return Response.json({ error: 'not here' }, { status: 404 });
  }));
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.unstubAllGlobals();
});

describe('a console without Oathweave browser sign-in', () => {
  it('shows how to configure Oathweave instead of a password form, and calls no product', async () => {
    vi.resetModules();
    const { initializeRuntime, browserSignInMissing } = await import('./lib/runtime');
    await initializeRuntime();
    expect(browserSignInMissing()).toBe(true);
    const { App, BROWSER_SIGN_IN_DOCS } = await import('./app');
    view = await mount(<App />);
    await settle(20);
    expect(document.querySelector('h1')?.textContent).toBe('Configure Oathweave browser sign-in');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('signs in only through Oathweave');
    expect(document.querySelector<HTMLAnchorElement>(`a[href="${BROWSER_SIGN_IN_DOCS}"]`)).not.toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(requests).toEqual(['/runtime.json']);
  });

  it('refuses a password sign-in through the API client too', async () => {
    vi.resetModules();
    const { initializeRuntime } = await import('./lib/runtime');
    await initializeRuntime();
    const { adminApi } = await import('./lib/api');
    await expect(adminApi.login('operator', 'obviously-fake-password')).rejects.toThrow('Oathweave browser sign-in is not configured');
    await expect(adminApi.me()).rejects.toThrow('Oathweave browser sign-in is not configured');
    expect('reauthenticate' in adminApi).toBe(false);
    expect(requests).toEqual(['/runtime.json']);
  });
});
