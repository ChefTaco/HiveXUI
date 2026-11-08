// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccess, configureEndpoint } from '../../../../../lib/transport';
import { sessionStore } from '../../../session-store';
import { button, click, dialog, mount, settle, stubApi, stubBrowser, type, type Mounted } from '../../../test-dom';
import ArdentInstallationsPage from './installations/page';
import type { ArdentCommandOwner, ArdentInstallation } from './schemas';

const OWNER: ArdentCommandOwner = { commandId: 'native-1', state: 'unknown', label: 'ardent:ember:service-start', profile: 'ember', action: 'service-start', ardent: true,
  acquiredAt: '2026-11-08T00:00:00.000Z', dispatchedAt: '2026-11-08T00:00:01.000Z', deadline: '2026-11-08T00:02:05.000Z', reconcilableAfter: '2026-11-08T00:03:05.000Z' };
const BASE: ArdentInstallation = { nodeId: 'node-1', nodeName: 'alpha', hostname: 'alpha.example.com', reachable: true, error: null, installed: true, version: '2.2.0', owner: 'operator',
  checkedAt: '2026-11-08T00:00:00.000Z', profiles: [{ id: 'ember', name: 'ember', backend: 'llamacpp', apiPort: 9910, running: false, a2aEnabled: false, channels: {}, error: null }] };
const REASON = 'Unit inactive; journal shows no start job for ardent@ember.';

let view: Mounted | undefined;
async function load(role: string, installation: ArdentInstallation) {
  let current = installation;
  const stub = stubApi(({ method, path }) => {
    if (path === '/console/session') return { success: true, data: { userId: 'alice', role, capabilities: { hermes: false, terminal: false, agentVersion: '1.2.0', magnusVersion: '1.2.0', securityConsoleUrl: null } } };
    if (method === 'GET' && path === '/ardent/installations') return { success: true, data: [current] };
    if (method === 'POST' && path === '/ardent/installations/node-1/profiles/ember/action') {
      current = { ...current, commandOwners: [] };
      return { success: true, data: { commandId: 'native-1', outcome: 'settled', receipt: 'unknown', settlement: 'signed-reconciliation:no_effect_verified', evidenceSha256: 'e'.repeat(64), decisionId: 'd-1' } };
    }
    return undefined;
  });
  vi.stubGlobal('fetch', stub.request);
  await sessionStore.load();
  view = await mount(<ArdentInstallationsPage />);
  await settle(10);
  return stub;
}
const owners = () => document.querySelector('section[aria-label="Unsettled commands on alpha"]');

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

describe('unsettled Ardent commands', () => {
  it('names the command that holds the node, and reconciles it only after a confirmed ADMIN decision', async () => {
    const stub = await load('ADMIN', { ...BASE, commandOwners: [OWNER], commandReconciliation: { configured: true } });
    expect(owners()?.textContent).toContain('An Ardent command has an unknown outcome');
    expect(owners()?.textContent).toContain('no other Ardent action runs on alpha until an ADMIN reconciles it');
    expect(document.querySelector('[data-command="native-1"]')?.textContent).toContain('service-start on ember');
    await click(button('Reconcile', owners()!));
    const proceed = () => button('Reconcile…', owners()!)!;
    expect(proceed().disabled).toBe(true);
    await click(owners()!.querySelector('input[value="no_effect_verified"]'));
    await type(owners()!.querySelector('textarea'), 'too short');
    expect(proceed().disabled).toBe(true);
    await type(owners()!.querySelector('textarea'), REASON);
    await click(proceed());
    const text = dialog()?.textContent ?? '';
    expect(text).toContain('Reconcile this command?');
    expect(text).toContain('what it recorded for service-start on ember (command native-1)');
    expect(text).toContain('The command is never run again');
    expect(stub.mutations()).toEqual([]);
    await click(button('Reconcile', dialog()!));
    await settle(10);
    expect(stub.mutations()).toEqual([{ method: 'POST', path: '/ardent/installations/node-1/profiles/ember/action',
      body: { action: 'command-reconcile', target: 'native-1', body: { disposition: 'no_effect_verified', reason: REASON } } }]);
    expect(owners()).toBeNull();
  });

  it('says when this Magnus cannot sign a decision', async () => {
    await load('ADMIN', { ...BASE, commandOwners: [OWNER], commandReconciliation: { configured: false } });
    await click(button('Reconcile', owners()!));
    await click(owners()!.querySelector('input[value="effects_verified"]'));
    await type(owners()!.querySelector('textarea'), REASON);
    await click(button('Reconcile…', owners()!));
    expect(dialog()?.textContent).toContain('no reconciliation key (COMMAND_RECONCILIATION_SECRET)');
  });

  it('waits for the deadline, shows a running owner without an action, and leaves reconciling to an ADMIN', async () => {
    const later = new Date(Date.now() + 60 * 60_000).toISOString();
    await load('OPERATOR', { ...BASE, commandOwners: [OWNER, { ...OWNER, commandId: 'native-2', state: 'running', reconcilableAfter: later }] });
    expect(button('Reconcile', owners()!)).toBeUndefined();
    expect(document.querySelector('[data-command="native-1"]')?.textContent).toContain('An ADMIN must reconcile it.');
    expect(document.querySelector('[data-command="native-2"]')?.textContent).toContain('Still running');
    await view?.unmount();
    view = undefined;
    document.body.innerHTML = '';
    sessionStore.reset();
    await load('ADMIN', { ...BASE, commandOwners: [{ ...OWNER, reconcilableAfter: later }] });
    expect(button('Reconcile', owners()!)?.disabled).toBe(true);
    expect(owners()?.textContent).toContain('the command may still be running until then');
  });

  it('shows nothing from a Magnus that does not report command owners', async () => {
    await load('ADMIN', BASE);
    expect(document.body.textContent).toContain('alpha');
    expect(owners()).toBeNull();
  });
});
