// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccess, configureEndpoint } from '../../../../../lib/transport';
import { sessionStore } from '../../../session-store';
import { button, mount, settle, stubApi, stubBrowser, type RecordedRequest } from '../../../test-dom';
import RetentionPage from './page';

const SUMMARY = {
  success: true,
  data: {
    generatedAt: '2026-11-05T10:00:00.000Z',
    policyStatus: { status: 'fail', message: 'LOG_RETENTION_DAYS is not set' },
    tables: [
      { name: 'HealthSnapshot', count: 1500, oldestAt: '2026-10-01T00:00:00.000Z', policy: '24h full; 5m samples for 30d', cutoffs: { fullFidelityAfter: '2026-11-04T10:00:00.000Z', expiresBefore: '2026-10-06T10:00:00.000Z' } },
      { name: 'RemoteCommand', count: 500, oldestAt: null, policy: 'manual review' },
      { name: 'DeployJob', count: 0, oldestAt: null, policy: 'manual review' },
    ],
  },
};

function api(answer: unknown) {
  return stubApi(({ path }: RecordedRequest) => {
    if (path === '/console/session') return { success: true, data: { userId: 'alice', role: 'VIEWER', capabilities: { hermes: false, terminal: false, agentVersion: '2.0.0', magnusVersion: '2.0.0', securityConsoleUrl: null } } };
    if (path === '/ops/retention') return answer;
    return undefined;
  });
}
async function load(answer: unknown = SUMMARY) {
  const stub = api(answer);
  vi.stubGlobal('fetch', stub.request);
  await sessionStore.load();
  const mounted = await mount(<RetentionPage />);
  await settle(5);
  return { stub, mounted };
}
const rows = () => [...document.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''));

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

describe('the retention page', () => {
  it('reads once, for any role, and changes nothing', async () => {
    const { stub, mounted } = await load();
    expect(stub.of('/ops/retention')).toHaveLength(1);
    expect(stub.mutations()).toEqual([]);
    await mounted.unmount();
  });
  it('shows each table with its rows, oldest row, policy and cutoffs', async () => {
    const { mounted } = await load();
    const [health, commands, deploys] = rows();
    expect(health![0]).toBe('HealthSnapshot');
    expect(health![1]).toBe('1,500');
    expect(health![2]).toContain('75%');
    expect(health![5]).toContain('Full fidelity after:');
    expect(health![5]).toContain('Expires before:');
    expect(commands![3]).toBe('Not tracked');
    expect(deploys![3]).toBe('None');
    expect(deploys![5]).toBe('None');
    await mounted.unmount();
  });
  it('totals the rows and reports the policy check', async () => {
    const { mounted } = await load();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Total records2,000');
    expect(text).toContain('Tables tracked3');
    expect(text).toContain('Policy fail');
    expect(text).toContain('LOG_RETENTION_DAYS is not set');
    await mounted.unmount();
  });
  it('names the tables nothing purges', async () => {
    const { mounted } = await load();
    expect(document.body.textContent).toContain('Kept until reviewed');
    expect(document.body.textContent).toContain('RemoteCommand500');
    await mounted.unmount();
  });
  it('offers Retry when the read fails', async () => {
    const { mounted } = await load(new Response(JSON.stringify({ success: false, error: { message: 'Database unavailable' } }), { status: 503 }));
    expect(document.body.textContent).toContain('Retention data unavailable');
    expect(button('Retry')).toBeDefined();
    await mounted.unmount();
  });
});
