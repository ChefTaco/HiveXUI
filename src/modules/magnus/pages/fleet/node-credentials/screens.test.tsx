// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccess, configureEndpoint } from '../../../../../lib/transport';
import { sessionStore } from '../../../session-store';
import { button, click, dialog, mount, settle, stubApi, stubBrowser, type, type RecordedRequest } from '../../../test-dom';
import NodeDetailPage from '../node-detail/page';
import NodesPage from '../nodes/page';
import FleetOverviewPage from '../overview/page';
import { binding, credential, node, nodeKey, resetResult, revokeResult, session, summary, summaryV3 } from './fixtures';

vi.mock('@xterm/xterm', () => ({ Terminal: class {} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }));

const ok = (data: unknown) => ({ success: true, data });
const AT_REVOKED = '2026-11-04T12:00:00.000Z';
const page = (nodes: unknown[]) => ({ success: true, data: nodes, meta: { total: nodes.length, page: 1, pageSize: 100, hasMore: false } });

interface Fleet {
  role: string;
  nodes: unknown[];
  /** Absent: the summary route answers 404, as on an older Magnus. */
  summary?: unknown;
  /** Answer the summary read with this instead (a failure, or a promise that never settles). */
  summaryAnswer?: () => Response | Promise<Response>;
  pending?: unknown[];
  decision?: (request: RecordedRequest) => unknown;
  /** Absent: the key list answers 404, as on a Magnus that keeps key administration out of the browser. */
  keys?: unknown[];
  keyAction?: (request: RecordedRequest) => unknown;
}
function serve({ role, nodes, summary: fleetSummary, summaryAnswer, pending = [], decision, keys, keyAction }: Fleet) {
  const stub = stubApi((request) => {
    const { method, path } = request;
    if (path === '/console/session') return session(role);
    if (method === 'GET' && path.startsWith('/nodes?')) return page(nodes);
    if (method === 'GET' && path.startsWith('/nodes/') && !path.includes('/', '/nodes/'.length)) return ok(nodes.find((item) => path === `/nodes/${(item as { id: string }).id}`));
    if (method === 'GET' && /^\/nodes\/[^/]+\/credentials$/u.test(path)) return keys === undefined ? undefined : ok(keys);
    if (method === 'POST' && /^\/nodes\/[^/]+\/credentials\/(?:revoke|reset)$/u.test(path)) return keyAction?.(request);
    if (method === 'GET' && path === '/node-credentials/summary') return fleetSummary === undefined ? undefined : ok(fleetSummary);
    if (method === 'GET' && path.startsWith('/node-credentials/pending-bindings')) return fleetSummary === undefined ? undefined : ok(pending);
    if (method === 'POST' && path.startsWith('/node-credentials/pending-bindings/')) return decision?.(request);
    if (method === 'GET' && path.startsWith('/node-credentials/downgrade-check')) return ok({ nodeId: 'node-1', to: '2.9.1', targetKnowsNodeKeys: false, nodeHasCredentials: true, action: 'reset-credentials', resetPath: '/api/v1/nodes/node-1/credentials/reset', detail: 'magnus-agent 2.9.1 only knows the shared node secret' });
    return undefined;
  });
  const request: typeof fetch = (input, init) => {
    const path = new URL(String(input), 'https://console.example.com').pathname;
    if (summaryAnswer && path.endsWith('/node-credentials/summary')) {
      stub.requests.push({ method: 'GET', path: '/node-credentials/summary', body: null });
      return Promise.resolve(summaryAnswer());
    }
    return stub.request(input, init);
  };
  vi.stubGlobal('fetch', request);
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
  it('shows Magnus 3.0.0’s deprecated mode, server key rotation and the agents to upgrade', async () => {
    const { stub, mounted } = await open(<NodesPage />, { role: 'ADMIN', nodes: FLEET, summary: summaryV3(), pending: [binding()] });
    const panel = document.getElementById('node-credentials')!;
    expect(panel.textContent).toContain('mode: warn (set)');
    const warning = panel.querySelector('[role="group"][aria-labelledby="node-credentials-deprecated"]');
    expect(warning?.textContent).toContain('NODE_AUTH_MODE=warn is deprecated');
    expect(warning?.textContent).toContain('is removed in the next major release.');
    expect(panel.textContent).toContain("Set explicitly: NODE_AUTH_MODE=warn in the server's environment.");
    expect(panel.textContent).toContain('Server key rotation');
    expect(panel.textContent).toContain('eeeeeeeeeeeeeeee');
    expect(panel.textContent).toContain('dddddddddddddddd');
    expect(panel.textContent).toContain('9999999999999999');
    expect(panel.querySelector('[aria-label="Server key rotation status"]')?.textContent).toContain('2 of 3 keyed nodes\' agents pin it');
    expect(panel.textContent).toContain('magnus-server node-auth server-key stage');
    expect(panel.textContent).toContain('Agents enforce mode cannot reach (2.10.0 or 2.10.1)');
    expect(panel.textContent).toContain('Upgrade these agents to 2.10.2 or later.');
    // Rotation stays with the API and the command line: the UI offers no button and sends nothing.
    expect(button('Stage', panel)).toBeUndefined();
    expect(button('Promote', panel)).toBeUndefined();
    expect(stub.mutations()).toEqual([]);
    await mounted.unmount();
  });
  it('adds nothing new against a Magnus before 3.0.0', async () => {
    const { mounted } = await open(<NodesPage />, { role: 'ADMIN', nodes: FLEET, summary: summary(), pending: [binding()] });
    const panel = document.getElementById('node-credentials')!;
    expect(panel.textContent).toContain('mode: warn');
    expect(panel.textContent).not.toContain('(set)');
    expect(panel.textContent).not.toContain('(default)');
    expect(panel.textContent).not.toContain('deprecated');
    expect(panel.textContent).not.toContain('Server key rotation');
    expect(panel.textContent).toContain('Do not set NODE_AUTH_MODE=enforce');
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

describe('node key administration', () => {
  const KEYS = [nodeKey(), nodeKey({ keyId: 'b'.repeat(64), keyFingerprint: 'bcbcbcbcbcbcbcbc', status: 'RETIRING', origin: 'ROTATION', retireAt: '2026-11-06T12:00:00.000Z', lastUsedAt: null }), nodeKey({ keyId: 'c'.repeat(64), keyFingerprint: 'cdcdcdcdcdcdcdcd', status: 'REVOKED', origin: 'ENROLLMENT_TOKEN', revokedAt: AT_REVOKED, revokedBy: 'alice' })];
  const card = () => [...document.querySelectorAll('section')].find((section) => section.querySelector('h3')?.textContent === 'Node credential');
  const reasonInput = () => dialog()?.querySelector('textarea') ?? null;

  it('lists every key for an administrator, with Revoke and Reset, and keeps rotate and enrollment as CLI text', async () => {
    const { stub, mounted } = await open(<NodeDetailPage />, { role: 'ADMIN', nodes: [node('node-1', 'node one', credential())], summary: summary(), keys: KEYS }, { nodeId: 'node-1' });
    const table = card()?.querySelector('[aria-label="Keys of this node"] table');
    expect(table).toBeTruthy();
    const rows = [...table!.querySelectorAll('tbody tr')].map((row) => row.textContent ?? '');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('abababababababab');
    expect(rows[0]).toContain('active');
    expect(rows[0]).toContain('Bound automatically while moving off the shared secret');
    expect(rows[1]).toContain('retiring');
    expect(rows[1]).toContain('never');
    expect(rows[2]).toContain('revoked');
    expect(rows[2]).toContain('Enrolled with a one-time token');
    expect(button('Revoke', card())).toBeDefined();
    expect(button('Reset', card())).toBeDefined();
    const steps = card()!.querySelector('details:last-of-type')!.textContent ?? '';
    expect(steps).toContain('magnus-agent identity rotate');
    expect(steps).toContain('/enrollment-token');
    expect(steps).not.toContain('/credentials/revoke');
    expect(steps).not.toContain('/credentials/reset');
    expect(stub.of('/nodes/node-1/credentials')).toHaveLength(1);
    await mounted.unmount();
  });

  it('gives operators and viewers no key buttons, and does not ask for the key list', async () => {
    for (const role of ['OPERATOR', 'VIEWER']) {
      const { stub, mounted } = await open(<NodeDetailPage />, { role, nodes: [node('node-1', 'node one', credential())], summary: summary(), keys: KEYS }, { nodeId: 'node-1' });
      expect(card()).toBeDefined();
      expect(button('Revoke', card())).toBeUndefined();
      expect(button('Reset', card())).toBeUndefined();
      expect(stub.of('/nodes/node-1/credentials')).toEqual([]);
      expect(card()!.textContent).toContain('/credentials/revoke');
      await mounted.unmount();
      document.body.innerHTML = '';
    }
  });

  it('explains a revoke before sending it, sends one request with the reason and an idempotency key, then shows Magnus’s detail and reads everything again', async () => {
    const { stub, mounted } = await open(<NodeDetailPage />, { role: 'ADMIN', nodes: [node('node-1', 'node one', credential())], summary: summary(), keys: KEYS, keyAction: () => ok(revokeResult({ revoked: 2 })) }, { nodeId: 'node-1' });
    const reads = { node: stub.of('/nodes/node-1').length, keys: stub.of('/nodes/node-1/credentials').length, summary: stub.of('/node-credentials/summary').length };
    await click(button('Revoke', card()));
    const confirm = dialog();
    expect(confirm?.textContent).toContain('Revoke all 2 valid keys of node one?');
    expect(confirm?.textContent).toContain('Key fingerprint: abababababababab (active)');
    expect(confirm?.textContent).toContain('Key fingerprint: bcbcbcbcbcbcbcbc (retiring)');
    expect(confirm?.textContent).not.toContain('cdcdcdcdcdcdcdcd');
    expect(confirm?.textContent).toContain('until the node is enrolled again with a token, or its credentials are reset');
    expect(stub.mutations()).toEqual([]);
    await type(reasonInput(), '  host was rebuilt  ');
    expect(confirm?.textContent).toContain('20/500');
    await click(button('Revoke', confirm!));
    await settle(5);
    expect(stub.mutations()).toEqual([{ method: 'POST', path: '/nodes/node-1/credentials/revoke', body: { reason: 'host was rebuilt' } }]);
    const key = stub.headersOf(stub.mutations()[0]!).get('x-idempotency-key');
    expect(key).toMatch(/^[a-f0-9]{32}$/u);
    const status = card()!.querySelector('[role="status"]');
    expect(status?.textContent).toContain('Revoked 1 key. The agent is refused until it is enrolled with a new token.');
    expect(status?.textContent).toContain('2 keys revoked: the agent is refused until it is enrolled again or reset');
    expect(stub.of('/nodes/node-1').length).toBeGreaterThan(reads.node);
    expect(stub.of('/nodes/node-1/credentials').length).toBeGreaterThan(reads.keys);
    expect(stub.of('/node-credentials/summary').length).toBeGreaterThan(reads.summary);
    await mounted.unmount();
  });

  it('sends nothing on cancel, and a new idempotency key for each confirmation', async () => {
    const { stub, mounted } = await open(<NodeDetailPage />, { role: 'ADMIN', nodes: [node('node-1', 'node one', credential())], summary: summary(), keys: KEYS, keyAction: () => ok(revokeResult()) }, { nodeId: 'node-1' });
    await click(button('Revoke', card()));
    await click(button('Cancel', dialog()!));
    expect(dialog()).toBeNull();
    expect(stub.mutations()).toEqual([]);
    for (let attempt = 0; attempt < 2; attempt++) {
      await click(button('Revoke', card()));
      // The reason starts empty each time.
      expect(reasonInput()?.value).toBe('');
      await click(button('Revoke', dialog()!));
      await settle(5);
    }
    expect(stub.mutations()).toEqual([
      { method: 'POST', path: '/nodes/node-1/credentials/revoke', body: {} },
      { method: 'POST', path: '/nodes/node-1/credentials/revoke', body: {} },
    ]);
    const keys = stub.mutations().map((request) => stub.headersOf(request).get('x-idempotency-key'));
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(2);
    await mounted.unmount();
  });

  it('bounds the reason to what Magnus accepts and shows the count', async () => {
    const { mounted } = await open(<NodeDetailPage />, { role: 'ADMIN', nodes: [node('node-1', 'node one', credential())], summary: summary(), keys: KEYS }, { nodeId: 'node-1' });
    await click(button('Reset', card()));
    const input = reasonInput();
    expect(input?.maxLength).toBe(500);
    expect(input?.labels?.[0]?.textContent).toBe('Reason (optional)');
    expect(document.getElementById(input!.getAttribute('aria-describedby')!)?.textContent).toContain('0/500');
    await type(input, 'x'.repeat(500));
    expect(dialog()?.textContent).toContain('500/500');
    await click(button('Cancel', dialog()!));
    await mounted.unmount();
  });

  it('explains a reset with the upgrade window, sends it, and shows what Magnus says', async () => {
    const { stub, mounted } = await open(<NodeDetailPage />, { role: 'ADMIN', nodes: [node('node-1', 'node one', credential())], summary: summary(), keys: KEYS, keyAction: () => ok(resetResult({ removed: 3 })) }, { nodeId: 'node-1' });
    await click(button('Reset', card()));
    const confirm = dialog();
    expect(confirm?.textContent).toContain('Move node one back to the shared secret?');
    expect(confirm?.textContent).toContain('Magnus forgets its 3 keys and accepts the fleet-wide shared secret from this node again');
    expect(confirm?.textContent).toContain('The automatic upgrade window is open until');
    expect(confirm?.textContent).toContain('binds a new key by itself after its next heartbeat');
    await click(button('Reset', confirm!));
    await settle(5);
    expect(stub.mutations()).toEqual([{ method: 'POST', path: '/nodes/node-1/credentials/reset', body: {} }]);
    expect(card()!.querySelector('[role="status"]')?.textContent).toContain('The node is accepted with the shared node secret again.');
    await mounted.unmount();
  });

  it('offers no reset in enforce mode, and explains Magnus’s refusal codes', async () => {
    let { mounted } = await open(<NodeDetailPage />, { role: 'ADMIN', nodes: [node('node-1', 'node one', credential())], summary: summary({ mode: 'enforce' }), keys: KEYS }, { nodeId: 'node-1' });
    expect(button('Reset', card())?.disabled).toBe(true);
    expect(card()!.textContent).toContain('NODE_AUTH_MODE=enforce, which has no credential reset');
    await mounted.unmount();
    document.body.innerHTML = '';
    let stub;
    ({ stub, mounted } = await open(<NodeDetailPage />, {
      role: 'ADMIN', nodes: [node('node-1', 'node one', credential())], summary: summary(), keys: KEYS,
      keyAction: () => Response.json({ success: false, error: { code: 'NODE_AUTH_ENFORCED', message: 'Credentials cannot be reset in enforce mode' } }, { status: 409 }),
    }, { nodeId: 'node-1' }));
    await click(button('Reset', card()));
    await click(button('Reset', dialog()!));
    await settle(5);
    expect(stub.mutations()).toHaveLength(1);
    expect(text()).toContain('The credentials could not be reset');
    expect(text()).toContain('Keep an agent of 2.10.0 or later on the node, or enroll it again with a token');
    expect(card()!.querySelector('[role="status"]')).toBeNull();
    await mounted.unmount();
  });

  it('offers no reset on a Magnus 3.0.0 in its default enforce mode, says why, and keeps Revoke', async () => {
    const { mounted } = await open(<NodeDetailPage />, { role: 'ADMIN', nodes: [node('node-1', 'node one', credential())], summary: summaryV3({ mode: 'enforce', modeExplicit: false, modeDeprecated: false, deprecationNotice: null, enforceReady: true, blockers: [] }), keys: KEYS }, { nodeId: 'node-1' });
    expect(button('Reset', card())?.disabled).toBe(true);
    expect(button('Reset', card())?.title).toContain('enforce mode (the default)');
    expect(card()!.textContent).toContain('which has no credential reset: Magnus refuses it. Revoke still works.');
    expect(button('Revoke', card())?.disabled).toBe(false);
    await mounted.unmount();
  });

  it('holds Reset back while the node-auth mode is being read, and keeps Revoke', async () => {
    const { stub, mounted } = await open(<NodeDetailPage />, { role: 'ADMIN', nodes: [node('node-1', 'node one', credential())], summaryAnswer: () => new Promise<Response>(() => {}), keys: KEYS }, { nodeId: 'node-1' });
    expect(stub.of('/node-credentials/summary')).toHaveLength(1);
    expect(button('Reset', card())?.disabled).toBe(true);
    expect(button('Reset', card())?.title).toBe('Checking node-auth mode…');
    expect(card()!.textContent).toContain('Checking node-auth mode…');
    expect(button('Revoke', card())?.disabled).toBe(false);
    await click(button('Reset', card()));
    expect(dialog()).toBeNull();
    expect(stub.mutations()).toEqual([]);
    await mounted.unmount();
  });

  it('holds Reset back when the node-auth mode could not be read, and shows the reset step as text', async () => {
    const { stub, mounted } = await open(<NodeDetailPage />, {
      role: 'ADMIN', nodes: [node('node-1', 'node one', credential())], keys: KEYS,
      summaryAnswer: () => Response.json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } }, { status: 500 }),
    }, { nodeId: 'node-1' });
    expect(button('Reset', card())?.disabled).toBe(true);
    expect(card()!.textContent).toContain('The node-auth mode could not be read, so Reset is not offered here: Magnus refuses it in enforce mode.');
    expect(button('Revoke', card())?.disabled).toBe(false);
    const steps = card()!.querySelector('details:last-of-type')!.textContent ?? '';
    expect(steps).toContain('/credentials/reset');
    expect(steps).toContain('magnus-agent identity reset');
    expect(steps).not.toContain('/credentials/revoke');
    expect(stub.mutations()).toEqual([]);
    await mounted.unmount();
  });

  it('falls back to the CLI text on a Magnus that keeps key administration out of the browser, without an error', async () => {
    const { stub, mounted } = await open(<NodeDetailPage />, { role: 'ADMIN', nodes: [node('node-1', 'node one', credential())], summary: summary() }, { nodeId: 'node-1' });
    expect(stub.of('/nodes/node-1/credentials')).toHaveLength(1);
    expect(button('Revoke', card())).toBeUndefined();
    expect(button('Reset', card())).toBeUndefined();
    expect(card()!.textContent).toContain('/credentials/revoke');
    expect(card()!.textContent).toContain('/credentials/reset');
    expect(card()!.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('.toast--error')).toBeNull();
    await mounted.unmount();
  });
});

describe('rejecting a pending binding', () => {
  it('sends the optional reason given in the confirmation', async () => {
    const { stub, mounted } = await open(<NodesPage />, { role: 'ADMIN', nodes: FLEET, summary: summary(), pending: [binding()], decision: () => ok(binding({ status: 'REJECTED' })) });
    await click(button(/^Approve the key for node two/));
    // Approving asks for no reason.
    expect(dialog()?.querySelector('textarea')).toBeNull();
    await click(button('Cancel', dialog()!));
    await click(button(/^Reject the key for node two/));
    const input = dialog()?.querySelector('textarea');
    expect(input?.maxLength).toBe(500);
    await type(input, ' unknown host ');
    await click(button('Reject', dialog()!));
    await settle(5);
    expect(stub.mutations()).toEqual([{ method: 'POST', path: '/node-credentials/pending-bindings/pb-1/reject', body: { reason: 'unknown host' } }]);
    await mounted.unmount();
  });
});
