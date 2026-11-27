// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type, type Mounted } from '../../magnus/test-dom';
import StudioModule from '../index';
import { resetProjectStores } from '../state/project-store';
import { AGENT_TEMPLATE_ID, agentTemplateDetail, builtDefinition, definitionOperation, serveStudio, type StudioRequest } from '../test-fixtures';

beforeAll(async () => {
  const { preloadStudioAreas } = await import('../pages');
  await preloadStudioAreas();
}, 60_000);

vi.mock('../../../lib/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/runtime')>()),
  productInstalled: () => true,
}));

/** Obviously fake Emberpath client keys. */
const KEY = 'fixture-emberpath-key-0021';
const KEY_2 = 'fixture-emberpath-key-0022';
const T = '2026-11-08T00:00:00.000Z';
const INSTALLATION = {
  nodeId: 'node-1', nodeName: 'node one', hostname: 'node-1.example.com', reachable: true, error: null, installed: true, version: '3.5.1', owner: 'ardent', checkedAt: T,
  capabilities: { studio: 6 }, profiles: [],
};
const BASE = `/templates/${AGENT_TEMPLATE_ID}/versions/1`;

let route: (request: StudioRequest) => unknown;
let server: ReturnType<typeof serveStudio>;
let view: Mounted | undefined;

beforeEach(() => {
  stubBrowser();
  server = serveStudio((request) => route(request));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
    new URL(String(input), 'https://console.example.com').pathname === '/api/magnus/ardent/installations'
      ? Response.json({ success: true, data: [INSTALLATION] }) : server.fetch(input, init));
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  resetProjectStores();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

/** The Studio answers, with the deploy-check and deploy answers in order. */
function studioRoutes(options: { definition?: ReturnType<typeof builtDefinition>; checks?: unknown[]; deploys?: unknown[]; operations?: unknown[] } = {}) {
  const checks = [...(options.checks ?? [])];
  const deploys = [...(options.deploys ?? [])];
  const operations = [...(options.operations ?? [])];
  route = (request) => {
    if (request.path === `/templates/${AGENT_TEMPLATE_ID}`) return agentTemplateDetail();
    if (request.path === `${BASE}/definition`) return options.definition ?? builtDefinition();
    if (request.path === `${BASE}/deploy-check`) return checks.shift() ?? { definition: { name: 'Archivist', sha256: 'b'.repeat(64) }, omitted: [], preflight: { ok: true, problems: [] } };
    if (request.path === `${BASE}/deploy`) return deploys.shift() ?? definitionOperation('running');
    if (request.path === '/agents/operations/op-def-1') return operations.shift() ?? definitionOperation('succeeded');
    return undefined;
  };
}
const refused = (status: number, code: string, details?: unknown) => Response.json({ error: { code, message: code, ...(details ? { details } : {}) } }, { status });
const fieldInput = (label: string) => [...document.querySelectorAll('label.field')].find((item) => item.querySelector('.field-label')?.textContent === label)?.querySelector('input') ?? null;
const keyOf = (request: StudioRequest) => (request.body as { emberpath_client_key?: string } | null)?.emberpath_client_key;
const posted = () => server.mutations().map((request) => [request.path.replace(BASE, ''), keyOf(request) ?? null]);
const alerts = () => [...document.querySelectorAll('[role="alert"]')].map((item) => item.textContent ?? '');

async function openDrawer() {
  history.replaceState({ studioOrigin: '/' }, '', `/studio/gallery?kind=agents&template=${AGENT_TEMPLATE_ID}`);
  view = await mount(<StudioModule />);
  await settle(20);
  await settle(20);
  await click(button('Create agent'));
  await settle(20);
  await settle(20);
  const drawer = document.querySelector('[role="dialog"]') as HTMLElement;
  expect(drawer.textContent).toContain('Create agent from Archivist');
  return drawer;
}
const submit = async (drawer: HTMLElement) => {
  await click(button('Create agent', drawer));
  await settle(20);
};

describe('Create agent from definition', () => {
  it('asks for the Emberpath key for an alias, sends it to the check and the deploy, then drops it and follows the install', async () => {
    studioRoutes();
    const drawer = await openDrawer();
    const key = fieldInput('Emberpath client key')!;
    expect(key.type).toBe('password');
    expect(key.autocomplete).toBe('off');
    expect(drawer.textContent).toContain('research-large');
    expect(drawer.textContent).toContain('filing: A local skill has no portable source');
    await type(fieldInput('Profile ID'), 'archivist');
    await submit(drawer);
    expect(alerts()).toContain('Enter the Emberpath client key for this agent');
    expect(server.mutations().filter((request) => request.path !== `${BASE}/definition`)).toEqual([]);

    await type(fieldInput('Emberpath client key'), KEY);
    await submit(drawer);
    await settle(20);
    const [check, deploy] = server.mutations().filter((request) => request.path !== `${BASE}/definition`);
    expect(check!.body).toEqual({ node_id: 'node-1', bindings: { hivemem: 'default' }, emberpath_client_key: KEY });
    expect(deploy!.body).toEqual({ node_id: 'node-1', profile: 'archivist', bindings: { hivemem: 'default' }, emberpath_client_key: KEY });
    expect(deploy!.headers.get('x-idempotency-key')).toBeTruthy();
    expect(drawer.textContent).toContain('Creating');
    await settle(2_100);
    await settle(20);
    expect(drawer.textContent).toContain('The agent is running with the definition');
    expect(server.requests.some((request) => request.path === '/agents/operations/op-def-1')).toBe(true);
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it('shows a refused or missing key beside its field, clears it, and creates nothing', async () => {
    studioRoutes({
      checks: [{ definition: { name: 'Archivist', sha256: 'b'.repeat(64) }, omitted: [], preflight: { ok: false, problems: [
        { code: 'SECRET_UNBOUND', detail: 'emberpath_client_key: Emberpath refused the client key (403)' }, { code: 'SKILL_VERSION_UNAVAILABLE', detail: 'web-research 1.2.0 is not in the catalog' }] } }],
      deploys: [refused(422, 'EMBERPATH_KEY_FORBIDDEN'), refused(409, 'PREFLIGHT_FAILED', { problems: [{ code: 'SECRET_UNBOUND', detail: 'Emberpath key missing' }] })],
    });
    const drawer = await openDrawer();
    await type(fieldInput('Profile ID'), 'archivist');
    await type(fieldInput('Emberpath client key'), KEY);
    await submit(drawer);
    expect(alerts().some((text) => text === 'Emberpath refused this key: Emberpath refused the client key (403)')).toBe(true);
    expect(drawer.textContent).toContain('Skill unavailable: web-research 1.2.0 is not in the catalog');
    expect(fieldInput('Emberpath client key')!.value).toBe('');

    await type(fieldInput('Emberpath client key'), KEY_2);
    await submit(drawer);
    expect(alerts().some((text) => text.includes('models:read and inference:write'))).toBe(true);
    expect(fieldInput('Emberpath client key')!.value).toBe('');

    await type(fieldInput('Emberpath client key'), KEY);
    await submit(drawer);
    expect(alerts().some((text) => text.startsWith('Emberpath key missing'))).toBe(true);
    expect(posted().filter(([path]) => path !== '/definition')).toEqual([['/deploy-check', KEY], ['/deploy-check', KEY_2], ['/deploy', KEY_2], ['/deploy-check', KEY], ['/deploy', KEY]]);
    expect(drawer.textContent).not.toContain('Creating');
    expect(document.body.innerHTML).not.toMatch(/fixture-emberpath-key-002[12]/u);
  });

  it('asks for no key for a codex definition, and for the alias when the definition names none', async () => {
    studioRoutes({ definition: builtDefinition({ backend: 'codex', alias: null }) });
    const drawer = await openDrawer();
    expect(fieldInput('Emberpath client key')).toBeNull();
    await type(fieldInput('Profile ID'), 'archivist');
    await type(fieldInput('Emberpath alias'), 'general');
    await submit(drawer);
    await settle(20);
    const sent = server.mutations().filter((request) => request.path !== `${BASE}/definition`);
    expect(sent.map((request) => request.body)).toEqual([
      { node_id: 'node-1', bindings: { hivemem: 'default', model: 'general' } },
      { node_id: 'node-1', profile: 'archivist', bindings: { hivemem: 'default', model: 'general' } }]);
  });
});
