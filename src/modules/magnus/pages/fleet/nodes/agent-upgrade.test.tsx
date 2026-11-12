// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccess, configureEndpoint } from '../../../../../lib/transport';
import { sessionStore } from '../../../session-store';
import { button, mount, settle, stubApi, stubBrowser, type RecordedRequest } from '../../../test-dom';
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
