// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, dialog, mount, settle, stubBrowser, type, type Mounted } from '../../magnus/test-dom';
import StudioModule from '../index';
import { resetProjectStores } from '../state/project-store';
import { agent, PROJECT_ID, serveStudio, snapshot, type StudioRequest } from '../test-fixtures';

vi.mock('../../../lib/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/runtime')>()),
  productInstalled: (product: string) => product !== 'emberpath' && product !== 'hiveskills',
}));

const REF = 'node-1~lead';
const SHA = (char: string) => char.repeat(64);
const AT = '2026-11-08T10:00:00.000Z';
const NODE = '/ardent/installations/node-1/profiles/lead';

interface MagnusRequest {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}
let studioRoute: (request: StudioRequest) => unknown;
let magnusRoute: (request: MagnusRequest) => unknown;
let server: ReturnType<typeof serveStudio>;
let magnusRequests: MagnusRequest[];
/** The agent's profile as Magnus's node inventory reports it. Without hivemem: a Magnus without credential renewal. */
let inventoryProfile: Record<string, unknown>;
const PROFILE = { id: 'lead', name: 'lead', backend: 'llamacpp', apiPort: 9910, running: true, a2aEnabled: false, channels: {}, error: null };
const installation = () => ({
  nodeId: 'node-1', nodeName: 'node one', hostname: 'node-1.example.com', reachable: true, error: null, installed: true, version: '2.2.0', owner: 'operator',
  checkedAt: AT, profiles: [inventoryProfile],
});
let view: Mounted | undefined;

/** The agent's node, as Magnus relays it. */
const node: Record<string, unknown> = {
  'identity/soul': { text: 'Calm and exact.', revision: SHA('a') },
  'identity/identity': { text: 'Story lead.', revision: SHA('b') },
  'identity/soul/history': { history: [{ name: 'SOUL.md.2026-11-01', revision: SHA('9') }] },
  'identity/identity/history': { history: [] },
  skills: { skills: [{ name: 'outline', description: 'Outlines', hash: 'h1', enabled: true }, { name: 'research', description: 'Research', hash: 'h2', enabled: false }] },
  config: { text: 'execution:\n  backend: llamacpp\nskills:\n  enabled: [outline]\n', revision: SHA('c') },
  'memory/status': { status: 'ready', agent_id: 'lead', workspace_id: 'ws-1', retrieval: 'hybrid', storage: 'ok', reason: null },
  tasks: { tasks: [{ id: 't-1', state: 'running', prompt: 'Draft chapter one', created_ms: Date.parse(AT) }, { id: 't-2', state: 'running', prompt: 'Map', created_ms: Date.parse(AT) }] },
  channels: {},
  peers: { peers: [] },
};
const agents = () => ({ agents: [agent({ display_name: 'Story Lead', roles: [{ project_id: PROJECT_ID, project_name: 'Sunken Archive', role_key: 'lead', role_name: 'Story Lead' }] })], available_count: 1, magnus: { state: 'ok', error: null } });
const presentation = { agent_ref: REF, display_name: 'Story Lead', portrait: { preset: 'hood', accent: 'persona-2', emblem: 'quill' }, avatar_file_id: null, updated_by: 'operator', updated_at: AT };
const draftRecord = (draft: Record<string, unknown>) => ({ agent_ref: REF, user_id: 'operator', base: { soul_revision: SHA('a') }, draft, created_at: AT, updated_at: AT });

function baseStudio(request: StudioRequest): unknown {
  if (request.path === `/projects/${PROJECT_ID}/snapshot`) return snapshot();
  if (request.path === '/agents') return agents();
  if (request.path === `/agents/${REF}/presentation`) return presentation;
  if (request.path === `/agents/${REF}/draft` && request.method === 'GET') return { draft: null };
  return undefined;
}

beforeEach(() => {
  stubBrowser();
  studioRoute = baseStudio;
  magnusRoute = (request) => (request.method === 'GET' ? node[request.path.slice(NODE.length + 1)] : undefined);
  magnusRequests = [];
  inventoryProfile = PROFILE;
  server = serveStudio((request) => studioRoute(request));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'https://console.example.com');
    if (url.pathname === '/api/magnus/ardent/installations/node-1') return Response.json({ success: true, data: installation() });
    if (url.pathname.startsWith('/api/magnus' + NODE)) {
      const request = { method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname.slice('/api/magnus'.length), body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null };
      magnusRequests.push(request);
      const answer = magnusRoute(request);
      if (answer instanceof Response) return answer;
      return answer === undefined ? Response.json({ error: { message: 'Not found' } }, { status: 404 }) : Response.json({ success: true, data: answer });
    }
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

async function open(path: string) {
  history.replaceState({ studioOrigin: '/' }, '', path);
  view = await mount(<StudioModule />);
  for (let index = 0; index < 4; index += 1) await settle();
  return view.container;
}
const text = (root: ParentNode = document.body) => root.textContent ?? '';
const field = (label: string, root: ParentNode = document) =>
  [...root.querySelectorAll('label.field')].find((item) => item.querySelector('.field-label')?.textContent === label)?.querySelector('input, textarea, select') as HTMLInputElement | HTMLTextAreaElement | null;
const sent = (method: string, path: string) => server.requests.filter((request) => request.method === method && request.path === path);

describe('the Agent Studio header', () => {
  it('shows identity, runtime, HiveMem, the projects using the agent and the way back', async () => {
    const root = await open(`/studio/p/${PROJECT_ID}/agents/${REF}?from=room&c=cnv_1&m=msg_2`);
    const head = root.querySelector('.agent-head')!;
    expect(head.querySelector('h2')?.textContent).toBe('Story Lead');
    expect(text(head)).toContain('Running');
    expect(text(head)).toContain('HiveMem ready');
    // A Magnus without credential renewal reports no credential, so the header shows none.
    expect(text(head)).not.toContain('HiveMem credential');
    expect(text(head)).toContain('Sunken Archive · Story Lead');
    expect(head.querySelector('a[href^="/fleet/"]')?.getAttribute('href')).toBe(`/fleet/ardent/profiles/${REF}`);
    expect([...head.querySelectorAll('a')].find((link) => link.textContent?.includes('Back to the room'))?.getAttribute('href')).toBe(`/studio/p/${PROJECT_ID}/room?c=cnv_1&m=msg_2`);
  });

  it('shows the HiveMem credential Magnus renews, in words', async () => {
    const DAY = 86_400_000;
    const expiresAt = new Date(Date.now() + 12 * DAY + 3_600_000).toISOString();
    const credential = { agentId: 'lead', workspaceId: 'ws-1', expiresAt, lastRenewedAt: AT, lastAttemptAt: AT, nextRenewalAt: null, failures: 0, lastError: null, state: 'ok' };
    const badge = (root: ParentNode) => [...root.querySelectorAll('.agent-head .badge')].find((item) => item.textContent?.startsWith('HiveMem credential'));
    inventoryProfile = { ...PROFILE, hivemem: credential };
    let root = await open(`/studio/agents/${REF}`);
    expect(badge(root)?.textContent).toBe('HiveMem credential: 12 days');
    expect(badge(root)?.querySelector('[title]')?.getAttribute('title')).toBe(`Credential expires in 12 days · expires ${new Date(expiresAt).toLocaleString()}`);
    expect(badge(root)?.className).toContain('badge--success');
    await view?.unmount();

    inventoryProfile = { ...PROFILE, hivemem: { ...credential, state: 'renewal-failing', failures: 2, lastError: 'HiveMem answered 503' } };
    root = await open(`/studio/agents/${REF}`);
    expect(badge(root)?.textContent).toBe('HiveMem credential: renewal failing');
    expect(badge(root)?.className).toContain('badge--warning');
    await view?.unmount();

    inventoryProfile = { ...PROFILE, hivemem: { ...credential, state: 'expired', expiresAt: AT } };
    root = await open(`/studio/agents/${REF}`);
    expect(badge(root)?.textContent).toBe('HiveMem credential: expired');
    expect(badge(root)?.className).toContain('badge--danger');
    await view?.unmount();

    inventoryProfile = { ...PROFILE, hivemem: { state: 'ok' } };
    root = await open(`/studio/agents/${REF}`);
    expect(badge(root)?.textContent).toBe('HiveMem credential: unknown');
    await view?.unmount();

    inventoryProfile = { ...PROFILE, hivemem: null };
    root = await open(`/studio/agents/${REF}`);
    expect(badge(root)).toBeUndefined();
    expect(text(root.querySelector('.agent-head')!)).toContain('HiveMem ready');
  });

  it('opens on Identity with the project role marked as this project only', async () => {
    const root = await open(`/studio/p/${PROJECT_ID}/agents/${REF}`);
    expect(root.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Identity');
    expect(text(root)).toContain('Project role');
    expect(text(root)).toContain('This project only');
    expect(text(root)).toContain('Story Lead responsibilities');
    expect(root.querySelector(`a[href="/studio/p/${PROJECT_ID}/team?role=lead"]`)).not.toBeNull();
    expect(root.querySelector('textarea[aria-label="SOUL.md"]')).not.toBeNull();
    // Opened without from=room, there is no way back to the room to offer.
    expect(text(root)).not.toContain('Back to the room');
  });

  it('saves the Studio name and portrait without touching the agent', async () => {
    studioRoute = (request) => (request.method === 'PUT' && request.path === `/agents/${REF}/presentation` ? { ...presentation, ...(request.body as object), updated_at: '2026-11-08T11:00:00.000Z' } : baseStudio(request));
    const root = await open(`/studio/agents/${REF}`);
    await type(field('Display name', root), 'Archivist');
    await click(button('Save name and portrait', root));
    await settle();
    expect(sent('PUT', `/agents/${REF}/presentation`)[0]!.body).toEqual({ display_name: 'Archivist', portrait: presentation.portrait, avatar_file_id: null });
    expect(magnusRequests.filter((request) => request.method !== 'GET')).toEqual([]);
  });
});

describe('Preview', () => {
  it('saves a draft that changes nothing on the agent, then shows each Apply part honestly', async () => {
    const saved = draftRecord({ soul: 'Warmer and brief.' });
    studioRoute = (request) => {
      if (request.method === 'PUT' && request.path === `/agents/${REF}/draft`) return { draft: saved };
      if (request.method === 'POST' && request.path === `/agents/${REF}/apply`)
        return { results: [{ part: 'soul', status: 'failed', error: 'Magnus refused: the acting person is not a Magnus ADMIN', code: 'ACTING_ADMIN_REQUIRED', revision: null, activation_required: false }], activation_required: false, restart: { available: false, reason: null }, active_tasks: 2, note: null, draft: saved };
      return baseStudio(request);
    };
    const root = await open(`/studio/p/${PROJECT_ID}/agents/${REF}?tab=preview`);
    expect(text(root)).toContain("Applies from the agent's next turn; 2 running tasks keep current instructions.");
    await type(field('SOUL.md', root), 'Warmer and brief.');
    await click(button('Save draft', root));
    await settle();
    expect(sent('PUT', `/agents/${REF}/draft`)[0]!.body).toEqual({ base: { soul_revision: SHA('a') }, draft: { soul: 'Warmer and brief.' } });
    expect(text(root)).toContain('Draft saved. Nothing on the agent has changed.');
    expect(magnusRequests.filter((request) => request.method !== 'GET')).toEqual([]);

    await click(button('Apply', root));
    expect(dialog()?.textContent).toContain('Apply SOUL.md?');
    await click(button('Apply', dialog()!));
    await settle();
    expect(sent('POST', `/agents/${REF}/apply`)[0]!.body).toEqual({ parts: ['soul'] });
    const results = root.querySelector('[aria-label="Apply results"]')!;
    expect(text(results)).toContain('Nothing was applied.');
    expect(text(results)).toContain('Failed');
    expect(text(results)).toContain('Only a Magnus administrator can change an agent.');
    expect(text(results)).toContain('Magnus refused: the acting person is not a Magnus ADMIN (ACTING_ADMIN_REQUIRED)');
    expect(text(results)).toContain('2 running tasks keep current instructions');
    // Studio applies through Magnus itself; the console sends nothing to the node.
    expect(magnusRequests.filter((request) => request.method !== 'GET')).toEqual([]);
  });

  it('builds the skills draft on the saved configuration, saying which skills wait for a restart', async () => {
    studioRoute = (request) => (request.method === 'PUT' && request.path === `/agents/${REF}/draft` ? { draft: draftRecord(request.body as Record<string, unknown>) } : baseStudio(request));
    // research was installed and enabled after the profile started: Ardent still lists it off.
    magnusRoute = (request) => (request.method === 'GET' && request.path === `${NODE}/config`
      ? { text: 'execution:\n  backend: llamacpp\nskills:\n  enabled:\n    - outline\n    - research\n', revision: SHA('c') }
      : request.method === 'GET' ? node[request.path.slice(NODE.length + 1)] : undefined);
    const root = await open(`/studio/p/${PROJECT_ID}/agents/${REF}?tab=preview`);
    const toggle = (name: string) => [...root.querySelectorAll('.agent-skills label.toggle')].find((label) => label.textContent === name)!.querySelector('input')!;
    expect(toggle('research').checked).toBe(true);
    expect(toggle('outline').checked).toBe(true);
    expect(text(root.querySelector('.agent-skills')!)).toContain('Agent: Enabled — applies after restart');
    // Unchanged skills make no draft; turning outline off keeps research on.
    await click(toggle('outline'));
    await click(button('Save draft', root));
    await settle();
    expect(sent('PUT', `/agents/${REF}/draft`)[0]!.body).toEqual({ base: { config_revision: SHA('c') }, draft: { skills_enabled: ['research'] } });
  });

  it('shows the configured skill state on Capabilities, and switches from it', async () => {
    magnusRoute = (request) => {
      if (request.method === 'POST') return { revision: SHA('d'), activation_required: true };
      if (request.path === `${NODE}/config`) return { text: 'skills:\n  enabled: [research]\n', revision: SHA('c') };
      return node[request.path.slice(NODE.length + 1)];
    };
    const root = await open(`/studio/p/${PROJECT_ID}/agents/${REF}?tab=capabilities`);
    expect(text(root)).toContain('Disabled — applies after restart');
    expect(text(root)).toContain('Enabled — applies after restart');
    // research is enabled in the configuration, so its switch turns it off.
    const card = [...root.querySelectorAll('.grid > *')].find((item) => item.querySelector('p')?.textContent === 'research')!;
    await click(button('Disable', card as HTMLElement));
    await settle();
    expect(magnusRequests.filter((request) => request.method === 'POST').map((request) => request.body)).toEqual([{ action: 'skill-set', target: 'research', body: { enabled: false, revision: SHA('c') } }]);
  });

  it('asks for a restart after skills and the model apply, and rebases a draft after a conflict', async () => {
    const saved = { agent_ref: REF, user_id: 'operator', base: { soul_revision: SHA('0'), config_revision: SHA('c') }, draft: { soul: 'Newer soul.', model: 'general' }, created_at: AT, updated_at: AT };
    studioRoute = (request) => {
      if (request.method === 'GET' && request.path === `/agents/${REF}/draft`) return { draft: saved };
      if (request.method === 'PUT' && request.path === `/agents/${REF}/draft`) return { draft: { ...saved, ...(request.body as object) } };
      if (request.method === 'POST' && request.path === `/agents/${REF}/apply`)
        return {
          results: [
            { part: 'soul', status: 'failed', error: 'Revision mismatch', code: 'CONFLICT', revision: null, activation_required: false },
            { part: 'model', status: 'applied', error: null, code: null, revision: SHA('d'), activation_required: true },
          ],
          activation_required: true,
          restart: { available: false, reason: 'Magnus does not let Studio restart profiles.' },
          active_tasks: 0,
          note: null,
          draft: { ...saved, draft: { soul: 'Newer soul.' }, base: { soul_revision: SHA('0') } },
        };
      return baseStudio(request);
    };
    const root = await open(`/studio/agents/${REF}?tab=preview`);
    await click(button('Apply', root));
    await click(button('Apply', dialog()!));
    await settle();
    expect(sent('POST', `/agents/${REF}/apply`)[0]!.body).toEqual({ parts: ['soul', 'model'] });
    const results = root.querySelector('[aria-label="Apply results"]')!;
    expect(text(results)).toContain('1 of 2 parts applied; 1 failed.');
    expect(text(results)).toContain('Needs a restart');
    expect(text(results)).toContain('Restart the profile from the Magnus console to activate');
    expect(text(results)).toContain('Magnus does not let Studio restart profiles.');
    expect(results.querySelector('a[href^="/fleet/"]')?.getAttribute('href')).toBe(`/fleet/ardent/profiles/${REF}`);
    expect(text(results)).toContain('The agent changed since this draft was made.');
    await click(button("Reload the agent as the draft's base", results));
    await settle();
    // The same draft, now based on the agent's current SOUL.md revision.
    expect(sent('PUT', `/agents/${REF}/draft`).at(-1)!.body).toEqual({ base: { soul_revision: SHA('a') }, draft: { soul: 'Newer soul.' } });
    expect(text(root)).toContain('The draft now builds on the agent as it is.');
  });

  it('streams the reply as the agent writes it', async () => {
    const frames = [
      ['preview.accepted', { task_id: 't-9', session_id: 's-1' }],
      ['preview.delta', { step: 1, text: 'The archive ' }],
      ['preview.delta', { step: 1, text: 'is flooded.' }],
      ['preview.done', { task_id: 't-9', state: 'completed', result: 'The archive is flooded.', error: null }],
    ] as const;
    studioRoute = (request) =>
      request.method === 'POST' && request.path === `/agents/${REF}/preview`
        ? new Response(frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
        : baseStudio(request);
    const root = await open(`/studio/agents/${REF}?tab=preview`);
    await type(root.querySelector('textarea[aria-label="Message to preview"]'), 'What is the archive like?');
    await click(button('Send', root));
    await settle();
    await settle();
    const log = root.querySelector('[aria-label="Preview conversation"]')!;
    expect(text(log)).toContain('What is the archive like?');
    expect(text(log)).toContain('The archive is flooded.');
    expect(text(log)).toContain('Finished');
    expect(sent('POST', `/agents/${REF}/preview`)[0]!.body).toEqual({ prompt: 'What is the archive like?', use_draft: false, new_session: true });
  });

  it('explains when the agent cannot run previews yet', async () => {
    studioRoute = (request) =>
      request.method === 'POST' && request.path === `/agents/${REF}/preview`
        ? Response.json({ error: { code: 'PREVIEW_UNAVAILABLE', message: 'Previews need the Magnus agent on node node-1 at Studio level 2 with Ardent 2.2.0' } }, { status: 409 })
        : baseStudio(request);
    const root = await open(`/studio/agents/${REF}?tab=preview`);
    await type(root.querySelector('textarea[aria-label="Message to preview"]'), 'Hello');
    await click(button('Send', root));
    await settle();
    expect(text(root)).toContain("Preview isn't available for this agent yet");
    expect(text(root)).toContain('Studio level 2 with Ardent 2.2.0');
  });
});

describe('Development', () => {
  const record = { id: 'dev_1', agent_ref: REF, kind: 'reflection', title: 'Shorter scenes read better', body: 'Players lost track in long scenes.', author: 'agent', epistemic: 'agent_reported', before_sha256: null, after_sha256: null, sources: [{ kind: 'task', ref: 'ardent-task-1' }], created_at: AT, comments: [] };

  it('shows agent-reported records with sources, and relays a discussion to the agent', async () => {
    studioRoute = (request) => {
      if (request.path.startsWith(`/agents/${REF}/development?`)) return { supported: true, reason: null, records: [record], next: null };
      if (request.method === 'POST' && request.path === `/agents/${REF}/development/dev_1/comments`)
        return { comment: { id: 'dcm_1', agent_ref: REF, record_ref: 'dev_1', body_md: (request.body as { body_md: string }).body_md, author: 'operator', created_at: AT }, relayed: true, relay_error: null };
      return baseStudio(request);
    };
    const root = await open(`/studio/agents/${REF}?tab=development`);
    const card = root.querySelector('.agent-record')!;
    expect(text(card)).toContain('Agent-reported');
    expect(text(card)).toContain('Shorter scenes read better');
    expect(text(card)).toContain('task: ardent-task-1');
    await click(button('Discuss with agent', card));
    await type(field('Message to the agent', card), 'Keep scenes under a page.');
    await click(button('Send to agent', card));
    await settle();
    expect(sent('POST', `/agents/${REF}/development/dev_1/comments`)[0]!.body).toEqual({ body_md: 'Keep scenes under a page.', relay_to_agent: true });
    expect(text(card)).toContain('Keep scenes under a page.');
    expect(text(card)).toContain('recorded in the agent’s development history');
  });

  it("says when the runtime publishes no records, and still shows identity history", async () => {
    studioRoute = (request) => (request.path.startsWith(`/agents/${REF}/development?`) ? { supported: false, reason: 'Ardent 2.1 does not publish development records.', records: [], next: null } : baseStudio(request));
    const root = await open(`/studio/agents/${REF}?tab=development`);
    expect(text(root)).toContain("This runtime doesn't publish development records");
    expect(text(root)).toContain('Ardent 2.1 does not publish development records.');
    expect(text(root)).toContain('Identity history');
    expect(text(root)).toContain('SOUL.md.2026-11-01');
  });
});
