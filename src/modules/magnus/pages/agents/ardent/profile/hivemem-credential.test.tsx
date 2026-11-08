// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccess, configureEndpoint } from '../../../../../../lib/transport';
import { sessionStore } from '../../../../session-store';
import { button, click, dialog, mount, settle, stubApi, stubBrowser, type Mounted } from '../../../../test-dom';
import ArdentProfilePage from './page';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const READY = { status: 'ready', agent_id: 'ardent-node-1-lead', workspace_id: 'ws-1', retrieval: 'hybrid', storage: 'sqlite', reason: null };
const PROFILE = { id: 'lead', name: 'lead', backend: 'llamacpp', apiPort: 9910, running: true, a2aEnabled: false, channels: {}, error: null };
const at = (offset: number) => new Date(Date.now() + offset).toISOString();
const credential = (extra: Record<string, unknown> = {}) => ({
  agentId: 'ardent-node-1-lead', workspaceId: 'ws-1', expiresAt: at(12 * DAY + 5 * HOUR), lastRenewedAt: at(-2 * DAY - HOUR), lastAttemptAt: at(-2 * DAY - HOUR),
  nextRenewalAt: at(5 * DAY + HOUR), failures: 0, lastError: null, state: 'ok', ...extra,
});

let view: Mounted | undefined;
async function load(hivemem: unknown, role = 'ADMIN') {
  const profile = hivemem === undefined ? PROFILE : { ...PROFILE, hivemem };
  const installation = {
    nodeId: 'node-1', nodeName: 'alpha', hostname: 'alpha.example.com', reachable: true, error: null, installed: true, version: '2.2.0', owner: 'operator',
    checkedAt: '2026-11-08T00:00:00.000Z', profiles: [profile],
  };
  const stub = stubApi(({ method, path }) => {
    if (path === '/console/session') return { success: true, data: { userId: 'alice', role, capabilities: { hermes: false, terminal: false, agentVersion: '1.2.0', magnusVersion: '1.2.0', securityConsoleUrl: null } } };
    if (path === '/ardent/installations/node-1') return { success: true, data: installation };
    const base = '/ardent/installations/node-1/profiles/lead';
    if (path === `${base}/status`) return { success: true, data: { backend: 'llamacpp' } };
    if (path === `${base}/tasks`) return { success: true, data: { tasks: [] } };
    if (path === `${base}/memory/status`) return { success: true, data: READY };
    if (method === 'POST' && path === `${base}/hivemem`) return new Response(JSON.stringify({ success: true, data: { operationId: 'op-9' } }), { status: 202, headers: { 'content-type': 'application/json' } });
    return undefined;
  });
  vi.stubGlobal('fetch', stub.request);
  await sessionStore.load();
  view = await mount(<ArdentProfilePage />, { id: 'node-1~lead' });
  await settle(10);
  return stub;
}
const panel = () => document.querySelector<HTMLElement>('[data-hivemem-credential]');

beforeEach(() => {
  stubBrowser();
  configureEndpoint('magnus', '/api/magnus');
  sessionStore.reset();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  clearAccess();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('the HiveMem credential on an Ardent profile', () => {
  it('shows nothing new for a Magnus that does not report credentials', async () => {
    await load(undefined);
    expect(panel()).toBeNull();
    expect(document.body.textContent).not.toContain('HiveMem credential');
    expect(button('Enable HiveMem')).toBeUndefined();
    expect(document.querySelector('[role="tablist"]')).not.toBeNull();
  });

  it('shows days left, with the absolute date in a title, and the renewal times', async () => {
    const expiresAt = at(12 * DAY + 5 * HOUR);
    await load(credential({ expiresAt }));
    expect(panel()?.getAttribute('data-hivemem-credential')).toBe('ok');
    const headline = [...panel()!.querySelectorAll('[title]')].find((item) => item.textContent === 'Credential expires in 12 days');
    expect(headline?.getAttribute('title')).toBe(new Date(expiresAt).toLocaleString());
    expect(panel()?.textContent).toContain('Renewing');
    expect(panel()?.textContent).toContain('2 days ago');
    expect(panel()?.textContent).toContain('in 5 days');
    expect(panel()?.textContent).toContain('ardent-node-1-lead · ws-1');
    expect(button('Enable HiveMem')).toBeUndefined();
  });

  it('warns in words when under three days are left', async () => {
    await load(credential({ expiresAt: at(5 * HOUR + 30 * 60_000) }));
    expect(panel()?.getAttribute('data-hivemem-credential')).toBe('expiring');
    expect(panel()?.textContent).toContain('Credential expires in 5 hours');
    expect(panel()?.textContent).toContain('Expiring soon');
  });

  it('shows a failing renewal with its attempts, and the last error to ADMINs only', async () => {
    await load(credential({ state: 'renewal-failing', failures: 3, lastError: 'HiveMem answered 503' }));
    expect(panel()?.querySelector('[role="status"]')?.textContent).toBe('Renewal failing (3 attempts): HiveMem answered 503');
    await view?.unmount();
    sessionStore.reset();
    await load(credential({ state: 'renewal-failing', failures: 3, lastError: 'HiveMem answered 503' }), 'VIEWER');
    expect(panel()?.querySelector('[role="status"]')?.textContent).toBe('Renewal failing (3 attempts)');
    expect(document.body.textContent).not.toContain('HiveMem answered 503');
  });

  it('marks an expired credential and offers Enable HiveMem to re-enroll it', async () => {
    const stub = await load(credential({ state: 'expired', expiresAt: at(-HOUR) }));
    expect(panel()?.querySelector('[role="alert"]')?.textContent).toBe('Credential expired');
    expect(panel()?.textContent).toContain('Enable HiveMem re-enrolls it');
    expect(document.body.textContent).toContain('Re-enroll in HiveMem');
    await click(button('Enable HiveMem'));
    await click(button('Enable HiveMem', dialog()!));
    await settle(10);
    expect(stub.mutations().map((item) => item.path)).toEqual(['/ardent/installations/node-1/profiles/lead/hivemem']);
  });

  it('says so when Magnus manages no credential', async () => {
    await load(null);
    expect(panel()?.textContent).toBe('HiveMem credential: Not managed by Magnus.');
  });

  it('reads a malformed credential as unknown and keeps the page', async () => {
    await load({ state: 'ok', failures: 'many' });
    expect(panel()?.getAttribute('data-hivemem-credential')).toBe('unknown');
    expect(panel()?.textContent).toContain('Credential status unknown');
    expect(document.body.textContent).toContain('Running');
  });
});
