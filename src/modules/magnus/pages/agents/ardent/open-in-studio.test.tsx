// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccess, configureEndpoint } from '../../../../../lib/transport';
import { sessionStore } from '../../../session-store';
import { click, mount, settle, stubApi, stubBrowser, type Mounted } from '../../../test-dom';
import ArdentProfilePage from './profile/page';

const runtime = vi.hoisted(() => ({ studio: true }));
vi.mock('../../../../../lib/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../lib/runtime')>()),
  productInstalled: (product: string) => (product === 'ardentstudio' ? runtime.studio : true),
}));

const INSTALLATION = {
  nodeId: 'node-1', nodeName: 'alpha', hostname: 'alpha.example.com', reachable: true, error: null, installed: true, version: '2.2.0', owner: 'operator', checkedAt: '2026-11-08T00:00:00.000Z',
  capabilities: { studio: 2 }, profiles: [{ id: 'lead', name: 'lead', backend: 'llamacpp', apiPort: 9910, running: true, a2aEnabled: false, channels: {}, error: null }],
};

let view: Mounted | undefined;
async function load() {
  const stub = stubApi(({ path }) => {
    if (path === '/console/session') return { success: true, data: { userId: 'alice', role: 'OPERATOR', capabilities: { hermes: false, terminal: false, agentVersion: '1.2.0', magnusVersion: '1.2.0', securityConsoleUrl: null } } };
    if (path === '/ardent/installations/node-1') return { success: true, data: INSTALLATION };
    if (path === '/ardent/installations/node-1/profiles/lead/status') return { success: true, data: { backend: 'llamacpp' } };
    return undefined;
  });
  vi.stubGlobal('fetch', stub.request);
  await sessionStore.load();
  view = await mount(<ArdentProfilePage />, { id: 'node-1~lead' });
  await settle(10);
  return view.container;
}
const studioLink = (root: ParentNode) => [...root.querySelectorAll('a')].find((link) => link.textContent?.includes('Open in Studio'));

beforeEach(() => {
  stubBrowser();
  configureEndpoint('magnus', '/api/magnus');
  sessionStore.reset();
  runtime.studio = true;
  history.replaceState(null, '', '/fleet/ardent/profiles/node-1~lead');
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  clearAccess();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

describe('Open in Studio on an Ardent profile', () => {
  it('opens the agent in Agent Studio, which closes back to this page', async () => {
    const root = await load();
    const link = studioLink(root);
    expect(link?.getAttribute('href')).toBe('/studio/agents/node-1~lead');
    await click(link);
    expect(location.pathname).toBe('/studio/agents/node-1~lead');
    expect(history.state).toEqual({ studioOrigin: '/fleet/ardent/profiles/node-1~lead' });
  });

  it('is not offered without Ardent Project Studio', async () => {
    runtime.studio = false;
    const root = await load();
    expect(root.textContent).toContain('Magnus Ardent / lead');
    expect(studioLink(root)).toBeUndefined();
  });
});
