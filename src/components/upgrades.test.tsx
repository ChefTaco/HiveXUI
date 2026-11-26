// @vitest-environment jsdom
// The native console's upgrade asks for the password again; an account with multi-factor
// authentication also gives its code (Emberpath 2.7.0 answers MFA_REQUIRED without it).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type, type Mounted } from '../modules/magnus/test-dom';
import { UpgradesPanel } from './upgrades';

let view: Mounted | undefined;
let reauth: Record<string, unknown>[] = [];
beforeEach(() => {
  stubBrowser();
  reauth = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), 'https://console.example.com').pathname;
    if (path === '/api/hive/updates') return Response.json({ installed: '1.0.0', available: '1.1.0', enabled: true, canApply: true });
    if (path === '/api/hive/upgrades/plan') return Response.json({ error: 'STEP_UP_REQUIRED' }, { status: 403 });
    if (path === '/api/auth/reauthenticate') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      reauth.push(body);
      if (!body.mfaCode) return Response.json({ error: 'MFA_REQUIRED', code: 'MFA_REQUIRED', methods: ['totp'] }, { status: 401 });
      return Response.json({ ok: true });
    }
    return new Response('Not found', { status: 404 });
  }));
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.unstubAllGlobals();
});

describe('upgrade reauthentication', () => {
  it('asks for the second factor and repeats the password with the code', async () => {
    view = await mount(<UpgradesPanel canUpgrade />);
    await settle(10);
    await click(button('Review upgrade'));
    await settle(10);
    await type(document.querySelector('input[type="password"]'), 'obviously-fake-password');
    await click(button('Confirm authentication'));
    await settle(10);
    const code = document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]');
    expect(code).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe('obviously-fake-password');
    expect(button('Confirm authentication')?.disabled).toBe(true);
    await type(code, '123456');
    await click(button('Confirm authentication'));
    await settle(10);
    expect(reauth).toEqual([{ password: 'obviously-fake-password' }, { password: 'obviously-fake-password', mfaCode: '123456' }]);
    expect(document.body.textContent).toContain('Authentication refreshed. Review the upgrade again.');
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
});
