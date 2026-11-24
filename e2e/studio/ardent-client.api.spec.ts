// ARDENT-06 acceptance through Magnus: the published @hivemagnus/ardent-client, used the way Ardent's
// client/examples/cli.mjs uses it (submit, follow, final outcome, artifact download), with `viaMagnus`
// against the stack's Magnus and the `ember` agent (Ardent 3.2.0). A test proxy in the client's `fetch`
// drops the task stream twice and resets the artifact transfer part-way, and records what the client sent.
//
// The client is pointed at the console origin, `<origin>/api/magnus`, which the ingress rewrites to
// Magnus's `/api/v1`. viaMagnus appends `/api/v1/ardent/...` to its baseUrl, so no baseUrl on the console
// origin reaches Magnus: `<origin>/api/magnus` asks for `/api/magnus/api/v1/...` and gets 404. Test 6
// pins that; the others go through `consolePath`, which drops the doubled `/api/v1` and nothing else.
//
// The console ingress also forwards Last-Event-ID to Magnus when the request has none, as an empty header,
// and Magnus answers a task stream with an empty Last-Event-ID 400 "Invalid Last-Event-ID". A follow that
// starts without a cursor is refused before its first event; one that resumes (`after`, and so
// Last-Event-ID) is not. Test 7 pins that; the acceptance follow starts at `after: 0`.
import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  createArdentClient, NotFoundError, UnsupportedCapabilityError, viaMagnus, type ArdentClient, type TaskEvent,
} from '@hivemagnus/ardent-client';
import { eventually, signIn, stack, stackAvailable, stackFetch, StudioApi } from './support/stack';

test.describe.configure({ mode: 'serial' });
test.skip(!stackAvailable(), 'The Studio end-to-end stack is not running (Docker unavailable or not started)');

const PROFILE = 'ember';
// The fixture model answers a worldbuilder asked for region names with a reply of about fifty streamed words.
const PROMPT = 'You hold the role key "worldbuilder". Propose three region names for the ember road.';

type Sent = { method: string; path: string; status: number; range: string | null; ifRange: string | null; lastEventId: string | null; contentRange: string | null };

/** Maps the client's `<base>/api/v1/...` onto the console's `/api/magnus/...` (see the note at the top). */
function consolePath(url: string): string {
  const prefix = `${stack().origin}/api/magnus/api/v1/`;
  return url.startsWith(prefix) ? `${stack().origin}/api/magnus/${url.slice(prefix.length)}` : url;
}

/** Pass a body through until `cutAt` names a byte of a chunk, deliver the bytes before it, then fail as a dropped connection does. */
function severed(response: Response, cutAt: (chunk: Uint8Array, offset: number) => number | undefined, onCut: () => void): Response {
  const reader = response.body!.getReader();
  let offset = 0;
  let dropped = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // Erroring discards queued chunks, so the bytes before the cut are read first and the drop comes on the next pull.
      if (dropped) {
        await reader.cancel().catch(() => undefined);
        controller.error(new TypeError('terminated: the test proxy dropped the connection'));
        return;
      }
      const { done, value } = await reader.read();
      if (done) { controller.close(); return; }
      const at = cutAt(value, offset);
      offset += value.length;
      if (at === undefined) { controller.enqueue(value); return; }
      dropped = true;
      onCut();
      if (at > 0) controller.enqueue(value.subarray(0, at));
    },
    cancel: reason => reader.cancel(reason),
  });
  return new Response(body, { status: response.status, headers: response.headers });
}

/**
 * The test proxy: the client's `fetch`. It drops the first `streams` task streams in the middle of the frame
 * after their first journaled event, and resets the first `downloads` artifact transfers a third of the way in.
 */
class TestProxy {
  readonly sent: Sent[] = [];
  streamDrops = 0;
  downloadDrops = 0;
  /** `consolePath: false` sends the client's URLs unchanged. */
  constructor(private readonly plan: { streams: number; downloads: number; consolePath?: boolean }) {}

  readonly fetch = async (input: string, init: RequestInit): Promise<Response> => {
    const url = this.plan.consolePath === false ? input : consolePath(input);
    const headers = new Headers(init.headers);
    const response = await stackFetch(url, init);
    this.sent.push({ method: init.method ?? 'GET', path: new URL(url).pathname + new URL(url).search, status: response.status, range: headers.get('range'),
      ifRange: headers.get('if-range'), lastEventId: headers.get('last-event-id'), contentRange: response.headers.get('content-range') });
    if (!response.ok || !response.body) return response;
    if (/\/tasks\/[^/]+\/stream$/.test(new URL(url).pathname) && this.streamDrops < this.plan.streams) {
      let seen = Buffer.alloc(0);
      return severed(response, (chunk, offset) => {
        seen = Buffer.concat([seen, chunk]);
        const event = seen.indexOf('event: task.event');
        const end = event < 0 ? -1 : seen.indexOf('\n\n', event);
        if (end < 0) return undefined;
        // Half of what follows the first event's frame: the next frame arrives torn.
        const cut = end + 2 + Math.floor((seen.length - end - 2) / 2);
        return Math.max(0, cut - offset);
      }, () => { this.streamDrops += 1; });
    }
    if (/\/artifacts\/[a-f0-9]{64}\/content$/.test(new URL(url).pathname) && !headers.has('range') && this.downloadDrops < this.plan.downloads) {
      const third = Math.floor(Number(response.headers.get('content-length') ?? 0) / 3);
      if (third <= 0) return response;
      return severed(response, (chunk, offset) => offset + chunk.length > third ? third - offset : undefined, () => { this.downloadDrops += 1; });
    }
    return response;
  };
}

const ctx = {} as { token: string; proxy: TestProxy; ardent: ArdentClient; root: string; taskId: string };

function client(proxy: TestProxy): ArdentClient {
  const { origin, node } = stack();
  return createArdentClient({
    transport: viaMagnus({ baseUrl: `${origin}/api/magnus`, nodeId: node.id, profile: PROFILE, getToken: () => ctx.token, fetch: proxy.fetch }),
    execution: { v: 1, root: ctx.root },
  });
}

test.beforeAll(async () => {
  ctx.token = await signIn('hivexui-magnus');
  ctx.root = `hx1:hivexui:e2e:request:${randomUUID()}`;
  ctx.proxy = new TestProxy({ streams: 2, downloads: 1 });
  ctx.ardent = client(ctx.proxy);
});

test('1. capabilities: Magnus 3.3.0 offers every Ardent 3.2.0 route to the client', async () => {
  const capabilities = await ctx.ardent.capabilities();
  expect(capabilities).toMatchObject({ transport: 'magnus', profile: PROFILE, artifactTransfer: 2,
    features: { recovery: true, lineage: true, execution: true, artifactContent: true, renditions: true, imports: true } });
  expect(capabilities.version).toBe('3.2.0');
  expect(capabilities.magnus?.installedVersion).toBe('3.2.0');
});

test('2. submit and follow: the stream drops twice, every journaled event arrives once and in order', async () => {
  const events: TaskEvent[] = [];
  const connects: Array<{ cursor: number | undefined; reconnect: number; seen: number }> = [];
  let text = '';
  const accepted = await ctx.ardent.tasks.submit({ prompt: PROMPT, idempotencyKey: randomUUID() });
  ctx.taskId = accepted.task_id;
  // From the journal's start: without a cursor the console ingress gets the stream refused (test 7).
  const task = await ctx.ardent.tasks.follow(accepted.task_id, {
    after: 0,
    onConnect: (cursor, reconnect) => { connects.push({ cursor, reconnect, seen: events.at(-1)?.sequence ?? 0 }); },
    onEvent: event => { events.push(event); },
    onText: update => { text = update.kind === 'text' ? update.text : text + update.text; },
  });
  expect(task.id).toBe(accepted.task_id);
  expect(task.state).toBe('completed');
  expect(task.result).toContain('Ashen Fen');
  expect(text).toContain('Glowmere');

  // Both drops happened, and each reconnect resumed from the last journaled event the client handled.
  expect(ctx.proxy.streamDrops).toBe(2);
  expect(connects.length).toBeGreaterThanOrEqual(3);
  expect(connects[0]!.cursor).toBe(0);
  for (const connect of connects.slice(1)) expect(connect.cursor).toBe(connect.seen);
  const resumed = ctx.proxy.sent.filter(item => item.path.includes(`/tasks/${accepted.task_id}/stream`)).slice(1);
  expect(resumed.length).toBeGreaterThanOrEqual(2);
  for (const request of resumed) expect(request.path).toMatch(/[?&]after=\d+/);

  // No gap and no duplicate: contiguous sequences, the whole journal.
  const sequences = events.map(event => event.sequence);
  for (let index = 1; index < sequences.length; index += 1) expect(sequences[index]).toBe(sequences[index - 1]! + 1);
  const journal = await ctx.ardent.tasks.events(accepted.task_id);
  expect(sequences).toEqual(journal.map(event => event.sequence));
  expect(events.every(event => event.task_id === accepted.task_id)).toBe(true);
});

test('3. lineage and recovery reads', async () => {
  test.skip(!ctx.taskId, 'Needs the task from test 2');
  const lineage = await ctx.ardent.lineage(ctx.taskId);
  expect(lineage.task_id).toBe(ctx.taskId);
  // The execution context reached the profile through Magnus as the task's root.
  expect(lineage.execution?.root).toBe(ctx.root);
  expect(lineage.source).toBe('caller');
  expect(lineage.model_attempts.length).toBeGreaterThan(0);
  expect(lineage.continuations).toEqual([]);
  // Ardent answers 404 for a task that was never interrupted, which the client reads as no recovery.
  expect(await ctx.ardent.recovery.get(ctx.taskId)).toBeNull();
  await expect(ctx.ardent.recovery.get(randomUUID())).rejects.toBeInstanceOf(NotFoundError);
});

test('4. artifact download: a reset part-way resumes with Range, and the digest holds', async () => {
  // A task submitted through the client gets no artifact tool (artifact_write is a mission tool), so a Studio
  // mission asks ember, as the Cartographer, for the fixture model's print poster of about 3 MiB.
  const { agents } = stack();
  const ember = agents.find(agent => agent.profile === PROFILE)!;
  const other = agents.find(agent => agent.profile !== PROFILE)!;
  const studio = new StudioApi(await signIn('hivexui-ardentstudio'));
  const project = await studio.post('/projects', { name: `Ardent client ${Date.now().toString(36)}`, brief_md: 'A print poster for the client download check.',
    deliverables: [{ name: 'Region Map', kind: 'map', formats: ['svg'], producer_role_key: 'cartographer' }] });
  const template = ((await studio.get('/templates?kind=team')).templates as any[]).find(item => item.slug === 'adventure-studio');
  const applied = await studio.post(`/projects/${project.id}/team/apply-template`, { template_id: template.id, version: template.latest_version });
  const keep = new Set(['story_lead', 'cartographer']);
  const body = { ...applied.draft.body, roles: applied.draft.body.roles.filter((role: any) => keep.has(role.key)).map(({ binding_id: _binding, ...role }: any) => role) };
  body.relationships = body.relationships.filter((edge: any) => keep.has(edge.from) && keep.has(edge.to));
  body.roles.find((role: any) => role.key === 'cartographer').agent_ref = ember.ref;
  body.roles.find((role: any) => role.key === 'story_lead').agent_ref = other.ref;
  const saved = await studio.put(`/projects/${project.id}/team/draft`, { base_revision: null, source_template: applied.draft.source_template, body });
  await studio.post(`/projects/${project.id}/team/publish`, { draft_revision: saved.draft.revision });
  const posted = await studio.post(`/projects/${project.id}/tasks`, { title: 'Make a print poster of the map', role_key: 'cartographer' });
  const finished = await eventually('the poster task', async () => {
    const task = ((await studio.get(`/projects/${project.id}/tasks?state=all`)).tasks as any[]).find(item => item.id === posted.id);
    if (task && ['failed', 'cancelled', 'unknown'].includes(task.state)) throw new Error(`The poster task ended ${task.state}: ${JSON.stringify(task.outcome)}`);
    return task && ['completed', 'partial'].includes(task.state) ? task : undefined;
  }, 300_000, 2000);
  expect(finished.ardent.agent_ref).toBe(ember.ref);

  const artifacts = await ctx.ardent.artifacts.list(finished.ardent.task_id);
  const poster = artifacts.find(artifact => artifact.manifest.mime === 'image/png');
  test.skip(!poster, `The fixture model wrote no PNG for Ardent task ${finished.ardent.task_id}; artifacts: ${artifacts.map(item => item.manifest.mime).join(', ') || 'none'}`);
  const { sha256, size } = poster!.manifest;
  expect(size).toBeGreaterThan(2 * 1024 * 1024);

  let resumes = 0;
  const download = await ctx.ardent.artifacts.download(sha256, { onProgress: progress => { resumes = progress.resumes; } });
  expect(download).toMatchObject({ sha256, size, offset: 0, mime: 'image/png' });
  const bytes = Buffer.from(await new Response(download.stream).arrayBuffer());
  expect(ctx.proxy.downloadDrops).toBe(1);
  expect(resumes).toBe(1);
  expect(bytes.length).toBe(size);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256);
  // The resumed request asked for the rest only if the artifact is unchanged, and Magnus answered with that range.
  const transfers = ctx.proxy.sent.filter(item => item.path.endsWith(`/artifacts/${sha256}/content`));
  expect(transfers).toHaveLength(2);
  const resumed = transfers[1]!;
  const from = Number(/^bytes=(\d+)-$/.exec(resumed.range ?? '')?.[1]);
  expect(from).toBe(Math.floor(size / 3));
  expect(resumed.ifRange).toBe(`"${sha256}"`);
  expect(resumed.status).toBe(206);
  expect(resumed.contentRange).toBe(`bytes ${from}-${size - 1}/${size}`);
});

test('5. a route outside Magnus\'s allowlist answers the documented error', async () => {
  // Every route the client calls is on Magnus 3.3.0's allowlist, so the client reaches one outside it only with
  // an identifier Ardent's own route takes and Magnus's pattern refuses (an import ID is 32 hex digits there).
  // Magnus answers 404, and while it advertises the capability the client documents that as NotFoundError;
  // UnsupportedCapabilityError is for a capability Magnus or the profile lacks, which this stack never has.
  const error = await ctx.ardent.artifacts.importStatus('import-outside-the-allowlist').catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(NotFoundError);
  expect(error).not.toBeInstanceOf(UnsupportedCapabilityError);
  expect((error as NotFoundError).status).toBe(404);
  const refused = ctx.proxy.sent.at(-1)!;
  expect(refused.path).toMatch(/\/profiles\/ember\/artifacts\/imports\/import-outside-the-allowlist$/);
  expect(refused.status).toBe(404);
});

// The two known defects, each pinned to the exact refusal it causes now. When one is fixed its test fails
// here; then assert the working call instead and drop the matching step around it above.
test('6. known defect: viaMagnus cannot reach Magnus at the console origin <origin>/api/magnus', async () => {
  test.info().annotations.push({ type: 'defect', description: 'viaMagnus appends /api/v1 to baseUrl; the console serves Magnus at /api/magnus' });
  const proxy = new TestProxy({ streams: 0, downloads: 0, consolePath: false });
  const { origin, node } = stack();
  const plain = createArdentClient({ transport: viaMagnus({ baseUrl: `${origin}/api/magnus`, nodeId: node.id, profile: PROFILE, getToken: () => ctx.token, fetch: proxy.fetch }) });
  const error = await plain.status().catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(NotFoundError);
  expect(error).toMatchObject({ status: 404, message: 'API unavailable' });
  expect(proxy.sent.find(item => item.path === `/api/magnus/api/v1/ardent/installations/${node.id}/profiles/${PROFILE}/status`)?.status).toBe(404);
});

test('7. known defect: a follow without a cursor is refused through the console ingress', async () => {
  test.skip(!ctx.taskId, 'Needs the task from test 2');
  test.info().annotations.push({ type: 'defect', description: 'The ingress forwards an empty Last-Event-ID, and Magnus refuses the task stream' });
  const proxy = new TestProxy({ streams: 0, downloads: 0 });
  const error = await client(proxy).tasks.follow(ctx.taskId).catch((caught: unknown) => caught);
  expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', message: 'Invalid Last-Event-ID' });
  // The client sent no Last-Event-ID and no cursor.
  const stream = proxy.sent.find(item => item.path.includes(`/tasks/${ctx.taskId}/stream`))!;
  expect(stream).toMatchObject({ lastEventId: null, status: 400 });
  expect(stream.path).not.toContain('after=');
});
