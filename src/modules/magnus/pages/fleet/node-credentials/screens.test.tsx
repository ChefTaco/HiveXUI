// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccess, configureEndpoint } from '../../../../../lib/transport';
import { sessionStore } from '../../../session-store';
import { button, click, dialog, mount, settle, stubApi, stubBrowser, type, type RecordedRequest } from '../../../test-dom';
import NodeDetailPage from '../node-detail/page';
import NodesPage from '../nodes/page';
import FleetOverviewPage from '../overview/page';
import { binding, credential, node, session, summary } from './fixtures';

vi.mock('@xterm/xterm', () => ({ Terminal: class {} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }));

const ok = (data: unknown) => ({ success: true, data });
const page = (nodes: unknown[]) => ({ success: true, data: nodes, meta: { total: nodes.length, page: 1, pageSize: 100, hasMore: false } });

interface Fleet {
  role: string;
  nodes: unknown[];
  /** Absent: the summary route answers 404, as on an older Magnus. */
  summary?: unknown;
  pending?: unknown[];
  decision?: (request: RecordedRequest) => unknown;
}
function serve({ role, nodes, summary: fleetSummary, pending = [], decision }: Fleet) {
  const stub = stubApi((request) => {
    const { method, path } = request;
    if (path === '/console/session') return session(role);
    if (method === 'GET' && path.startsWith('/nodes?')) return page(nodes);
    if (method === 'GET' && path.startsWith('/nodes/') && !path.includes('/', '/nodes/'.length)) return ok(nodes.find((item) => path === `/nodes/${(item as { id: string }).id}`));
    if (method === 'GET' && path === '/node-credentials/summary') return fleetSummary === undefined ? undefined : ok(fleetSummary);
    if (method === 'GET' && path.startsWith('/node-credentials/pending-bindings')) return fleetSummary === undefined ? undefined : ok(pending);
    if (method === 'POST' && path.startsWith('/node-credentials/pending-bindings/')) return decision?.(request);
    if (method === 'GET' && path.startsWith('/node-credentials/downgrade-check')) return ok({ nodeId: 'node-1', to: '2.9.1', targetKnowsNodeKeys: false, nodeHasCredentials: true, action: 'reset-credentials', resetPath: '/api/v1/nodes/node-1/credentials/reset', detail: 'magnus-agent 2.9.1 only knows the shared node secret' });
    return undefined;
  });
  vi.stubGlobal('fetch', stub.request);
  return stub;
}
async function open(element: React.ReactElement, fleet: Fleet, params: Record<string, string> = {}) {
  const stub = serve(fleet);
  await sessionStore.load();
  const mounted = await mount(element, params);
  await settle(5);
  await settle(5);
  return { stub, mounted };
}
const text = () => document.body.textContent ?? '';

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

const FLEET = [node('node-1', 'node one', credential()), node('node-2', 'node two', credential({ state: 'none', origin: null, boundAt: null, lastUsedAt: null, keyFingerprint: null, evidenceSigning: false })), node('node-3', 'node three', credential({ state: 'revoked' }))];

describe('the nodes page on a Magnus without per-node credentials', () => {
  it('shows no credential column or panel, and no error', async () => {
    const { stub, mounted } = await open(<NodesPage />, { role: 'ADMIN', nodes: [node('node-1', 'node one')] });
    expect([...document.querySelectorAll('th')].map((cell) => cell.textContent)).not.toContain('Node key');
    expect(document.getElementById('node-credentials')).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    // The pending list is not even asked for once the summary says the feature is missing.
    expect(stub.requests.filter((request) => request.path.startsWith('/node-credentials/pending-bindings'))).toEqual([]);
    await mounted.unmount();
  });
});

describe('the nodes page with per-node credentials', () => {
  it('shows each node state, the fleet summary and the pending binding of the node without a key', async () => {
    const { mounted } = await open(<NodesPage />, { role: 'ADMIN', nodes: FLEET, summary: summary(), pending: [binding()] });
    const headings = [...document.querySelectorAll('th')].map((cell) => cell.textContent);
    expect(headings).toContain('Node key');
    const badges = [...document.querySelectorAll('tbody td .badge')].map((badge) => badge.textContent);
    expect(badges).toEqual(expect.arrayContaining(['own key', 'awaiting approval', 'key revoked']));
    const panel = document.getElementById('node-credentials')!;
    expect(panel.textContent).toContain('mode: warn');
    expect(panel.textContent).toContain('ffffffffffffffff');
    expect(panel.textContent).toContain('Nodes still on the shared secret');
    expect(panel.textContent).toContain('Not ready for enforce: 2 things block it');
    expect(panel.querySelector('table')?.textContent).toContain('198.51.100.7');
    await mounted.unmount();
  });
  it('approves a binding behind the shared confirmation, then reads the summary and the list again', async () => {
    const { stub, mounted } = await open(<NodesPage />, { role: 'ADMIN', nodes: FLEET, summary: summary(), pending: [binding()], decision: () => ok(binding({ status: 'APPROVED' })) });
    const before = stub.of('/node-credentials/summary').length;
    await click(button(/^Approve the key for node two/));
    const confirm = dialog();
    expect(confirm?.textContent).toContain('Key fingerprint: cccccccccccccccc');
    expect(confirm?.textContent).toContain('Address it called from: 198.51.100.7');
    expect(confirm?.textContent).toContain('Address recorded for the node: 192.0.2.12');
    expect(stub.mutations()).toEqual([]);
    await click(button('Approve', confirm!));
    await settle(5);
    expect(stub.mutations()).toEqual([{ method: 'POST', path: '/node-credentials/pending-bindings/pb-1/approve', body: {} }]);
    expect(stub.of('/node-credentials/summary').length).toBeGreaterThan(before);
    expect(text()).toContain('Key bound to node two');
    await mounted.unmount();
  });
  it('rejects a binding, and shows Magnus’s refusal with what to do', async () => {
    const { stub, mounted } = await open(<NodesPage />, {
      role: 'ADMIN', nodes: FLEET, summary: summary(), pending: [binding()],
      decision: () => Response.json({ success: false, error: { code: 'CONFLICT', message: 'Node already has a credential' } }, { status: 409 }),
    });
    await click(button(/^Reject the key for node two/));
    await click(button('Reject', dialog()!));
    await settle(5);
    expect(stub.mutations()).toEqual([{ method: 'POST', path: '/node-credentials/pending-bindings/pb-1/reject', body: {} }]);
    expect(text()).toContain('enroll it with a token instead');
    await mounted.unmount();
  });
  it('lets an operator read the summary without listing or deciding bindings', async () => {
    const { stub, mounted } = await open(<NodesPage />, { role: 'OPERATOR', nodes: FLEET, summary: summary(), pending: [binding()] });
    expect(document.getElementById('node-credentials')).not.toBeNull();
    expect(button(/^Approve/)).toBeUndefined();
    expect(stub.requests.filter((request) => request.path.startsWith('/node-credentials/pending-bindings'))).toEqual([]);
    await mounted.unmount();
  });
  it('shows a viewer the per-node state only, without asking for the summary', async () => {
    const { stub, mounted } = await open(<NodesPage />, { role: 'VIEWER', nodes: FLEET, summary: summary() });
    expect([...document.querySelectorAll('th')].map((cell) => cell.textContent)).toContain('Node key');
    expect(document.getElementById('node-credentials')).toBeNull();
    expect(stub.requests.filter((request) => request.path.startsWith('/node-credentials/'))).toEqual([]);
    await mounted.unmount();
  });
});

describe('the overview', () => {
  it('raises waiting bindings and links to the panel', async () => {
    const { mounted } = await open(<FleetOverviewPage />, { role: 'ADMIN', nodes: [], summary: summary() });
    expect(text()).toContain('Node credentials need attention');
    expect(text()).toContain('1 key binding waits for an administrator');
    expect(document.querySelector('a[href$="/nodes#node-credentials"]')).not.toBeNull();
    await mounted.unmount();
  });
  it('stays quiet on an older Magnus and when nothing needs a person', async () => {
    let { mounted } = await open(<FleetOverviewPage />, { role: 'ADMIN', nodes: [] });
    expect(text()).not.toContain('Node credentials');
    await mounted.unmount();
    ({ mounted } = await open(<FleetOverviewPage />, { role: 'ADMIN', nodes: [], summary: summary({ pendingBindings: 0 }) }));
    expect(text()).not.toContain('Node credentials');
    await mounted.unmount();
  });
});

describe('node detail', () => {
  it('shows the credential, its shared-credential use and the instructions, with no key administration button', async () => {
    const nodes = [node('node-1', 'node one', credential({ legacyUse: { request: { count: 4, lastUsedAt: '2026-11-05T11:00:00.000Z' }, evidence: null, outbound: null, lastUsedAt: '2026-11-05T11:00:00.000Z' } }))];
    const { mounted } = await open(<NodeDetailPage />, { role: 'ADMIN', nodes, summary: summary() }, { nodeId: 'node-1' });
    const card = [...document.querySelectorAll('section')].find((section) => section.querySelector('h3')?.textContent === 'Node credential');
    expect(card?.textContent).toContain('abababababababab');
    expect(card?.textContent).toContain('Bound automatically while moving off the shared secret');
    expect(card?.textContent).toContain('Requests from the node on the shared secret');
    expect(card?.textContent).toContain('magnus-agent identity rotate');
    for (const name of [/revoke/i, /rotate/i, /reset/i, /enroll/i]) expect(button(name, card)).toBeUndefined();
    await mounted.unmount();
  });
  it('checks a downgrade and shows the reset to post first', async () => {
    const { stub, mounted } = await open(<NodeDetailPage />, { role: 'OPERATOR', nodes: [node('node-1', 'node one', credential())], summary: summary() }, { nodeId: 'node-1' });
    const input = [...document.querySelectorAll('input')].find((item) => item.closest('label')?.textContent?.includes('Agent version to install'));
    await type(input, '2.9.1');
    await click(button('Check'));
    await settle(5);
    expect(stub.of('/node-credentials/downgrade-check?nodeId=node-1&to=2.9.1')).toHaveLength(1);
    expect(text()).toContain("Reset the node's credentials before installing 2.9.1");
    expect(text()).toContain('"$MAGNUS_URL"/api/v1/nodes/node-1/credentials/reset');
    await mounted.unmount();
  });
  it('offers a viewer no downgrade check, and hides the card on an older Magnus', async () => {
    let { mounted } = await open(<NodeDetailPage />, { role: 'VIEWER', nodes: [node('node-1', 'node one', credential({ keyFingerprint: undefined }))] }, { nodeId: 'node-1' });
    expect(text()).toContain('Node credential');
    expect(text()).toContain('shown to administrators');
    expect(text()).not.toContain('Check a downgrade');
    await mounted.unmount();
    ({ mounted } = await open(<NodeDetailPage />, { role: 'ADMIN', nodes: [node('node-1', 'node one')] }, { nodeId: 'node-1' }));
    expect(text()).not.toContain('Node credential');
    await mounted.unmount();
  });
});
