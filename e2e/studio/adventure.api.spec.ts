// The adventure acceptance scenario through the Studio API, against the real stack: every
// step is a separate test so a run reports which part of the chain broke.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { ProjectStream, StudioApi, eventually, signIn, stack, stackAvailable } from './support/stack';

test.describe.configure({ mode: 'serial' });
test.skip(!stackAvailable(), 'The Studio end-to-end stack is not running (Docker unavailable or not started)');

type Ctx = { api: StudioApi; token: string; stream: ProjectStream; project: any; conversation: any; agents: string[]; mapper: string; deliverables: Record<string, any> };
const ctx = {} as Ctx;

function tinyPng(): Buffer {
  const crc = (buffer: Buffer) => { let c = ~0; for (const byte of buffer) { c ^= byte; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type: string, data: Buffer) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([length, body, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(4, 0); header.writeUInt32BE(4, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(4 * 13, 0x80))), chunk('IEND', Buffer.alloc(0))]);
}

/** A revision body as a draft input: bindings are derived from agent_ref by the service. */
function draftBody(body: any): any {
  return { ...body, roles: body.roles.map(({ binding_id: _binding, ...role }: any) => role) };
}
async function messages(): Promise<any[]> {
  return (await ctx.api.get(`/conversations/${ctx.conversation.id}/messages?limit=200`)).messages;
}
async function deliverables(): Promise<any[]> {
  return (await ctx.api.get(`/projects/${ctx.project.id}/deliverables`)).deliverables;
}
async function settledTask(predicate: (task: any) => boolean, label: string, timeoutMs = 180_000): Promise<any> {
  return eventually(label, async () => {
    const tasks = (await ctx.api.get(`/projects/${ctx.project.id}/tasks`)).tasks as any[];
    const task = tasks.find(predicate);
    if (task && ['failed', 'cancelled', 'unknown'].includes(task.state)) throw Object.assign(new Error(`${label} ended ${task.state}: ${JSON.stringify(task.outcome)}`), { fatal: true });
    return task && ['completed', 'partial', 'input_required'].includes(task.state) ? task : undefined;
  }, timeoutMs, 1500);
}

test.afterAll(() => ctx.stream?.close());

test('1. create the project with references, both indexed into HiveMem', async () => {
  ctx.token = await signIn('hivexui-ardentstudio');
  ctx.api = new StudioApi(ctx.token);
  ctx.project = await ctx.api.post('/projects', {
    name: `Emberfall One-Shot ${Date.now().toString(36)}`, brief_md: 'A short hopeful one-shot along the ember road, for four players.',
    audience: 'Tabletop group', constraints: ['Fits one four-hour session'], tags: ['adventure'],
    deliverables: [
      { name: 'Adventure Text', kind: 'document', formats: ['docx', 'pdf'], producer_role_key: 'worldbuilder' },
      { name: 'Region Map', kind: 'map', formats: ['svg'], producer_role_key: 'cartographer' },
    ],
  });
  expect(ctx.project.id).toMatch(/^prj_/);
  ctx.stream = new ProjectStream(ctx.token, ctx.project.id);
  await ctx.stream.open();
  await ctx.api.upload(ctx.project.id, 'style-guide.md', 'text/markdown', Buffer.from('# Style guide\n\nWarm light against ash. Names are short and old.\n'));
  await ctx.api.upload(ctx.project.id, 'sample-map.png', 'image/png', tinyPng());
  const files = await eventually('references indexed', async () => {
    const list = (await ctx.api.get(`/projects/${ctx.project.id}/files`)).files as any[];
    return list.length === 2 && list.every(file => ['indexed', 'unsupported'].includes(file.knowledge.state)) ? list : undefined;
  }, 90_000);
  expect(files.find(file => file.name === 'style-guide.md').knowledge.state).toBe('indexed');
  const project = await ctx.api.get(`/projects/${ctx.project.id}`);
  expect(project.hivemem.state).toBe('ready');
  const home = (await ctx.api.get(`/projects?q=${encodeURIComponent('Emberfall')}`)).projects as any[];
  expect(home.some(item => item.id === ctx.project.id)).toBe(true);
});

test('2. apply Adventure Studio, bind two agents, create the Cartographer with New Agent, publish and save the variant', async () => {
  const { agents } = stack();
  ctx.agents = agents.map(agent => agent.ref);
  const templates = (await ctx.api.get('/templates?kind=team')).templates as any[];
  const adventure = templates.find(item => item.slug === 'adventure-studio');
  expect(adventure).toBeTruthy();
  const applied = await ctx.api.post(`/projects/${ctx.project.id}/team/apply-template`, { template_id: adventure.id, version: adventure.latest_version });
  const draft = applied.draft;
  const keep = new Set(['story_lead', 'worldbuilder', 'cartographer']);
  const body = draftBody(structuredClone(draft.body));
  body.roles = body.roles.filter((role: any) => keep.has(role.key));
  body.relationships = body.relationships.filter((edge: any) => keep.has(edge.from) && keep.has(edge.to));
  const role = (key: string) => body.roles.find((item: any) => item.key === key);
  role('story_lead').agent_ref = ctx.agents[0];
  role('worldbuilder').agent_ref = ctx.agents[1];
  role('worldbuilder').instructions_md = 'Keep every name short and old, as the style guide asks.';
  await ctx.api.put(`/projects/${ctx.project.id}/team/draft`, { base_revision: null, source_template: draft.source_template, body });

  ctx.mapper = `mapper${Date.now().toString(36).slice(-4)}`;
  const operation = await ctx.api.post('/agents', { node_id: stack().node.id, profile: ctx.mapper,
    soul_md: '# Cartographer\nDraws clear maps.', identity_md: '# Cartographer\nAn Ardent agent that draws region maps.',
    model: { base_url: 'http://model:8080', model: 'studio-fixture' }, project_id: ctx.project.id, role_key: 'cartographer' });
  const done = await eventually('New Agent operation', async () => {
    const current = await ctx.api.get(`/agents/operations/${operation.id}`);
    if (current.status === 'failed') throw Object.assign(new Error(`New Agent failed: ${JSON.stringify(current.steps)}`), { fatal: true });
    return current.status === 'succeeded' ? current : undefined;
  }, 300_000, 3000);
  expect(done.steps.find((step: any) => step.name === 'hivemem-enroll')?.status).toBe('succeeded');
  await ctx.stream.waitFor(event => event.type === 'agent.operation.updated' && event.data.payload?.operation?.status === 'succeeded', 30_000, 'agent.operation.updated');
  const mapperRef = `${stack().node.id}~${ctx.mapper}`;
  // Listed at once: the finished operation clears Studio's short profile cache.
  const agentsList = (await ctx.api.get('/agents')).agents as any[];
  expect(agentsList.find(agent => agent.agent_ref === mapperRef)?.available).toBe(true);
  const team = await ctx.api.get(`/projects/${ctx.project.id}/team`);
  const next = draftBody(structuredClone(team.draft.body));
  const cartographer = next.roles.find((item: any) => item.key === 'cartographer');
  if (cartographer.agent_ref !== mapperRef) {
    cartographer.agent_ref = mapperRef;
    await ctx.api.put(`/projects/${ctx.project.id}/team/draft`, { base_revision: null, source_template: team.draft.source_template, body: next });
  }
  const validation = await ctx.api.post(`/projects/${ctx.project.id}/team/validate`, {});
  expect(validation.can_publish, JSON.stringify(validation.issues)).toBe(true);
  const latest = await ctx.api.get(`/projects/${ctx.project.id}/team`);
  const published = await ctx.api.post(`/projects/${ctx.project.id}/team/publish`, { draft_revision: latest.draft.revision });
  expect(published.current.revision).toBe(1);
  const saved = await ctx.api.post(`/projects/${ctx.project.id}/team/save-as-template`, { from: 'current', name: `Adventure Studio (short) ${ctx.project.id.slice(-4)}`, changelog: 'Three roles for one-shots' });
  expect(saved.source ?? saved.template?.source).toBe('user');

});

test('3-4. room: streamed reply, clarification and answer, allowed hand-off, pinned decision', async () => {
  ctx.conversation = await ctx.api.post(`/projects/${ctx.project.id}/conversations`, { kind: 'team', title: 'Team room' }).catch(async error => {
    const existing = (await ctx.api.get(`/projects/${ctx.project.id}/conversations`)).conversations.find((item: any) => item.kind === 'team');
    if (!existing) throw error;
    return existing;
  });
  const posted = await ctx.api.post(`/conversations/${ctx.conversation.id}/messages`, { body_md: '@worldbuilder propose three region names' });
  expect(posted.tasks).toHaveLength(1);
  const reply = await eventually('streamed reply', async () => (await messages()).find(message => message.author.kind === 'agent' && message.ardent?.task_id === undefined ? false : message.author.kind === 'agent' && /Ashen Fen/.test(message.body_md) && message.state === 'complete'), 120_000);
  const deltas = ctx.stream.events.filter(event => event.type === 'message.delta' && event.data.message_id === reply.id);
  expect(deltas.length, 'live deltas for the reply').toBeGreaterThan(3);
  expect(deltas.map(event => event.data.text).join('')).toContain('Ashen');

  await ctx.api.post(`/conversations/${ctx.conversation.id}/messages`, { body_md: 'Outline the adventure', to: { kind: 'team' } });
  const question = await eventually('clarification', async () => (await messages()).find(message => message.kind === 'clarification'), 120_000);
  expect(question.body_md + JSON.stringify(question.links)).toContain('tone');
  await ctx.api.post(`/messages/${question.id}/answer`, { body_md: 'Hopeful adventure', option: 'Hopeful adventure' });
  const proposal = await eventually('decision proposal', async () => (await messages()).find(message => message.kind === 'decision_proposal'), 120_000);
  const handoff = await eventually('hand-off', async () => (await messages()).find(message => message.kind === 'handoff'), 120_000);
  expect(handoff.body_md).toContain('Worldbuilder');
  const decision = await ctx.api.post(`/projects/${ctx.project.id}/decisions`, { title: 'Adventure outline', statement_md: 'Three acts: the Ember Road, Ashen Fen and Glowmere.', source_message_id: proposal.id });
  expect(decision.id).toMatch(/^dec_/);
  await settledTask(task => task.mode === 'assignment' && task.role_key === 'worldbuilder', 'adventure text task', 240_000);
});

test('4b. task from a message for the Cartographer, refused hand-off, map import', async () => {
  const source = (await messages()).find(message => message.kind === 'decision_proposal');
  const task = await ctx.api.post(`/projects/${ctx.project.id}/tasks`, { title: 'Draw the region map', role_key: 'cartographer', instructions_md: 'Show Ashen Fen, Cinderwatch Heights and Glowmere.', source_message_id: source.id });
  expect(task.mode).toBe('assignment');
  await settledTask(item => item.id === task.id, 'map task');
  const refusal = await eventually('hand-off refusal', async () => (await messages()).find(message => message.kind === 'system' && (message.links as any)?.handoff?.allowed === false), 60_000);
  expect(refusal.body_md).toMatch(/no delegates_to or hands_off_to relationship/);
  const map = await eventually('Region Map r1', async () => (await deliverables()).find(item => item.name === 'Region Map' && item.revisions.length >= 1), 60_000);
  const revision = map.revisions[0];
  expect(revision.mime).toBe('image/svg+xml');
  expect(revision.source_task_id).toBe(task.id);
  expect(revision.blob_sha256).toMatch(/^[a-f0-9]{64}$/);
  ctx.deliverables = { map };
});

test('6a. an artifact over 2 MiB reaches review', async () => {
  const task = await ctx.api.post(`/projects/${ctx.project.id}/tasks`, { title: 'Make a print poster of the map', role_key: 'cartographer' });
  await settledTask(item => item.id === task.id, 'poster task', 240_000);
  const poster = await eventually('poster import', async () => (await deliverables()).find(item => item.revisions.some((revision: any) => revision.mime === 'image/png')), 120_000);
  const revision = poster.revisions[0];
  expect(revision.size).toBeGreaterThan(2 * 1024 * 1024);
  const blob = await ctx.api.blob(revision.blob_sha256);
  expect(blob.status).toBe(200);
  expect(blob.body.length).toBe(revision.size);
});

test('6-7. review comments, revision requests, new revisions with supersedes, accept and final', async () => {
  const all = await deliverables();
  const map = all.find(item => item.name === 'Region Map');
  const text = all.find(item => item.name === 'Adventure Text');
  expect(text?.revisions[0]?.mime).toBe('application/pdf');
  const mapComment = await ctx.api.post(`/revisions/${map.revisions[0].id}/comments`, { anchor: { kind: 'image', x: 0.4, y: 0.65, w: 0.2, h: 0.1 }, body_md: 'Add a ford across the swamp.' });
  const textComment = await ctx.api.post(`/revisions/${text.revisions[0].id}/comments`, { anchor: { kind: 'pdf', page: 1, quote: 'The finale' }, body_md: 'Shorten the finale.' });
  const mapRequest = await ctx.api.post(`/projects/${ctx.project.id}/revision-requests`, { comment_ids: [mapComment.id] });
  const textRequest = await ctx.api.post(`/projects/${ctx.project.id}/revision-requests`, { comment_ids: [textComment.id] });
  expect(mapRequest.task.mode).toBe('revision');
  expect(mapRequest.comments[0].revision_task_id).toBe(mapRequest.task.id);
  await settledTask(item => item.id === mapRequest.task.id, 'map revision');
  await settledTask(item => item.id === textRequest.task.id, 'text revision');
  const revised = await eventually('second revisions', async () => {
    const list = await deliverables();
    const m = list.find(item => item.name === 'Region Map'); const t = list.find(item => item.name === 'Adventure Text');
    return m.revisions.length >= 2 && t.revisions.length >= 2 ? { m, t } : undefined;
  }, 60_000);
  for (const deliverable of [revised.m, revised.t]) {
    const second = deliverable.revisions.find((revision: any) => revision.revision === 2);
    expect(second.supersedes_revision_id).toBe(deliverable.revisions.find((revision: any) => revision.revision === 1).id);
    const comments = (await ctx.api.get(`/revisions/${deliverable.revisions.find((revision: any) => revision.revision === 1).id}/comments`)).comments as any[];
    expect(comments[0].addressed_in_revision_id).toBe(second.id);
    await ctx.api.post(`/revisions/${second.id}/decisions`, { decision: 'accepted', note_md: 'Looks right.' });
    await ctx.api.post(`/deliverables/${deliverable.id}/final`, { revision_id: second.id });
  }
  const svg = await ctx.api.blob(revised.m.revisions.find((revision: any) => revision.revision === 2).blob_sha256);
  expect(svg.text).toContain('Old Ford');
  const final = await deliverables();
  expect(final.find(item => item.name === 'Region Map').final_revision_id).toBeTruthy();
});

test('8. export: the zip holds the final PDF, SVG and manifest', async () => {
  const record = await ctx.api.post(`/projects/${ctx.project.id}/exports`, {});
  const zip = await ctx.api.blob(record.blob_sha256);
  expect(zip.status).toBe(200);
  const directory = mkdtempSync(join(tmpdir(), 'studio-export-'));
  try {
    writeFileSync(join(directory, 'export.zip'), zip.body);
    const entries = execFileSync('unzip', ['-Z1', join(directory, 'export.zip')], { encoding: 'utf8' }).trim().split('\n');
    expect(entries).toContain('manifest.json');
    expect(entries.some(entry => entry.endsWith('.svg'))).toBe(true);
    expect(entries.some(entry => entry.endsWith('.pdf'))).toBe(true);
    const manifest = JSON.parse(execFileSync('unzip', ['-p', join(directory, 'export.zip'), 'manifest.json'], { encoding: 'utf8' }));
    expect(manifest.decisions.length).toBeGreaterThan(0);
    expect(manifest.deliverables.every((item: any) => item.acceptance_status === 'approved' || item.review?.status === 'accepted' || item.acceptance_status)).toBe(true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('reconnect: a dropped project stream resumes from its cursor', async () => {
  const seen = ctx.stream.events.filter(event => event.id).length;
  const last = Number([...ctx.stream.events].reverse().find(event => event.id)?.id);
  ctx.stream.close();
  await ctx.api.post(`/conversations/${ctx.conversation.id}/messages`, { body_md: '@worldbuilder propose three region names again' });
  await new Promise(resolve => setTimeout(resolve, 1500));
  const resumed = new ProjectStream(ctx.token, ctx.project.id);
  await resumed.open(last);
  const created = await resumed.waitFor(event => event.type === 'message.created', 30_000, 'missed message.created');
  expect(Number(created.id)).toBeGreaterThan(last);
  await resumed.waitFor(event => event.type === 'message.updated' && event.data.payload?.message?.state === 'complete' && /Ashen Fen/.test(event.data.payload.message.body_md), 120_000, 'completed reply after reconnect');
  ctx.stream = resumed;
  expect(seen).toBeGreaterThan(0);
});

test('room states follow the service: queued (Starting), working, delivering, available, and blocked on a failed task', async () => {
  const cartographer = `${stack().node.id}~${ctx.mapper}`;
  const mark = ctx.stream.events.length;
  const states = () => ctx.stream.events.slice(mark).filter(event => event.type === 'presence.updated' && event.data.payload?.agent_ref === cartographer).map(event => event.data.payload);
  await ctx.api.post(`/conversations/${ctx.conversation.id}/messages`, { body_md: '@cartographer draw the region map once more' });
  await eventually('available again', async () => states().some((item: any, index: number) => item.state === 'available' && index > 0 && states().slice(0, index).some((prior: any) => prior.state === 'delivering')), 120_000, 500);
  const seen = states().map((item: any) => item.state);
  const first = (state: string) => seen.indexOf(state);
  expect(first('queued'), seen.join(' > ')).toBeGreaterThanOrEqual(0);
  expect(states().find((item: any) => item.state === 'queued').label).toMatch(/^(Queued|Starting): /);
  expect(first('working')).toBeGreaterThan(first('queued'));
  expect(first('delivering')).toBeGreaterThan(first('working'));
  expect(states().find((item: any) => item.state === 'delivering').label).toMatch(/^Delivered Region Map r\d+$/);
  expect(seen.lastIndexOf('available')).toBeGreaterThan(first('delivering'));

  const failing = ctx.stream.events.length;
  await ctx.api.post(`/conversations/${ctx.conversation.id}/messages`, { body_md: '@cartographer fail this turn' });
  const blocked = await ctx.stream.waitFor((event, index = ctx.stream.events.indexOf(event)) => index >= failing && event.type === 'presence.updated'
    && event.data.payload?.agent_ref === cartographer && event.data.payload.state === 'blocked', 120_000, 'blocked');
  expect(blocked.data.payload.label).toMatch(/^Blocked: /);
  await ctx.api.post(`/conversations/${ctx.conversation.id}/messages`, { body_md: '@cartographer draw the region map again' });
  await ctx.stream.waitFor(event => ctx.stream.events.indexOf(event) > ctx.stream.events.indexOf(blocked) && event.type === 'presence.updated'
    && event.data.payload?.agent_ref === cartographer && ['queued', 'working'].includes(event.data.payload.state), 60_000, 'new work clears blocked');
});
