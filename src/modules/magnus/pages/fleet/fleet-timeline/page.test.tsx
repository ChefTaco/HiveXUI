// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccess, configureEndpoint } from '../../../../../lib/transport';
import { sessionStore } from '../../../session-store';
import { button, click, mount, settle, stubApi, stubBrowser, type RecordedRequest } from '../../../test-dom';
import FleetTimelinePage from './page';

const ITEMS = [
  { type: 'command', severity: 'error', title: 'df -h FAILED', node: 'node-1', timestamp: '2026-11-05T11:00:00.000Z', href: '/commands?commandId=c1' },
  { type: 'hermes', severity: 'info', title: 'profile sync', node: 'node-2', timestamp: '2026-11-05T10:00:00.000Z', href: '/orchestra/installations' },
  { type: 'log', severity: 'warn', title: 'disk filling', node: null, timestamp: '2026-11-05T09:00:00.000Z', href: '/logs' },
];

function api(role: string, hermes: boolean, timeline: unknown = { success: true, data: ITEMS }) {
  return stubApi(({ method, path }: RecordedRequest) => {
    if (path === '/console/session') return { success: true, data: { userId: 'alice', role, capabilities: { hermes, terminal: false, agentVersion: '2.0.0', magnusVersion: '2.0.0', securityConsoleUrl: null } } };
    if (method === 'GET' && path.startsWith('/ops/timeline')) return timeline;
    return undefined;
  });
}
async function load(role: string, hermes = false, timeline?: unknown) {
  const stub = api(role, hermes, timeline);
  vi.stubGlobal('fetch', stub.request);
  await sessionStore.load();
  const mounted = await mount(<FleetTimelinePage />);
  await settle(5);
  return { stub, mounted };
}
const links = () => [...document.querySelectorAll('ol a')].map((link) => link.textContent);
const titles = () => [...document.querySelectorAll('ol li')].map((row) => row.textContent ?? '');

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

describe('the fleet timeline page', () => {
  it('asks for the latest 120 events and only reads', async () => {
    const { stub, mounted } = await load('VIEWER');
    expect(stub.requests.map(({ path }) => path)).toContain('/ops/timeline?limit=120');
    expect(stub.mutations()).toEqual([]);
    await mounted.unmount();
  });
  it('sums up the stream', async () => {
    const { mounted } = await load('VIEWER');
    const summary = document.querySelector('[aria-label="Timeline summary"]')!.textContent;
    expect(summary).toContain('Events3');
    expect(summary).toContain('Needs attention2');
    expect(summary).toContain('Nodes involved2');
    await mounted.unmount();
  });
  it('links only to pages the session may open', async () => {
    let { mounted } = await load('VIEWER');
    expect(links()).toEqual(['disk filling']);
    await mounted.unmount();
    sessionStore.reset();
    ({ mounted } = await load('OPERATOR', true));
    expect(links()).toEqual(['df -h FAILED', 'profile sync', 'disk filling']);
    await mounted.unmount();
  });
  it('filters by type', async () => {
    const { mounted } = await load('ADMIN');
    await click(button(/^log/));
    expect(titles()).toHaveLength(1);
    expect(titles()[0]).toContain('disk filling');
    await click(button(/^audit/));
    expect(document.body.textContent).toContain('No audit events in the latest 120');
    await mounted.unmount();
  });
  it('says so when there is nothing yet, and when the read fails', async () => {
    let { mounted } = await load('VIEWER', false, { success: true, data: [] });
    expect(document.body.textContent).toContain('Nothing on the timeline yet');
    await mounted.unmount();
    sessionStore.reset();
    ({ mounted } = await load('VIEWER', false, new Response(JSON.stringify({ success: false, error: { message: 'Database unavailable' } }), { status: 503 })));
    expect(document.body.textContent).toContain('Timeline data unavailable');
    expect(button('Retry')).toBeDefined();
    await mounted.unmount();
  });
});
