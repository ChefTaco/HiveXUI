// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccess, configureEndpoint } from '../../../../../lib/transport';
import { sessionStore } from '../../../session-store';
import { button, click, mount, settle, stubApi, stubBrowser, type RecordedRequest } from '../../../test-dom';
import NodeDetailPage from './page';

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
    loadAddon() {}
    open() {}
    focus() {}
    dispose() {}
    write() {}
    attachCustomKeyEventHandler() {}
    onData = () => ({ dispose() {} });
    onBinary = () => ({ dispose() {} });
    onResize = () => ({ dispose() {} });
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));

const AT = '2026-11-05T12:00:00.000Z';
const NODE = {
  id: 'node-1', name: 'node one', hostname: 'node-1.example.com', ipAddress: '192.0.2.10', port: 4100, status: 'ONLINE', os: 'linux', arch: 'x64', tags: '[]', metadata: '{}', roleId: null,
  lastHeartbeatAt: AT, createdAt: AT, updatedAt: AT, role: null, upgradeReadiness: null,
  agent: { id: 'agent-1', nodeId: 'node-1', version: '1.1.1', status: 'RUNNING', pid: 1, startedAt: AT, lastCheckIn: AT, capabilities: '{}' },
};

function api(role: string, terminal: boolean) {
  return stubApi(({ method, path }: RecordedRequest) => {
    if (path === '/console/session') return { success: true, data: { userId: 'alice', role, capabilities: { hermes: false, terminal, agentVersion: '1.1.1', magnusVersion: '1.1.1', securityConsoleUrl: null } } };
    if (method === 'GET' && path === '/nodes/node-1') return { success: true, data: NODE };
    return undefined;
  });
}
async function load(role: string, terminal: boolean) {
  const stub = api(role, terminal);
  vi.stubGlobal('fetch', stub.request);
  await sessionStore.load();
  const mounted = await mount(<NodeDetailPage />, { nodeId: 'node-1' });
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

describe('terminal controls on node detail', () => {
  it('are hidden unless the session has the terminal capability', async () => {
    const { mounted } = await load('ADMIN', false);
    expect(button('Delete')).toBeDefined();
    expect(button('Terminal')).toBeUndefined();
    await mounted.unmount();
  });
  it('follow the capability, not the role', async () => {
    const { mounted } = await load('VIEWER', true);
    expect(button('Terminal')).toBeDefined();
    await mounted.unmount();
  });
  it('contact no gateway until someone opens a terminal', async () => {
    const { stub, mounted } = await load('ADMIN', true);
    expect(stub.requests.filter((request) => request.path.startsWith('/terminal/'))).toEqual([]);
    await mounted.unmount();
  });
  it('open the panel on a click, which starts a session', async () => {
    const { stub, mounted } = await load('ADMIN', true);
    await click(button('Terminal'));
    // The panel is a lazy chunk.
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Terminal on node one'), { timeout: 5000 });
    await mounted.unmount();
    expect(stub.mutations().filter((request) => !request.path.startsWith('/terminal/'))).toEqual([]);
  });
});
