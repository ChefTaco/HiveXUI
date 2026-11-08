// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccess, configureEndpoint } from '../../../../../../lib/transport';
import { sessionStore } from '../../../../session-store';
import { button, click, dialog, mount, settle, stubApi, stubBrowser, type Mounted } from '../../../../test-dom';
import { HIVEMEM_STEPS, type AgentOperation } from '../profiles/new-agent-logic';
import ArdentProfilePage from './page';

const INSTALLATION = {
  nodeId: 'node-1', nodeName: 'alpha', hostname: 'alpha.example.com', reachable: true, error: null, installed: true, version: '2.2.0', owner: 'operator', checkedAt: '2026-11-08T00:00:00.000Z',
  capabilities: { studio: 1 }, profiles: [{ id: 'lead', name: 'lead', backend: 'llamacpp', apiPort: 9910, running: true, a2aEnabled: false, channels: {}, error: null }],
};
const NO_MEMORY = { status: 'degraded', agent_id: '', workspace_id: '', retrieval: null, storage: null, reason: 'Memory provider is not configured (memory.provider: none)' };
const READY = { status: 'ready', agent_id: 'ardent-node-1-lead', workspace_id: 'ws-1', retrieval: 'hybrid', storage: 'sqlite', reason: null };

function operation(status: AgentOperation['status'], failedStep?: string): AgentOperation {
  return {
    id: 'op-7', kind: 'hivemem', nodeId: 'node-1', profile: 'lead', status, error: failedStep ? `${failedStep}: HiveMem enrollment is unavailable` : null, createdBy: 'alice', attempts: 1,
    steps: HIVEMEM_STEPS.map((name, index) => ({
      name, startedAt: null, finishedAt: null, error: name === failedStep ? 'HiveMem enrollment is unavailable' : null,
      status: status === 'succeeded' ? 'succeeded' : name === failedStep ? 'failed' : index < HIVEMEM_STEPS.indexOf(failedStep as never) ? 'succeeded' : 'pending',
      receipt: name === 'hivemem-enroll' && status === 'succeeded' ? { agentId: 'ardent-node-1-lead', workspaceId: 'ws-1' } : null,
    })),
    request: { apiPort: null, model: null, skills: [], hivemem: true, artifacts_max_bytes: null },
    createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z', completedAt: null,
  };
}
const sse = (data: AgentOperation) => new Response(`event: operation\ndata: ${JSON.stringify(data)}\n\nevent: done\ndata: ${JSON.stringify(data)}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const accepted = () => new Response(JSON.stringify({ success: true, data: { operationId: 'op-7' } }), { status: 202, headers: { 'content-type': 'application/json' } });

let view: Mounted | undefined;
async function load(role: string, memory: unknown, streams: Response[] = []) {
  const stub = stubApi(({ method, path }) => {
    if (path === '/console/session') return { success: true, data: { userId: 'alice', role, capabilities: { hermes: false, terminal: false, agentVersion: '1.2.0', magnusVersion: '1.2.0', securityConsoleUrl: null } } };
    if (path === '/ardent/installations/node-1') return { success: true, data: INSTALLATION };
    const base = '/ardent/installations/node-1/profiles/lead';
    if (path === `${base}/status`) return { success: true, data: { backend: 'llamacpp' } };
    if (path === `${base}/tasks`) return { success: true, data: { tasks: [] } };
    if (path === `${base}/memory/status`) return { success: true, data: memory };
    if (method === 'POST' && path === `${base}/hivemem`) return accepted();
    if (method === 'POST' && path === '/ardent/agents/operations/op-7/resume') return accepted();
    if (path === '/ardent/agents/operations/op-7/stream') return streams.shift() ?? sse(operation('succeeded'));
    return undefined;
  });
  vi.stubGlobal('fetch', stub.request);
  await sessionStore.load();
  view = await mount(<ArdentProfilePage />, { id: 'node-1~lead' });
  await settle(10);
  return stub;
}

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

describe('Enable HiveMem on an Ardent profile', () => {
  it('is offered for a profile without HiveMem, confirms, and reports the enrollment', async () => {
    const stub = await load('ADMIN', NO_MEMORY);
    expect(document.body.textContent).toContain('HiveMem is not enabled');
    await click(button('Enable HiveMem'));
    expect(dialog()?.textContent).toContain('restarts the profile');
    expect(stub.mutations()).toEqual([]);
    await click(button('Enable HiveMem', dialog()!));
    await settle(10);
    expect(stub.mutations().map((item) => item.path)).toEqual(['/ardent/installations/node-1/profiles/lead/hivemem']);
    expect([...document.querySelectorAll('[data-step]')].map((row) => [row.getAttribute('data-step'), row.getAttribute('data-state')])).toEqual(HIVEMEM_STEPS.map((name) => [name, 'done']));
    expect(document.body.textContent).toContain('HiveMem enabled');
    expect(document.body.textContent).toContain('Agent ardent-node-1-lead · workspace ws-1');
  });

  it('shows a failed step and resumes it', async () => {
    const stub = await load('ADMIN', NO_MEMORY, [sse(operation('failed', 'hivemem-enroll'))]);
    await click(button('Enable HiveMem'));
    await click(button('Enable HiveMem', dialog()!));
    await settle(10);
    expect(document.querySelector('[data-step="hivemem-enroll"]')?.getAttribute('data-state')).toBe('failed');
    expect(document.querySelector('[data-step="hivemem-enroll"]')?.textContent).toContain('HiveMem enrollment is unavailable');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Stopped at "Enroll the HiveMem identity".');
    await click(button('Resume'));
    await settle(10);
    expect(stub.of('/ardent/agents/operations/op-7/resume')).toHaveLength(1);
    expect(document.body.textContent).toContain('HiveMem enabled');
  });

  it('is not offered when HiveMem is configured', async () => {
    await load('ADMIN', READY);
    expect(button('Enable HiveMem')).toBeUndefined();
  });

  it('is hidden from roles that cannot change agents', async () => {
    const stub = await load('OPERATOR', NO_MEMORY);
    expect(button('Enable HiveMem')).toBeUndefined();
    expect(stub.of('/ardent/installations/node-1/profiles/lead/memory/status')).toEqual([]);
  });
});
