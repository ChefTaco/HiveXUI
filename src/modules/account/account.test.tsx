// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, dialog, mount, settle, stubBrowser, type, type Mounted } from '../magnus/test-dom';
import AccountModule from './index';

const { api, enabled } = vi.hoisted(() => ({
  api: vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(),
  enabled: { oathweave: true },
}));
vi.mock('../../lib/transport', () => ({ apiFetch: api }));
vi.mock('../../lib/runtime', () => ({ productEnabled: (product: string) => product === 'oathweave' && enabled.oathweave }));
vi.mock('../../lib/passkeys', () => ({ registerPasskey: vi.fn() }));

const passkey = { id: 'fixture-key', friendlyName: 'Desk key', deviceType: 'singleDevice', backedUp: false, credentialId: 'fixture-credential', lastUsedAt: null, createdAt: '2026-11-01T00:00:00.000Z' };
let credentials: unknown[] = [];
let requests: Array<{ path: string; method: string; body?: unknown }> = [];
let sessions: unknown[] | null = null;
let view: Mounted | undefined;

beforeEach(() => {
  stubBrowser();
  enabled.oathweave = true;
  credentials = [passkey];
  requests = [];
  sessions = null;
  api.mockImplementation(async (path, init) => {
    const method = init?.method ?? 'GET';
    requests.push({ path, method, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (path === '/api/iam/auth/sessions' && sessions) return Response.json({ sessions });
    if (method === 'DELETE' && path === '/api/iam/auth/sessions/session-2') {
      sessions = sessions!.filter((item) => (item as { id: string }).id !== 'session-2');
      return Response.json({ success: true, current: false });
    }
    if (method === 'POST' && path === '/api/iam/auth/password') {
      const body = JSON.parse(String(init?.body)) as { currentPassword: string };
      return body.currentPassword === 'obviously-fake-current'
        ? Response.json({ success: true })
        : Response.json({ error: 'INVALID_CREDENTIALS', message: 'Current password is incorrect' }, { status: 401, headers: { 'x-request-id': 'req-pw' } });
    }
    if (path === '/api/iam/auth/mfa/status') return Response.json({ enabled: true, totpConfigured: false, recoveryCodesRemaining: 8 });
    if (path === '/api/iam/mfa/webauthn/credentials') return Response.json({ data: credentials });
    if (method === 'DELETE' && path === '/api/iam/mfa/webauthn/credentials/fixture-key') {
      credentials = [];
      return Response.json({ success: true });
    }
    return Response.json({ message: 'Not found' }, { status: 404 });
  });
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  api.mockReset();
});

describe('Account security', () => {
  it('shows the sign-in methods under its page header', async () => {
    view = await mount(<AccountModule />);
    await settle();
    expect(document.querySelector('.page-head h2')?.textContent).toBe('Account security');
    expect(document.body.textContent).toContain('Multi-factor authentication is enabled.');
    expect(document.body.textContent).toContain('Recovery codes remaining: 8.');
    expect(document.body.textContent).toContain('Desk key');
  });

  it('shows loading lines before the status arrives', async () => {
    api.mockReturnValue(new Promise(() => undefined));
    view = await mount(<AccountModule />);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('shows an empty state when no passkey is registered', async () => {
    credentials = [];
    view = await mount(<AccountModule />);
    await settle();
    expect(document.querySelector('.empty-state')?.textContent).toContain('No passkeys registered');
  });

  it('removes a passkey only after confirmation', async () => {
    view = await mount(<AccountModule />);
    await settle();
    await click(button('Remove'));
    expect(dialog()?.textContent).toContain('Remove passkey?');
    await click(button('Cancel', dialog()!));
    expect(requests.some((request) => request.method === 'DELETE')).toBe(false);

    await click(button('Remove'));
    await click(button('Remove passkey', dialog()!));
    await settle();
    expect(requests).toContainEqual({ path: '/api/iam/mfa/webauthn/credentials/fixture-key', method: 'DELETE' });
    expect(dialog()).toBeNull();
    expect(document.body.textContent).not.toContain('Desk key');
    expect(document.querySelector('.empty-state')?.textContent).toContain('No passkeys registered');
  });

  it('says so when Oathweave is not configured', async () => {
    enabled.oathweave = false;
    view = await mount(<AccountModule />);
    expect(document.querySelector('.empty-state')?.textContent).toContain('Oathweave is not configured');
    expect(api).not.toHaveBeenCalled();
  });

  it('changes the password with the current one, and refuses a mismatch before sending', async () => {
    view = await mount(<AccountModule />);
    await settle();
    const field = (label: string) => [...document.querySelectorAll('label')].find((item) => item.textContent?.startsWith(label))?.querySelector('input');
    await type(field('Current password'), 'obviously-fake-current');
    await type(field('New password'), 'obviously-fake-next-1');
    await type(field('Repeat the new password'), 'obviously-fake-next-2');
    await click(button('Change password'));
    expect(document.body.textContent).toContain('The new passwords do not match.');
    expect(requests.some((request) => request.path === '/api/iam/auth/password')).toBe(false);

    await type(field('Current password'), 'obviously-fake-wrong');
    await type(field('New password'), 'obviously-fake-next-1');
    await type(field('Repeat the new password'), 'obviously-fake-next-1');
    await click(button('Change password'));
    await settle();
    expect(document.body.textContent).toContain('Current password is incorrect (request req-pw)');

    await type(field('Current password'), 'obviously-fake-current');
    await type(field('New password'), 'obviously-fake-next-1');
    await type(field('Repeat the new password'), 'obviously-fake-next-1');
    await click(button('Change password'));
    await settle();
    expect(requests.filter((request) => request.path === '/api/iam/auth/password').at(-1)?.body).toEqual({ currentPassword: 'obviously-fake-current', newPassword: 'obviously-fake-next-1' });
    expect(document.body.textContent).toContain('Password changed. Your other sign-ins were ended');
    // The fields are cleared, so the password does not linger in the page.
    expect(field('Current password')?.value).toBe('');
  });

  it('lists your sessions and ends another one after confirmation', async () => {
    sessions = [
      { id: 'session-1', createdAt: '2026-11-26T10:00:00.000Z', expiresAt: '2026-11-27T10:00:00.000Z', ipAddress: '192.0.2.10', userAgent: 'Desk browser', current: true },
      { id: 'session-2', createdAt: '2026-11-25T10:00:00.000Z', expiresAt: '2026-11-26T22:00:00.000Z', ipAddress: '192.0.2.20', userAgent: 'Laptop browser', current: false },
    ];
    view = await mount(<AccountModule />);
    await settle();
    const list = document.querySelector('[aria-label="Your sessions"]')!;
    expect(list.textContent).toContain('Desk browser');
    expect(list.textContent).toContain('This session');
    expect(list.textContent).toContain('Laptop browser');
    // Only the other session can be ended here.
    expect([...list.querySelectorAll('button')].map((item) => item.textContent)).toEqual(['End session']);
    await click(button('End session', list));
    expect(dialog()?.textContent).toContain('End this session?');
    await click(button('End session', dialog()!));
    await settle();
    expect(requests).toContainEqual({ path: '/api/iam/auth/sessions/session-2', method: 'DELETE' });
    expect(document.querySelector('[aria-label="Your sessions"]')?.textContent).not.toContain('Laptop browser');
  });

  it('says that an older Oathweave does not list your sessions', async () => {
    view = await mount(<AccountModule />);
    await settle();
    expect(document.body.textContent).toContain('This Oathweave does not list your own sessions yet.');
  });
});
