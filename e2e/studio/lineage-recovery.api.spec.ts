// Build-plan verification scenarios 1-4 and 10 through the Studio API: cross-product ancestry,
// interrupted execution, transfer recovery, event reconnect and the branch-and-join workflow. They
// need Studio 0.5.0 with agents on Ardent 3.2.0 behind Magnus 3.3.0, so each one skips on a stack
// that runs older versions (the stack's bootstrap still pins the released ones). Scenario 2 also needs
// a fault-injection hook the stack does not have yet, so it stays a marked stub.
import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { call, eventually, ProjectStream, signIn, stack, stackAvailable, StudioApi } from './support/stack';

test.describe.configure({ mode: 'serial' });
test.skip(!stackAvailable(), 'The Studio end-to-end stack is not running (Docker unavailable or not started)');

const ctx = {} as { api: StudioApi; token: string; supported: boolean; reason: string; project: any; conversation: any };
const atLeast = (version: string | null | undefined, minimum: string) => {
  const have = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? '')?.slice(1).map(Number);
  const need = minimum.split('.').map(Number);
  if (!have) return false;
  for (let index = 0; index < 3; index += 1) if (have[index] !== need[index]) return have[index]! > need[index]!;
  return true;
};

test.beforeAll(async () => {
  ctx.token = await signIn('hivexui-ardentstudio');
  ctx.api = new StudioApi(ctx.token);
  const agents = ((await ctx.api.get('/agents')).agents as any[]) ?? [];
  const old = agents.filter((agent) => !atLeast(agent.installation_version, '3.2.0'));
  ctx.supported = agents.length > 0 && old.length === 0;
  ctx.reason = old.length ? `agents on Ardent before 3.2.0: ${old.map((agent) => agent.agent_ref).join(', ')}` : 'no agent available';
});

async function project(name: string) {
  ctx.project = await ctx.api.post('/projects', { name: `${name} ${Date.now().toString(36)}`, brief_md: 'Verification scenario.' });
  const template = ((await ctx.api.get('/templates?kind=team')).templates as any[]).find((item) => item.slug === 'research-team');
  const applied = await ctx.api.post(`/projects/${ctx.project.id}/team/apply-template`, { template_id: template.id, version: template.latest_version });
  const keep = new Set(['lead_researcher', 'fact_checker']);
  const body = { ...applied.draft.body, roles: applied.draft.body.roles.filter((role: any) => keep.has(role.key)).map(({ binding_id: _binding, ...role }: any) => role) };
  body.relationships = body.relationships.filter((edge: any) => keep.has(edge.from) && keep.has(edge.to));
  const [lead, checker] = stack().agents;
  body.roles.find((role: any) => role.key === 'lead_researcher').agent_ref = lead!.ref;
  body.roles.find((role: any) => role.key === 'fact_checker').agent_ref = checker!.ref;
  const saved = await ctx.api.put(`/projects/${ctx.project.id}/team/draft`, { base_revision: null, source_template: applied.draft.source_template, body });
  await ctx.api.post(`/projects/${ctx.project.id}/team/publish`, { draft_revision: saved.draft.revision });
  ctx.conversation = await ctx.api.post(`/projects/${ctx.project.id}/conversations`, { kind: 'team' });
}
const settled = (taskId: string) =>
  eventually(`task ${taskId} finished`, async () => {
    const task = ((await ctx.api.get(`/projects/${ctx.project.id}/tasks?state=all`)).tasks as any[]).find((item) => item.id === taskId);
    return task && ['completed', 'partial', 'failed', 'cancelled', 'unknown'].includes(task.state) ? task : undefined;
  }, 300_000, 2000);

test('1. cross-product ancestry: the lineage reconstructs request → task → agent attempts', async () => {
  test.skip(!ctx.supported, ctx.reason);
  await project('Ancestry');
  const task = await ctx.api.post(`/projects/${ctx.project.id}/tasks`, { title: 'Summarize battery recycling', role_key: 'lead_researcher' });
  await settled(task.id);
  const lineage = await ctx.api.get(`/tasks/${task.id}/lineage`);
  expect(lineage.studio.self).toMatch(/^hx1:studio:/);
  expect(lineage.studio.root).toMatch(/^hx1:studio:/);
  const current = lineage.ardent.attempts.at(-1);
  expect(current.current).toBe(true);
  expect(current.lineage.model_attempts.length).toBeGreaterThan(0);
  expect(lineage.emberpath.filter.executionRoot).toBe(lineage.studio.root);
  // Every model attempt names its Emberpath request, which the drawer links to.
  for (const attempt of current.lineage.model_attempts) expect(attempt.ref).toMatch(/^hx1:ardent:.+:attempt:/);
});

test('2. interrupted execution: an uncertain write needs a decision, and mark_not_applied continues once', async () => {
  test.skip(!ctx.supported, ctx.reason);
  test.fixme(true, 'Needs a fault-injection hook in e2e/stack to kill the Ardent profile at the ARDENT-01 cut points with the fixture_write tool');
});

test('3. transfer recovery: a rendition, a ranged original and its digest', async () => {
  test.skip(!ctx.supported, ctx.reason);
  test.skip(!ctx.project, 'Needs the project from scenario 1');
  const deliverables = (await ctx.api.get(`/projects/${ctx.project.id}/deliverables`)).deliverables as any[];
  const revision = deliverables.flatMap((item) => item.revisions).find((item: any) => item.size > 1024);
  test.skip(!revision, 'The research agents delivered no file large enough to range; a large map fixture is needed');
  const whole = await ctx.api.blob(revision.blob_sha256);
  expect(whole.headers['accept-ranges']).toBe('bytes');
  expect(whole.headers['x-content-sha256']).toBe(revision.blob_sha256);
  const half = Math.floor(revision.size / 2);
  const tail = await call(`${stack().origin}/api/ardentstudio/v1/blobs/${revision.blob_sha256}`, { headers: { Authorization: `Bearer ${ctx.token}`, Range: `bytes=${half}-` } });
  expect(tail.status).toBe(206);
  expect(tail.headers['content-range']).toBe(`bytes ${half}-${revision.size - 1}/${revision.size}`);
  const joined = Buffer.concat([whole.body.subarray(0, half), tail.body]);
  expect(createHash('sha256').update(joined).digest('hex')).toBe(revision.blob_sha256);
  const past = await call(`${stack().origin}/api/ardentstudio/v1/blobs/${revision.blob_sha256}`, { headers: { Authorization: `Bearer ${ctx.token}`, Range: `bytes=${revision.size + 10}-` } });
  expect(past.status).toBe(416);
  expect(Array.isArray(revision.renditions)).toBe(true);
});

test('4. event reconnect: a dropped stream replays without gaps or duplicates', async () => {
  test.skip(!ctx.supported, ctx.reason);
  test.skip(!ctx.project, 'Needs the project from scenario 1');
  const stream = new ProjectStream(ctx.token, ctx.project.id);
  await stream.open(0);
  await stream.waitFor((event) => event.type === 'heartbeat', 30_000, 'a heartbeat after the first replay');
  const before = Number(stream.lastSeq());
  stream.close();
  // Everything the task produces happens while the stream is closed, so the replay must hold it all.
  const task = await ctx.api.post(`/projects/${ctx.project.id}/tasks`, { title: 'List three recycling methods', role_key: 'lead_researcher' });
  await settled(task.id);
  const resumed = new ProjectStream(ctx.token, ctx.project.id);
  await resumed.open(before);
  await resumed.waitFor((event) => event.type === 'heartbeat', 30_000, 'a heartbeat after the replay');
  const seqs = resumed.events.filter((event) => event.id).map((event) => Number(event.id));
  expect(seqs[0]).toBe(before + 1);
  expect(seqs).toEqual([...new Set(seqs)].sort((a, b) => a - b));
  for (let index = 1; index < seqs.length; index += 1) expect(seqs[index]).toBe(seqs[index - 1]! + 1);
  resumed.close();
});

test('10. branch and join: two research steps feed a synthesis, which waits for both', async () => {
  test.skip(!ctx.supported, ctx.reason);
  test.skip(!ctx.project, 'Needs the project from scenario 1');
  const run = await ctx.api.post(`/projects/${ctx.project.id}/workflow-runs`, {
    spec: {
      nodes: [
        { key: 'research_a', role: 'lead_researcher', prompt: 'Research collection of used batteries.' },
        { key: 'research_b', role: 'fact_checker', prompt: 'Research hydrometallurgical recovery.' },
        { key: 'synthesis', role: 'lead_researcher', prompt: 'Combine both into one paragraph.', needs: ['research_a', 'research_b'] },
      ],
      output: 'synthesis',
    },
  });
  expect(run.nodes.find((node: any) => node.key === 'synthesis').state).toBe('waiting');
  const finished = await eventually('the workflow run finished', async () => {
    const current = await ctx.api.get(`/projects/${ctx.project.id}/workflow-runs/${run.id}`);
    return ['completed', 'failed', 'blocked', 'cancelled'].includes(current.state) ? current : undefined;
  }, 600_000, 3000);
  // On failure, name each node's state and error (for example a branch Magnus refused).
  const nodes = finished.nodes.map((node: any) => ({ key: node.key, state: node.state, attempt: node.attempt, error: node.error }));
  expect(finished.state, JSON.stringify(nodes)).toBe('completed');
  const synthesis = finished.nodes.find((node: any) => node.key === 'synthesis');
  const research = finished.nodes.filter((node: any) => node.key !== 'synthesis');
  for (const node of research) expect(node.updated_at <= synthesis.updated_at).toBe(true);
});
