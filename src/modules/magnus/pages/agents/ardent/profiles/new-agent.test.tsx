// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccess, configureEndpoint } from '../../../../../../lib/transport';
import { sessionStore } from '../../../../session-store';
import { button, click, mount, settle, stubApi, stubBrowser, type, type Mounted, type RecordedRequest } from '../../../../test-dom';
import type { ArdentInstallation } from '../schemas';
import { DEPLOY_STEPS, type AgentOperation, type AgentStep } from './new-agent-logic';
import { NewAgentWizard } from './new-agent';
import ArdentProfilesPage from './page';

const INSTALLATIONS: ArdentInstallation[] = [
  { nodeId: 'node-1', nodeName: 'alpha', hostname: 'alpha.example.com', reachable: true, error: null, installed: true, version: '2.2.0', owner: 'operator', checkedAt: '2026-11-08T00:00:00.000Z',
    capabilities: { studio: 1 }, profiles: [{ id: 'lead', name: 'lead', backend: 'llamacpp', apiPort: 9910, running: true, a2aEnabled: false, channels: {}, error: null }] },
  { nodeId: 'node-2', nodeName: 'beta', hostname: 'beta.example.com', reachable: true, error: null, installed: true, version: '2.1.2', owner: 'operator', checkedAt: '2026-11-08T00:00:00.000Z', profiles: [] },
];

function operation(status: AgentOperation['status'], steps: Partial<Record<AgentStep['name'], Partial<AgentStep>>>, error: string | null = null): AgentOperation {
  return {
    id: 'op-1', kind: 'deploy', nodeId: 'node-1', profile: 'scout', status, error, createdBy: 'alice', attempts: 1,
    steps: DEPLOY_STEPS.map((name) => ({ name, status: 'pending', startedAt: null, finishedAt: null, receipt: null, error: null, ...steps[name] })),
    request: { apiPort: 9911, model: { emberpath_alias: 'general' }, skills: [], hivemem: true, artifacts_max_bytes: 67108864 },
    createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z', completedAt: null,
  };
}
const sse = (events: ReadonlyArray<[string, AgentOperation]>) =>
  new Response(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });

const FAILED = operation('failed', {
  'profile-create': { status: 'succeeded', receipt: { apiPort: 9911, version: '2.2.0' } },
  'service-start': { status: 'succeeded', receipt: { service: 'ardent-scout', running: true } },
  'identity-soul': { status: 'failed', error: 'identity-save timed out' },
}, 'identity-soul: identity-save timed out');
const SUCCEEDED = operation('succeeded', Object.fromEntries(DEPLOY_STEPS.map((name) => [name, { status: 'succeeded', receipt: name === 'ready-probe' ? { attempts: 1, memory: 'ready' } : {} }])));

interface Answers {
  deploy?: (request: RecordedRequest) => unknown;
  resume?: () => unknown;
  installation?: ArdentInstallation;
  streams?: Response[];
  profilesPage?: boolean;
}
let view: Mounted | undefined;
async function load(role: string, answers: Answers = {}) {
  const streams = [...(answers.streams ?? [])];
  let deploymentStarted = false;
  const stub = stubApi((request) => {
    const { method, path } = request;
    if (path === '/console/session') return { success: true, data: { userId: 'alice', role, capabilities: { hermes: false, terminal: false, agentVersion: '1.2.0', magnusVersion: '1.2.0', securityConsoleUrl: null } } };
    if (method === 'GET' && path === '/ardent/installations') return { success: true, data: INSTALLATIONS };
    if (method === 'GET' && path === '/ardent/profiles') return { success: true, data: deploymentStarted ? [{ ...INSTALLATIONS[0]!.profiles[0]!, id: 'scout', name: 'scout', nodeId: 'node-1', nodeName: 'alpha', hostname: 'alpha.example.com', installationVersion: '2.2.0', reachable: true }] : [] };
    if (method === 'GET' && path === '/ardent/installations/node-1/profiles/lead/skills') return { success: true, data: { skills: [{ name: 'research', description: 'Finds sources', hash: 'h', enabled: true }] } };
    if (method === 'POST' && path === '/ardent/agents') return answers.deploy?.(request) ?? new Response(JSON.stringify({ success: true, data: { operationId: 'op-1' } }), { status: 202, headers: { 'content-type': 'application/json' } });
    if (method === 'GET' && path === '/ardent/installations/node-1' && answers.installation) return { success: true, data: answers.installation };
    if (method === 'POST' && path === '/ardent/agents/operations/op-1/resume' && answers.resume) return answers.resume();
    if (method === 'POST' && path === '/ardent/agents/operations/op-1/resume') return new Response(JSON.stringify({ success: true, data: { operationId: 'op-1' } }), { status: 202, headers: { 'content-type': 'application/json' } });
    if (method === 'GET' && path === '/ardent/agents/operations/op-1/stream') { deploymentStarted = true; return streams.shift() ?? sse([['done', SUCCEEDED]]); }
    return undefined;
  });
  vi.stubGlobal('fetch', stub.request);
  await sessionStore.load();
  const onDone = vi.fn();
  const onDeployed = vi.fn();
  view = await mount(answers.profilesPage ? <ArdentProfilesPage /> : <NewAgentWizard installations={INSTALLATIONS} onDone={onDone} onDeployed={onDeployed} />);
  await settle(5);
  return { stub, onDone, onDeployed };
}
const input = (label: string) => [...document.querySelectorAll('label.field')].find((item) => item.querySelector('.field-label')?.textContent === label)?.querySelector('input, textarea');

/** An obviously fake Emberpath client key. */
const KEY = 'fixture-emberpath-key-0001';
const KEY_2 = 'fixture-emberpath-key-0002';

/** Fill the steps with valid values and stop on Review. */
async function walkToReview(key = KEY) {
  await type(input('Profile ID'), 'scout');
  await click(button('Next'));
  await click(button('Next'));
  await type(input('Emberpath alias'), 'general');
  await type(input('Emberpath client key'), key);
  await click(button('Next'));
  await settle(5);
}
const refused = (status: number, code: string, message = code) => Response.json({ success: false, error: { code, message } }, { status });
const alerts = () => [...document.querySelectorAll('[role="alert"]')].map((item) => item.textContent).join(' ');

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

describe('the New Agent wizard', () => {
  it('refreshes the fleet collection after success while keeping the completed wizard open', async () => {
    const { stub } = await load('ADMIN', { profilesPage: true });
    expect(document.body.textContent).toContain('No Ardent profiles reported');
    await walkToReview();
    await click(button('Deploy'));
    await settle(20);
    expect(stub.of('/ardent/profiles')).toHaveLength(2);
    expect(stub.of('/ardent/installations')).toHaveLength(2);
    expect(document.body.textContent).toContain('1 profiles reported by managed nodes');
    expect(document.body.textContent).not.toContain('No Ardent profiles reported');
    expect(button('Open profile')).toBeDefined();
    expect(document.querySelector('a[href="/fleet/ardent/profiles/node-1~scout"]')).not.toBeNull();
  });

  it('offers only bridge-capable nodes, suggests the next free port and validates before moving on', async () => {
    await load('ADMIN');
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="new-agent-node"]')];
    expect(radios.map((radio) => [radio.value, radio.checked, radio.disabled])).toEqual([['node-1', true, false], ['node-2', false, true]]);
    expect(document.body.textContent).toContain('Upgrade the Magnus agent on beta');
    expect((input('API port') as HTMLInputElement).value).toBe('9911');
    await type(input('Profile ID'), 'lead');
    await click(button('Next'));
    expect(document.body.textContent).toContain('A profile with this ID already exists on the node');
    expect(document.querySelector('[aria-current="step"]')?.textContent).toContain('Node');
    await type(input('Profile ID'), 'scout');
    await click(button('Next'));
    expect(document.querySelector('[aria-current="step"]')?.textContent).toContain('Identity');
    expect((input('IDENTITY.md') as HTMLTextAreaElement).value).toContain('You are scout,');
  });

  it('lists the skills the node reports, keeps HiveMem on, and sends the reviewed request', async () => {
    const { stub } = await load('ADMIN', { streams: [sse([['done', SUCCEEDED]])] });
    await type(input('Profile ID'), 'scout');
    await click(button('Next'));
    await click(button('Next'));
    await settle(5);
    const hivemem = [...document.querySelectorAll<HTMLInputElement>('.toggle input')].find((item) => item.closest('label')?.textContent?.includes('HiveMem'));
    expect(hivemem?.checked && hivemem.disabled).toBe(true);
    await click(document.querySelector<HTMLInputElement>('.check-field input'));
    await type(input('Emberpath alias'), 'general');
    await type(input('Emberpath client key'), KEY);
    await click(button('Next'));
    expect(document.body.textContent).toContain('Emberpath alias general');
    expect(document.body.textContent).toContain('research');
    await click(button('Deploy'));
    await settle(10);
    expect(stub.of('/ardent/agents')[0]?.body).toMatchObject({ nodeId: 'node-1', profile: 'scout', apiPort: 9911, model: { emberpath_alias: 'general' }, skills: ['research'], hivemem: true, artifacts_max_bytes: 67108864,
      emberpath_client_key: KEY });
    // The key went out once and is not kept on the page.
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it('asks for the Emberpath client key only for an alias, as a required password field the browser does not fill', async () => {
    const { stub } = await load('ADMIN', { streams: [sse([['done', SUCCEEDED]])] });
    await type(input('Profile ID'), 'scout');
    await click(button('Next'));
    await click(button('Next'));
    const key = input('Emberpath client key') as HTMLInputElement;
    expect(key.type).toBe('password');
    expect(key.autocomplete).toBe('off');
    expect(key.required).toBe(true);
    expect(document.body.textContent).toContain('Emberpath → API Keys');
    await click(document.querySelector<HTMLInputElement>('input[name="new-agent-model"][value="llamacpp"]'));
    expect(input('Emberpath client key')).toBeUndefined();
    await click(document.querySelector<HTMLInputElement>('input[name="new-agent-model"][value="emberpath"]'));
    await type(input('Emberpath alias'), 'general');
    await click(button('Next'));
    expect(alerts()).toContain('Enter the Emberpath client key for this agent');
    expect(document.querySelector('[aria-current="step"]')?.textContent).toContain('Model');
    await type(input('Emberpath client key'), 'has spaces in it, not a key');
    await click(button('Next'));
    expect(alerts()).toContain('16 to 512 characters');
    await type(input('Emberpath client key'), KEY);
    await click(button('Next'));
    expect(document.querySelector('[aria-current="step"]')?.textContent).toContain('Review');
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(stub.of('/ardent/agents')).toEqual([]);
  });

  it('shows each Emberpath refusal beside the field it is about, and needs the key again after a refused deploy', async () => {
    const answers = [refused(422, 'EMBERPATH_KEY_INVALID'), refused(422, 'EMBERPATH_ALIAS_UNAVAILABLE'), refused(409, 'EMBERPATH_NOT_EXPLICIT')];
    const { stub } = await load('ADMIN', { deploy: () => answers.shift() });
    await walkToReview();
    await click(button('Deploy'));
    await settle(5);
    // Back on Model, the key field says why and is empty again.
    expect(document.querySelector('[aria-current="step"]')?.textContent).toContain('Model');
    expect(alerts()).toContain('Emberpath refused this key: it is unknown, disabled or expired');
    expect((input('Emberpath client key') as HTMLInputElement).value).toBe('');
    await type(input('Emberpath client key'), KEY_2);
    await click(button('Next'));
    await click(button('Deploy'));
    await settle(5);
    expect(alerts()).toContain("This key may not use the alias");
    expect(input('Emberpath alias')?.getAttribute('aria-invalid')).toBe('true');
    await type(input('Emberpath client key'), KEY);
    await click(button('Next'));
    await click(button('Deploy'));
    await settle(5);
    // A server setting the operator cannot fix here stays on Review.
    expect(document.querySelector('[aria-current="step"]')?.textContent).toContain('Review');
    expect(alerts()).toContain('MAGNUS_ARDENT_EMBERPATH_URL');
    // Deploying again without the dropped key goes back to ask for it, sending nothing.
    await click(button('Deploy'));
    await settle(5);
    expect(document.querySelector('[aria-current="step"]')?.textContent).toContain('Model');
    expect(stub.of('/ardent/agents').map((request) => (request.body as { emberpath_client_key: string }).emberpath_client_key)).toEqual([KEY, KEY_2, KEY]);
    expect(document.body.innerHTML).not.toMatch(/fixture-emberpath-key-000[12]/u);
  });

  it('asks for the key again when resume answers EMBERPATH_KEY_REQUIRED, and resumes with it', async () => {
    const resumes = [refused(409, 'EMBERPATH_KEY_REQUIRED'), new Response(JSON.stringify({ success: true, data: { operationId: 'op-1' } }), { status: 202, headers: { 'content-type': 'application/json' } })];
    const { stub } = await load('ADMIN', { streams: [sse([['done', FAILED]]), sse([['done', SUCCEEDED]])], resume: () => resumes.shift() });
    await walkToReview();
    await click(button('Deploy'));
    await settle(10);
    await click(button('Resume'));
    await settle(5);
    expect(document.body.textContent).toContain('Magnus no longer holds the one you entered');
    const key = input('Emberpath client key') as HTMLInputElement;
    expect(key.type).toBe('password');
    await click(button('Resume with key'));
    expect(alerts()).toContain('Enter the Emberpath client key');
    await type(input('Emberpath client key'), KEY);
    await click(button('Resume with key'));
    await settle(10);
    expect(stub.of('/ardent/agents/operations/op-1/resume').map((request) => request.body)).toEqual([null, { emberpath_client_key: KEY }]);
    expect(input('Emberpath client key')).toBeUndefined();
    expect(button('Open profile')).toBeDefined();
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it('renders each step from the operation stream, then resumes a failed deploy and opens the profile', async () => {
    const running = operation('running', { 'profile-create': { status: 'succeeded', receipt: { apiPort: 9911, version: '2.2.0' } }, 'service-start': { status: 'running' } });
    const { stub, onDone, onDeployed } = await load('ADMIN', { streams: [sse([['operation', running], ['operation', FAILED], ['done', FAILED]]), sse([['operation', SUCCEEDED], ['done', SUCCEEDED]])] });
    await walkToReview();
    await click(button('Deploy'));
    await settle(10);
    const state = (name: string) => document.querySelector(`[data-step="${name}"]`)?.getAttribute('data-state');
    expect(state('profile-create')).toBe('done');
    expect(state('service-start')).toBe('done');
    expect(state('identity-soul')).toBe('failed');
    expect(state('ready-probe')).toBe('pending');
    expect(document.querySelector('[data-step="profile-create"]')?.textContent).toContain('API port 9911 · Ardent 2.2.0');
    expect(document.querySelector('[data-step="identity-soul"]')?.textContent).toContain('identity-save timed out');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Stopped at "Write SOUL.md".');
    expect(button('Open profile')).toBeUndefined();
    expect(button('Back')).toBeUndefined();
    expect(onDeployed).not.toHaveBeenCalled();

    await click(button('Resume'));
    await settle(10);
    expect(stub.of('/ardent/agents/operations/op-1/resume')).toHaveLength(1);
    expect(stub.of('/ardent/agents/operations/op-1/stream')).toHaveLength(2);
    expect(DEPLOY_STEPS.map(state)).toEqual(DEPLOY_STEPS.map(() => 'done'));
    expect(document.body.textContent).toContain('HiveMem ready');
    expect(onDeployed).toHaveBeenCalledExactlyOnceWith('node-1~scout');
    await click(button('Open profile'));
    expect(onDone).toHaveBeenCalledWith('node-1~scout');
  });

  it('explains a resume refused for an unsettled command and lists that command with its Reconcile action', async () => {
    const owner = { commandId: 'native-7', state: 'unknown' as const, label: 'ardent:scout:service-start', profile: 'scout', action: 'service-start', ardent: true,
      acquiredAt: '2026-11-08T00:00:00.000Z', dispatchedAt: '2026-11-08T00:00:01.000Z', deadline: '2026-11-08T00:02:05.000Z', reconcilableAfter: '2026-11-08T00:03:05.000Z' };
    await load('ADMIN', {
      streams: [sse([['done', FAILED]])],
      installation: { ...INSTALLATIONS[0]!, commandOwners: [owner], commandReconciliation: { configured: true } },
      resume: () => Response.json({ success: false, error: { code: 'COMMAND_OWNER_UNSETTLED',
        message: 'The node could not confirm the outcome of service-start on scout (command native-7), so no Ardent action can run there.' } }, { status: 409 }),
    });
    await walkToReview();
    await click(button('Deploy'));
    await settle(10);
    const owners = document.querySelector('section[aria-label="Unsettled commands on alpha"]');
    expect(owners?.textContent).toContain('service-start on scout');
    expect(owners?.textContent).toContain('Outcome unknown');
    expect(button('Reconcile', owners!)).toBeDefined();
    await click(button('Resume'));
    await settle(5);
    expect([...document.querySelectorAll('[role="alert"]')].map((item) => item.textContent).join(' ')).toContain(
      'The node could not confirm the outcome of service-start on scout (command native-7), so no Ardent action can run there. The command is listed below.');
  });

  it('shows a running step as it streams, before the operation ends', async () => {
    const encoder = new TextEncoder();
    let push: ((event: string, data: AgentOperation) => void) | undefined;
    const body = new ReadableStream<Uint8Array>({ start(controller) { push = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } });
    await load('ADMIN', { streams: [new Response(body, { headers: { 'content-type': 'text/event-stream' } })] });
    await walkToReview();
    await click(button('Deploy'));
    await settle(10);
    expect(document.querySelectorAll('[data-state="pending"]')).toHaveLength(DEPLOY_STEPS.length);
    push!('operation', operation('running', { 'profile-create': { status: 'succeeded', receipt: { apiPort: 9911 } }, 'service-start': { status: 'running' } }));
    await settle(10);
    const row = document.querySelector('[data-step="service-start"]');
    expect(row?.getAttribute('data-state')).toBe('running');
    expect(row?.textContent).toContain('Running');
    expect(row?.textContent).toContain('Working…');
    expect(document.body.textContent).toContain('Deploying');
    push!('done', SUCCEEDED);
    await settle(10);
    expect(button('Open profile')).toBeDefined();
  });

  it('explains an agent that predates the bridge', async () => {
    await load('ADMIN', {
      deploy: () => Response.json({ success: false, error: { code: 'AGENT_UPGRADE_REQUIRED', message: 'Upgrade the Magnus agent on alpha to use Ardent sessions and streams' } }, { status: 409 }),
    });
    await walkToReview();
    await click(button('Deploy'));
    await settle(5);
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/^Upgrade the Magnus agent on alpha first: it predates the Ardent bridge/);
    expect(document.querySelector('[aria-current="step"]')?.textContent).toContain('Review');
    expect(button('Deploy')).toBeDefined();
  });

  it('is hidden from roles that cannot create agents', async () => {
    const { stub } = await load('OPERATOR');
    expect(document.body.textContent).toContain('Creating Ardent agents needs the Magnus ADMIN role.');
    expect(button('Next')).toBeUndefined();
    expect(stub.requests.filter((request) => request.path.startsWith('/ardent/'))).toEqual([]);
  });
});
