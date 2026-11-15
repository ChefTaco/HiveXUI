// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccess, configureEndpoint } from '../../../../../lib/transport';
import { sessionStore } from '../../../session-store';
import { button, click, dialog, mount, settle, stubApi, stubBrowser, type RecordedRequest } from '../../../test-dom';
import { AgentUpgradeDrawer } from './agent-upgrade';

const AT = '2026-11-05T12:00:00.000Z';
const candidate = (nodeId: string, eligible: boolean, code: string | null, reason: string | null = code) => ({ nodeId, name: nodeId, version: '1.4.0', eligible, reason, code, upgrade: null, layout: 'versioned', managed: true });
const RUN = {
  id: 'run-1', version: '1.4.0', integrity: 'sha512-x', actorId: 'alice', status: 'succeeded', startedAt: AT, finishedAt: AT, concurrency: 1, message: null,
  nodes: [{ nodeId: 'node-a', name: 'node-a', from: '1.3.0', state: 'confirmed', requestId: 'r', detail: null }],
};

function api(role: string, eligibility: Record<string, unknown>) {
  return stubApi(({ method, path }: RecordedRequest) => {
    if (path === '/console/session') return { success: true, data: { userId: 'alice', role, capabilities: { hermes: false, terminal: false, agentVersion: '2.0.0', magnusVersion: '2.0.0', securityConsoleUrl: null } } };
    if (method === 'GET' && path === '/agents/upgrade/eligibility') return { success: true, data: eligibility };
    return undefined;
  });
}
const eligibility = (nodes: unknown[], latestRun: unknown = null) => ({ version: '2.0.0', serverVersion: '2.0.0', upgradesEnabled: true, disabledReason: null, prerelease: false, release: { verified: true, integrity: 'x', reason: null }, nodes, latestRun });

async function open(role: string, data: Record<string, unknown>) {
  const stub = api(role, data);
  vi.stubGlobal('fetch', stub.request);
  await sessionStore.load();
  const mounted = await mount(<AgentUpgradeDrawer open onClose={() => {}} />);
  await settle(5);
  return { stub, mounted };
}

beforeEach(() => {
  stubBrowser();
  configureEndpoint('magnus', '/api/magnus');
  sessionStore.reset();
});
afterEach(() => {
  clearAccess();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('the upgrade drawer', () => {
  it('says how many agents are ready and sends those on another major to a manual upgrade', async () => {
    const { mounted } = await open('ADMIN', eligibility([candidate('node-a', false, 'MAJOR_VERSION', 'Another major version'), candidate('node-b', false, 'MAJOR_VERSION', 'Another major version'), candidate('node-c', false, 'OFFLINE', 'Offline')]));
    const text = document.body.textContent ?? '';
    expect(text).toContain('Target 2.0.0: 0 ready, 3 unavailable');
    expect(document.querySelector('[role="note"]')?.textContent).toContain('2 agents require a manual major-version upgrade to 2.0.0');
    expect(text).toContain('No agents can be upgraded from this dialog right now');
    expect(text).toContain('Check refreshes the readiness report');
    await mounted.unmount();
  });
  it('shows no major-version notice when every agent shares the major', async () => {
    const { mounted } = await open('ADMIN', eligibility([candidate('node-a', true, null)]));
    expect(document.body.textContent).toContain('Target 2.0.0: 1 ready, 0 unavailable');
    expect(document.querySelector('[role="note"]')).toBeNull();
    expect(document.body.textContent).not.toContain('No agents can be upgraded');
    await mounted.unmount();
  });
  it('lets a viewer read readiness without any control that changes a host', async () => {
    const { stub, mounted } = await open('VIEWER', eligibility([candidate('node-a', true, null)]));
    expect(button('Check')).toBeUndefined();
    expect(button(/^Upgrade \d/)).toBeUndefined();
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    expect(stub.mutations()).toEqual([]);
    await mounted.unmount();
  });
  it('folds the previous rollout so the next candidates come first', async () => {
    const { mounted } = await open('ADMIN', eligibility([candidate('node-a', true, null)], RUN));
    const details = document.querySelector('details');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('Previous rollout to 1.4.0 · 1 agent');
    await mounted.unmount();
  });
});

describe('major upgrades', () => {
  // Magnus 3.0.1 added allowMajor; the eligibility read with it moves 2.10.3 agents with a key into the run.
  const crossing = (nodeId: string, version: string, eligible: boolean, code: string | null) => ({ ...candidate(nodeId, eligible, code), version });
  const WITHIN = eligibility([crossing('old-a', '2.10.3', false, 'MAJOR_VERSION'), crossing('old-b', '2.10.2', false, 'MAJOR_VERSION'), crossing('new-c', '3.0.0', true, null)]);
  const ACROSS = eligibility([crossing('old-a', '2.10.3', true, null), crossing('old-b', '2.10.2', false, 'MAJOR_NEEDS_STEPPING_STONE'), crossing('old-k', '2.10.3', false, 'MAJOR_NEEDS_NODE_KEY'), crossing('new-c', '3.0.0', true, null)]);
  const target = (data: Record<string, unknown>) => ({ ...data, version: '3.0.2', serverVersion: '3.0.2' });

  async function openOn(role: string, magnusVersion: string) {
    const stub = stubApi(({ method, path, body }: RecordedRequest) => {
      if (path === '/console/session') return { success: true, data: { userId: 'alice', role, capabilities: { hermes: false, terminal: false, agentVersion: magnusVersion, magnusVersion, securityConsoleUrl: null } } };
      if (method === 'GET' && path === '/agents/upgrade/eligibility') return { success: true, data: target(WITHIN) };
      if (method === 'GET' && path === '/agents/upgrade/eligibility?allowMajor=true') return { success: true, data: target(ACROSS) };
      if (method === 'POST' && path === '/agents/upgrade' && body?.dryRun) return { success: true, data: { dryRun: true, version: '3.0.2', integrity: 'x', release: { verified: true, integrity: 'x', reason: null }, eligible: 2, blocked: 2, nodes: [] } };
      if (path === '/agents/upgrade' || path === '/agents/upgrade/runs/run-1') return { success: true, data: { ...RUN, version: '3.0.2', status: 'running', allowMajor: true, finishedAt: null } };
      return undefined;
    });
    vi.stubGlobal('fetch', stub.request);
    await sessionStore.load();
    const mounted = await mount(<AgentUpgradeDrawer open onClose={() => {}} />);
    await settle(5);
    return { stub, mounted };
  }
  const allowMajor = () => [...document.querySelectorAll('label')].find((label) => label.textContent?.trim() === 'Allow major upgrade')?.querySelector('input') ?? null;

  it('offers Allow major upgrade to ADMIN on Magnus 3.0.1 or later, behind a confirmation that explains the stepping stone and the authorization', async () => {
    const { stub, mounted } = await openOn('ADMIN', '3.0.2');
    expect(document.querySelector('[role="note"]')?.textContent).toContain('2 agents are on another major version than 3.0.2 (MAJOR_VERSION)');
    expect(allowMajor()?.checked).toBe(false);
    await click(allowMajor());
    const confirm = dialog();
    expect(confirm?.textContent).toContain('Allow major upgrades?');
    expect(confirm?.textContent).toContain('2.10.x → 2.10.3 → 3.x');
    expect(confirm?.textContent).toContain('magnus-server agents upgrade --to 2.10.3');
    expect(confirm?.textContent).toContain('valid for one hour');
    expect(confirm?.textContent).toContain('bound node key');
    // Nothing is read with allowMajor until the confirmation is accepted.
    expect(stub.of('/agents/upgrade/eligibility?allowMajor=true')).toEqual([]);
    await click(button('Allow major upgrade', confirm!));
    await settle(5);
    expect(stub.of('/agents/upgrade/eligibility?allowMajor=true')).toHaveLength(1);
    expect(allowMajor()?.checked).toBe(true);
    expect(document.body.textContent).toContain('Target 3.0.2: 2 ready, 2 unavailable');
    await mounted.unmount();
  });
  it('keeps the read within the major when the confirmation is cancelled', async () => {
    const { stub, mounted } = await openOn('ADMIN', '3.0.1');
    await click(allowMajor());
    await click(button('Cancel', dialog()!));
    await settle(5);
    expect(allowMajor()?.checked).toBe(false);
    expect(stub.of('/agents/upgrade/eligibility?allowMajor=true')).toEqual([]);
    await mounted.unmount();
  });
  it('shows the agents a major upgrade holds back with Magnus\'s cause and remedy', async () => {
    const { mounted } = await openOn('ADMIN', '3.0.2');
    await click(allowMajor());
    await click(button('Allow major upgrade', dialog()!));
    await settle(5);
    const held = document.querySelector('[aria-label="Agents a major upgrade holds back"]')?.textContent ?? '';
    expect(held).toContain('MAJOR_NEEDS_STEPPING_STONE: old-b');
    expect(held).toContain('older than 2.10.3');
    expect(held).toContain('magnus-server agents upgrade --to 2.10.3');
    expect(held).toContain('MAJOR_NEEDS_NODE_KEY: old-k');
    expect(held).toContain('magnus-agent enroll --token-file -');
    // Every agent the read moved into the run is ready; the MAJOR_VERSION notice is gone.
    expect(document.body.textContent).not.toContain('(MAJOR_VERSION)');
    await mounted.unmount();
  });
  it('sends allowMajor with Check and with the run, and says which agents cross the major', async () => {
    const { stub, mounted } = await openOn('ADMIN', '3.0.2');
    await click(allowMajor());
    await click(button('Allow major upgrade', dialog()!));
    await settle(5);
    await click(button('Check'));
    await settle(5);
    expect(stub.mutations()[0]?.body).toMatchObject({ dryRun: true, allowMajor: true, version: '3.0.2' });
    await click(button(/^Upgrade 2 agents/));
    expect(dialog()?.textContent).toContain('1 of them crosses a major version, each with a major-upgrade authorization the server signs for that node, valid for one hour.');
    await click(button('Upgrade 2 agents', dialog()!));
    await settle(5);
    expect(stub.mutations()[1]?.body).toMatchObject({ nodeIds: ['old-a', 'new-c'], version: '3.0.2', allowMajor: true });
    expect(document.body.textContent).toContain('major upgrades allowed');
    await mounted.unmount();
  });
  it('turns allowMajor off without a confirmation', async () => {
    const { stub, mounted } = await openOn('ADMIN', '3.0.2');
    await click(allowMajor());
    await click(button('Allow major upgrade', dialog()!));
    await settle(5);
    await click(allowMajor());
    await settle(5);
    expect(dialog()).toBeNull();
    expect(allowMajor()?.checked).toBe(false);
    expect(stub.of('/agents/upgrade/eligibility')).toHaveLength(2);
    await mounted.unmount();
  });
  it('keeps the manual major-version notice, with no option, against a server before 3.0.1', async () => {
    const { mounted } = await openOn('ADMIN', '3.0.0');
    expect(document.querySelector('[role="note"]')?.textContent).toContain('2 agents require a manual major-version upgrade to 3.0.2');
    expect(allowMajor()).toBeNull();
    await mounted.unmount();
  });
  it('tells a viewer that an ADMIN can include agents on another major, with no option to change it', async () => {
    const { stub, mounted } = await openOn('VIEWER', '3.0.2');
    expect(document.querySelector('[role="note"]')?.textContent).toContain('An ADMIN can include them with Allow major upgrade');
    expect(allowMajor()).toBeNull();
    expect(stub.mutations()).toEqual([]);
    await mounted.unmount();
  });
});
