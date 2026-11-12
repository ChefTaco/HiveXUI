// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, dialog, mount, settle, stubBrowser, type Mounted } from '../magnus/test-dom';
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
let requests: Array<{ path: string; method: string }> = [];
let view: Mounted | undefined;

beforeEach(() => {
  stubBrowser();
  enabled.oathweave = true;
  credentials = [passkey];
  requests = [];
  api.mockImplementation(async (path, init) => {
    const method = init?.method ?? 'GET';
    requests.push({ path, method });
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
});
