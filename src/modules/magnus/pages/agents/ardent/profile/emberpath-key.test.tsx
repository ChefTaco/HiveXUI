// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccess, configureEndpoint } from '../../../../../../lib/transport';
import { sessionStore } from '../../../../session-store';
import { button, click, mount, settle, stubApi, stubBrowser, type, type Mounted } from '../../../../test-dom';
import { MODEL_CREDENTIAL_STEPS, type AgentOperation } from '../profiles/new-agent-logic';
import ArdentProfilePage from './page';

/** Obviously fake Emberpath client keys. */
const KEY = 'fixture-emberpath-key-0003';
const KEY_2 = 'fixture-emberpath-key-0004';
const READY = { status: 'ready', agent_id: 'ardent-node-1-lead', workspace_id: 'ws-1', retrieval: 'hybrid', storage: 'sqlite', reason: null };
const installation = (patch: { backend?: string; running?: boolean } = {}) => ({
  nodeId: 'node-1', nodeName: 'alpha', hostname: 'alpha.example.com', reachable: true, error: null, installed: true, version: '3.5.1', owner: 'operator', checkedAt: '2026-11-08T00:00:00.000Z',
  capabilities: { studio: 6 }, profiles: [{ id: 'lead', name: 'lead', backend: patch.backend ?? 'llamacpp', apiPort: 9910, running: patch.running ?? true, a2aEnabled: false, channels: {}, error: null }],
});

function operation(status: AgentOperation['status'], failedStep?: AgentOperation['steps'][number]['name']): AgentOperation {
  const failedAt = failedStep ? MODEL_CREDENTIAL_STEPS.indexOf(failedStep) : -1;
  return {
    id: 'op-9', kind: 'model-credential', nodeId: 'node-1', profile: 'lead', status, error: failedStep ? `${failedStep}: Emberpath key missing` : null, createdBy: 'alice', attempts: 1,
    steps: MODEL_CREDENTIAL_STEPS.map((name, index) => ({
      name, startedAt: null, finishedAt: null, error: name === failedStep ? 'Emberpath key missing' : null,
      status: status === 'succeeded' || index < failedAt ? 'succeeded' : name === failedStep ? 'failed' : 'pending',
      receipt: name === 'config-save' && status === 'succeeded' ? { revision: 'abcdef0123456789', modelKeyConfigured: true } : null,
    })),
    request: { apiPort: null, model: { emberpath_alias: 'general' }, skills: [], hivemem: true, artifacts_max_bytes: null },
    createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z', completedAt: null,
  };
}
const sse = (data: AgentOperation) => new Response(`event: operation\ndata: ${JSON.stringify(data)}\n\nevent: done\ndata: ${JSON.stringify(data)}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const accepted = () => new Response(JSON.stringify({ success: true, data: { operationId: 'op-9' } }), { status: 202, headers: { 'content-type': 'application/json' } });
const refused = (status: number, code: string, message = code) => Response.json({ success: false, error: { code, message } }, { status });

let view: Mounted | undefined;
async function load(role: string, options: { installation?: ReturnType<typeof installation>; set?: Array<() => Response>; resume?: Array<() => Response>; streams?: Response[] } = {}) {
  const sets = [...(options.set ?? [])];
  const resumes = [...(options.resume ?? [])];
  const streams = [...(options.streams ?? [])];
  const stub = stubApi(({ method, path }) => {
    if (path === '/console/session') return { success: true, data: { userId: 'alice', role, capabilities: { hermes: false, terminal: false, agentVersion: '3.5.0', magnusVersion: '3.5.0', securityConsoleUrl: null } } };
    if (path === '/ardent/installations/node-1') return { success: true, data: options.installation ?? installation() };
    const base = '/ardent/installations/node-1/profiles/lead';
    if (path === `${base}/status`) return { success: true, data: { backend: 'llamacpp' } };
    if (path === `${base}/tasks`) return { success: true, data: { tasks: [] } };
    if (path === `${base}/memory/status`) return { success: true, data: READY };
    if (method === 'POST' && path === `${base}/model-credential`) return (sets.shift() ?? accepted)();
    if (method === 'POST' && path === '/ardent/agents/operations/op-9/resume') return (resumes.shift() ?? accepted)();
    if (path === '/ardent/agents/operations/op-9/stream') return streams.shift() ?? sse(operation('succeeded'));
    return undefined;
  });
  vi.stubGlobal('fetch', stub.request);
  await sessionStore.load();
  view = await mount(<ArdentProfilePage />, { id: 'node-1~lead' });
  await settle(10);
  return stub;
}
const drawer = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Set Emberpath key"]');
const keyInput = () => [...(drawer()?.querySelectorAll('label.field') ?? [])].find((item) => item.querySelector('.field-label')?.textContent === 'Emberpath client key')?.querySelector('input') ?? undefined;
const alerts = () => [...document.querySelectorAll('[role="alert"]')].map((item) => item.textContent).join(' ');
const keyPath = '/ardent/installations/node-1/profiles/lead/model-credential';

beforeEach(() => {
  stubBrowser();
  configureEndpoint('magnus', '/api/magnus');
  sessionStore.reset();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  clearAccess();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('Set Emberpath key on an existing agent', () => {
  it('sends the key once, follows the operation and keeps nothing on the page', async () => {
    const stub = await load('ADMIN');
    await click(button('Set Emberpath key'));
    const input = keyInput()!;
    expect(input.type).toBe('password');
    expect(input.autocomplete).toBe('off');
    expect(input.required).toBe(true);
    await click(button('Set key', drawer()!));
    expect(alerts()).toContain('Enter the Emberpath client key');
    expect(stub.mutations()).toEqual([]);
    await type(keyInput(), KEY);
    await click(button('Set key', drawer()!));
    await settle(10);
    expect(stub.mutations().map((item) => [item.path, item.body])).toEqual([[keyPath, { emberpath_client_key: KEY }]]);
    expect([...document.querySelectorAll('[data-step]')].map((row) => [row.getAttribute('data-step'), row.getAttribute('data-state')])).toEqual(MODEL_CREDENTIAL_STEPS.map((name) => [name, 'done']));
    expect(drawer()?.textContent).toContain('Deliver the Emberpath key');
    expect(drawer()?.textContent).toContain('Emberpath key delivered');
    expect(drawer()?.textContent).toContain('The agent restarted with its new Emberpath key.');
    expect(keyInput()).toBeUndefined();
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it('shows each refusal beside the key, clears the field, and lets a rotated key through', async () => {
    const stub = await load('ADMIN', { set: [() => refused(422, 'EMBERPATH_KEY_INVALID'), () => refused(409, 'MODEL_NOT_EMBERPATH'),
      () => refused(409, 'AGENT_UPGRADE_REQUIRED', 'Upgrade the Magnus agent on alpha to deliver an Emberpath client key to a new agent')] });
    await click(button('Set Emberpath key'));
    await type(keyInput(), KEY);
    await click(button('Set key', drawer()!));
    await settle(5);
    expect(alerts()).toContain('Emberpath refused this key');
    expect(keyInput()?.value).toBe('');
    await type(keyInput(), KEY_2);
    await click(button('Set key', drawer()!));
    await settle(5);
    expect(alerts()).toContain("This agent's model is not an Emberpath alias");
    await type(keyInput(), KEY);
    await click(button('Set key', drawer()!));
    await settle(5);
    expect(alerts()).toContain('Upgrade the Magnus agent on alpha first: it cannot deliver an Emberpath client key');
    expect(stub.mutations().map((item) => (item.body as { emberpath_client_key: string }).emberpath_client_key)).toEqual([KEY, KEY_2, KEY]);
    expect(document.body.innerHTML).not.toMatch(/fixture-emberpath-key-000[34]/u);
  });

  it('asks for the key again when resume answers EMBERPATH_KEY_REQUIRED', async () => {
    const stub = await load('ADMIN', { streams: [sse(operation('failed', 'config-save')), sse(operation('succeeded'))], resume: [() => refused(409, 'EMBERPATH_KEY_REQUIRED')] });
    await click(button('Set Emberpath key'));
    await type(keyInput(), KEY);
    await click(button('Set key', drawer()!));
    await settle(10);
    expect(alerts()).toContain('Stopped at "Deliver the Emberpath key".');
    expect(keyInput()).toBeUndefined();
    await click(button('Resume', drawer()!));
    await settle(5);
    expect(drawer()?.textContent).toContain('Magnus no longer holds the one you entered');
    await type(keyInput(), KEY);
    await click(button('Resume with key', drawer()!));
    await settle(10);
    expect(stub.mutations().map((item) => [item.path, item.body])).toEqual([
      [keyPath, { emberpath_client_key: KEY }], ['/ardent/agents/operations/op-9/resume', null], ['/ardent/agents/operations/op-9/resume', { emberpath_client_key: KEY }]]);
    expect(drawer()?.textContent).toContain('The agent restarted with its new Emberpath key.');
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it('waits for a running profile', async () => {
    await load('ADMIN', { installation: installation({ running: false }) });
    await click(button('Set Emberpath key'));
    expect(drawer()?.textContent).toContain('Start the profile first');
    expect(button('Set key', drawer()!)?.disabled).toBe(true);
  });

  it('is not offered for a backend that does not reach Emberpath', async () => {
    await load('ADMIN', { installation: installation({ backend: 'codex' }) });
    expect(button('Set Emberpath key')).toBeUndefined();
  });

  it('is offered only to ADMIN', async () => {
    const stub = await load('OPERATOR');
    expect(button('Set Emberpath key')).toBeUndefined();
    expect(stub.mutations()).toEqual([]);
  });
});
