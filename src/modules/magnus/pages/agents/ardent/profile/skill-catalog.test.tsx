// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccess, configureEndpoint } from '../../../../../../lib/transport';
import { sessionStore } from '../../../../session-store';
import { button, click, mount, settle, stubApi, stubBrowser, type, type Mounted } from '../../../../test-dom';
import ArdentProfilePage from './page';

const SHA = (char: string) => char.repeat(64);
const BASE = '/ardent/installations/node-1/profiles/lead';
const installation = (studio: number) => ({
  nodeId: 'node-1', nodeName: 'alpha', hostname: 'alpha.example.com', reachable: true, error: null, installed: true, version: '2.2.0', owner: 'operator', checkedAt: '2026-11-08T00:00:00.000Z',
  capabilities: { studio }, profiles: [{ id: 'lead', name: 'lead', backend: 'llamacpp', apiPort: 9910, running: true, a2aEnabled: false, channels: {}, error: null }],
});
const CATALOG = [
  { slug: 'web-research', name: 'Web research', description: 'Search the web carefully.', homepage: null, enabled: true, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' },
  { slug: 'hivemem', name: 'HiveMem', description: 'Durable memory.', homepage: null, enabled: true, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' },
];
const RESULT = { source: 'hiveskills', name: 'web-research', version: '1.2.0', sha256: SHA('f'), files: 2, changed: true, enabled: true, revision: SHA('d'), enable_error: null, activation_required: true };

let view: Mounted | undefined;
let skills: Array<{ name: string; description: string; hash: string; enabled: boolean }>;

async function load(options: { studio?: number; role?: string; install?: () => unknown } = {}) {
  const stub = stubApi(({ method, path, body }) => {
    if (path === '/console/session') return { success: true, data: { userId: 'alice', role: options.role ?? 'ADMIN', capabilities: { hermes: false, terminal: false, agentVersion: '1.2.0', magnusVersion: '1.2.0', securityConsoleUrl: null } } };
    if (path === '/ardent/installations/node-1') return { success: true, data: installation(options.studio ?? 3) };
    if (path === `${BASE}/status`) return { success: true, data: { backend: 'llamacpp' } };
    if (path === `${BASE}/tasks`) return { success: true, data: { tasks: [] } };
    if (path === `${BASE}/skills`) return { success: true, data: { skills } };
    if (path === `${BASE}/config`) return { success: true, data: { text: 'profile: lead\n', revision: SHA('c') } };
    if (path === `${BASE}/memory/status`) return { success: true, data: { status: 'ready', agent_id: 'lead', workspace_id: 'ws-1', retrieval: null, storage: null, reason: null } };
    if (path === '/api/skills/v1/skills') return CATALOG;
    if (path === '/api/skills/v1/skills/web-research') return { ...CATALOG[0], release: { version: '1.2.0', sha256: SHA('f'), notes: null, createdAt: '2026-11-02T00:00:00.000Z' } };
    if (path === '/api/skills/v1/skills/hivemem') return { ...CATALOG[1], release: null };
    if (method === 'POST' && path === `${BASE}/action` && body?.action === 'skill-install') {
      const answer = options.install?.() ?? { success: true, data: RESULT };
      if (!(answer instanceof Response)) skills = [...skills, { name: 'web-research', description: 'Search the web carefully.', hash: 'h2', enabled: true }];
      return answer;
    }
    return undefined;
  });
  vi.stubGlobal('fetch', stub.request);
  await sessionStore.load();
  view = await mount(<ArdentProfilePage />, { id: 'node-1~lead' });
  await settle(10);
  await click(button('Skills'));
  await settle(10);
  return stub;
}

beforeEach(() => {
  stubBrowser();
  configureEndpoint('magnus', '/api/magnus');
  sessionStore.reset();
  skills = [{ name: 'outline', description: 'Outlines', hash: 'h1', enabled: true }];
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  clearAccess();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const catalog = () => document.querySelector('[aria-label="Catalog skills"]')!;

describe('the HiveSkills catalog on an Ardent profile', () => {
  it('searches the catalog and installs the promoted release, enabled with the configuration revision', async () => {
    const stub = await load();
    expect(catalog().textContent).toContain('Web research');
    await type(document.querySelector('input[aria-label="Search the HiveSkills catalog"]'), 'memory');
    expect(catalog().textContent).not.toContain('Web research');
    await type(document.querySelector('input[aria-label="Search the HiveSkills catalog"]'), '');
    await click(button('Choose', catalog().querySelectorAll('li')[0]!));
    await settle(5);
    expect(document.body.textContent).toContain('Release 1.2.0 (stable)');
    await click(button('Install'));
    await settle(10);
    const install = stub.mutations().find((item) => item.path === `${BASE}/action`)!;
    expect(install.body).toEqual({ action: 'skill-install', body: { source: 'hiveskills', name: 'web-research', version: '1.2.0', enable: true, revision: SHA('c') } });
    expect(document.querySelector('[role="status"].text-success')?.textContent).toBe('Installed web-research 1.2.0 and enabled. Restart the profile to activate it.');
    // The skill list is read again and shows the new skill.
    expect(document.body.textContent).toContain('web-research');
    expect(stub.of(`${BASE}/skills`).length).toBeGreaterThan(1);
  });

  it('installs without enabling, and says when no release is promoted', async () => {
    const stub = await load();
    await click(button('Choose', catalog().querySelectorAll('li')[1]!));
    await settle(5);
    expect(document.body.textContent).toContain('No release of hivemem is promoted on the stable channel.');
    expect(button('Install')).toBeUndefined();
    await click(button('Choose', catalog().querySelectorAll('li')[0]!));
    await settle(5);
    await click(document.querySelector('label.toggle input'));
    await click(button('Install'));
    await settle(10);
    expect(stub.mutations().find((item) => item.path === `${BASE}/action`)!.body).toEqual({ action: 'skill-install', body: { source: 'hiveskills', name: 'web-research', version: '1.2.0' } });
  });

  it('asks for an agent upgrade below studio level 3 and explains an older Magnus', async () => {
    await load({ studio: 2 });
    expect(document.body.textContent).toContain('Upgrade the Magnus agent on alpha to install catalog skills.');
    await click(button('Choose', catalog().querySelectorAll('li')[0]!));
    await settle(5);
    expect(button('Install')?.disabled).toBe(true);
    await view?.unmount();
    await load({ install: () => Response.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid Ardent action' } }, { status: 400 }) });
    await click(button('Choose', catalog().querySelectorAll('li')[0]!));
    await settle(5);
    await click(button('Install'));
    await settle(10);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('This Magnus release cannot install catalog skills. Upgrade Magnus first.');
  });

  it('is not offered to a person without ADMIN', async () => {
    await load({ role: 'OPERATOR' });
    expect(document.querySelector('[aria-label="Catalog skills"]')).toBeNull();
  });
});
