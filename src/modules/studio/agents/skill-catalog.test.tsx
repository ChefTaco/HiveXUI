// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type Mounted } from '../../magnus/test-dom';
import StudioModule from '../index';
import { resetProjectStores } from '../state/project-store';
import { agent, serveStudio, type StudioRequest } from '../test-fixtures';

vi.mock('../../../lib/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/runtime')>()),
  productInstalled: (product: string) => product !== 'emberpath',
}));

const REF = 'node-1~lead';
const SHA = (char: string) => char.repeat(64);
const AT = '2026-11-08T10:00:00.000Z';
const NODE = '/ardent/installations/node-1/profiles/lead';
const CATALOG = [{ slug: 'web-research', name: 'Web research', description: 'Search the web carefully.', homepage: null, enabled: true, createdAt: AT, updatedAt: AT }];
const RESULT = { source: 'hiveskills', name: 'web-research', version: '1.2.0', sha256: SHA('f'), files: 2, changed: true, enabled: false, revision: null,
  enable_error: 'The Ardent configuration changed since it was read; enable the skill from the list', activation_required: true };

let studioLevel: number;
let installAnswer: () => unknown;
let skillReads: number;
let server: ReturnType<typeof serveStudio>;
let view: Mounted | undefined;

function studio(request: StudioRequest): unknown {
  if (request.path === '/agents') return { agents: [agent({ display_name: 'Story Lead' })], available_count: 1, magnus: { state: 'ok', error: null } };
  if (request.path === `/agents/${REF}/presentation`) return { agent_ref: REF, display_name: 'Story Lead', portrait: { preset: 'hood', accent: 'persona-2', emblem: 'quill' }, avatar_file_id: null, updated_by: 'operator', updated_at: AT };
  if (request.path === `/agents/${REF}/draft`) return { draft: null };
  if (request.method === 'POST' && request.path === `/agents/${REF}/skills/install`) return installAnswer();
  return undefined;
}

beforeEach(() => {
  stubBrowser();
  studioLevel = 3;
  skillReads = 0;
  installAnswer = () => ({ ...RESULT, note: 'The skill takes effect after the agent\'s profile restarts; restart it from the Magnus console.', restart: { available: false, reason: 'Restart it from the Magnus console.' } });
  server = serveStudio(studio);
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'https://console.example.com');
    if (url.pathname === '/api/magnus/ardent/installations/node-1') return Response.json({ success: true, data: {
      nodeId: 'node-1', nodeName: 'node one', hostname: 'node-1.example.com', reachable: true, error: null, installed: true, version: '2.2.0', owner: 'operator', checkedAt: AT,
      capabilities: { studio: studioLevel }, profiles: [{ id: 'lead', name: 'lead', backend: 'llamacpp', apiPort: 9910, running: true, a2aEnabled: false, channels: {}, error: null }] } });
    if (url.pathname === `/api/magnus${NODE}/skills`) {
      skillReads += 1;
      return Response.json({ success: true, data: { skills: [{ name: 'outline', description: 'Outlines', hash: 'h1', enabled: true }] } });
    }
    if (url.pathname === `/api/magnus${NODE}/config`) return Response.json({ success: true, data: { text: 'execution:\n  backend: llamacpp\n', revision: SHA('c') } });
    if (url.pathname.startsWith(`/api/magnus${NODE}/`)) return Response.json({ success: true, data: url.pathname.endsWith('/tasks') ? { tasks: [] } : url.pathname.endsWith('/peers') ? { peers: [] } : {} });
    if (url.pathname === '/api/skills/v1/skills') return Response.json(CATALOG);
    if (url.pathname === '/api/skills/v1/skills/web-research') return Response.json({ ...CATALOG[0], release: { version: '1.2.0', sha256: SHA('f'), notes: null, createdAt: AT } });
    return server.fetch(input, init);
  });
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  resetProjectStores();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

async function open() {
  history.replaceState({ studioOrigin: '/' }, '', `/studio/agents/${REF}?tab=capabilities`);
  view = await mount(<StudioModule />);
  for (let index = 0; index < 6; index += 1) await settle();
  return view.container;
}
const catalog = (root: ParentNode) => root.querySelector('[aria-label="Catalog skills"]')!;

describe('the HiveSkills catalog in Agent Studio', () => {
  it('installs through the Studio service with an idempotency key and reports an enable that failed', async () => {
    const root = await open();
    expect(root.textContent).toContain('HiveSkills catalog');
    await click(button('Choose', catalog(root)));
    await settle(5);
    await click(button('Install', root));
    await settle(10);
    const sent = server.requests.find((request) => request.method === 'POST' && request.path === `/agents/${REF}/skills/install`)!;
    expect(sent.body).toEqual({ source: 'hiveskills', name: 'web-research', version: '1.2.0', enable: true, revision: SHA('c') });
    expect(sent.headers.get('x-idempotency-key')).toMatch(/^hivexui-/);
    expect(root.querySelector('[role="status"].text-warning')?.textContent).toBe('Installed web-research 1.2.0, but it is not enabled: The Ardent configuration changed since it was read; enable the skill from the list');
    expect(skillReads).toBeGreaterThan(1);
  });

  it('asks for an agent upgrade below studio level 3 and explains an older Studio service', async () => {
    studioLevel = 2;
    let root = await open();
    expect(root.textContent).toContain('Upgrade the Magnus agent on node one to install catalog skills.');
    await view?.unmount();
    studioLevel = 3;
    installAnswer = () => Response.json({ error: { code: 'NOT_FOUND', message: 'No such route' } }, { status: 404 });
    root = await open();
    await click(button('Choose', catalog(root)));
    await settle(5);
    await click(button('Install', root));
    await settle(10);
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Upgrade Ardent Project Studio');
  });
});
