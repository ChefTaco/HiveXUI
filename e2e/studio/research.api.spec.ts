// The research acceptance scenario through the Studio API: a sourced summary, a Fact Checker
// review along the team's reviews edge, a comment, a revision and acceptance of a Markdown
// report, and an export.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { ProjectStream, StudioApi, eventually, signIn, stack, stackAvailable } from './support/stack';

test.describe.configure({ mode: 'serial' });
test.skip(!stackAvailable(), 'The Studio end-to-end stack is not running (Docker unavailable or not started)');

const ctx = {} as { api: StudioApi; stream: ProjectStream; project: any; conversation: any };
const messages = async (): Promise<any[]> => (await ctx.api.get(`/conversations/${ctx.conversation.id}/messages?limit=200`)).messages;
const deliverables = async (): Promise<any[]> => (await ctx.api.get(`/projects/${ctx.project.id}/deliverables`)).deliverables;
async function settled(predicate: (task: any) => boolean, label: string): Promise<any> {
  return eventually(label, async () => {
    const task = ((await ctx.api.get(`/projects/${ctx.project.id}/tasks`)).tasks as any[]).find(predicate);
    if (task && ['failed', 'cancelled', 'unknown'].includes(task.state)) throw new Error(`${label} ended ${task.state}`);
    return task && ['completed', 'partial'].includes(task.state) ? task : undefined;
  }, 180_000, 1500);
}
test.afterAll(() => ctx.stream?.close());

test('1. create the Battery Recycling Brief from the Research Team', async () => {
  const token = await signIn('hivexui-ardentstudio');
  ctx.api = new StudioApi(token);
  ctx.project = await ctx.api.post('/projects', { name: `Battery Recycling Brief ${Date.now().toString(36)}`, brief_md: 'A sourced brief on lithium-ion battery recycling.',
    deliverables: [{ name: 'Research Report', kind: 'report', formats: ['md'], producer_role_key: 'lead_researcher' }] });
  ctx.stream = new ProjectStream(token, ctx.project.id);
  await ctx.stream.open();
  await ctx.api.upload(ctx.project.id, 'scope-notes.md', 'text/markdown', Buffer.from('# Scope\n\nCover collection, hydrometallurgy and direct recycling.\n'));
  await eventually('reference indexed', async () => ((await ctx.api.get(`/projects/${ctx.project.id}/files`)).files as any[])[0]?.knowledge.state === 'indexed', 90_000);
  const template = ((await ctx.api.get('/templates?kind=team')).templates as any[]).find(item => item.slug === 'research-team');
  const applied = await ctx.api.post(`/projects/${ctx.project.id}/team/apply-template`, { template_id: template.id, version: template.latest_version });
  const keep = new Set(['lead_researcher', 'fact_checker']);
  const body = { ...applied.draft.body, roles: applied.draft.body.roles.filter((role: any) => keep.has(role.key)).map(({ binding_id: _binding, ...role }: any) => role) };
  body.relationships = body.relationships.filter((edge: any) => keep.has(edge.from) && keep.has(edge.to));
  const [lead, checker] = stack().agents;
  body.roles.find((role: any) => role.key === 'lead_researcher').agent_ref = lead!.ref;
  body.roles.find((role: any) => role.key === 'fact_checker').agent_ref = checker!.ref;
  const saved = await ctx.api.put(`/projects/${ctx.project.id}/team/draft`, { base_revision: null, source_template: applied.draft.source_template, body });
  const published = await ctx.api.post(`/projects/${ctx.project.id}/team/publish`, { draft_revision: saved.draft.revision });
  expect(published.current.body.relationships.some((edge: any) => edge.type === 'reviews' || edge.type === 'delegates_to')).toBe(true);
  ctx.conversation = await ctx.api.post(`/projects/${ctx.project.id}/conversations`, { kind: 'team' });
});

test('2. sourced summary from the Lead Researcher with the report delivered', async () => {
  await ctx.api.post(`/conversations/${ctx.conversation.id}/messages`, { body_md: 'Write a sourced summary of battery recycling.', to: { kind: 'coordinator' } });
  const reply = await eventually('sourced summary', async () => (await messages()).find(message => message.kind === 'reply' && /\[S1\]/.test(message.body_md) && message.state === 'complete'), 120_000);
  expect(reply.body_md).toContain('[S3]');
  const report = await eventually('Research Report r1', async () => (await deliverables()).find(item => item.name === 'Research Report' && item.revisions.length), 60_000);
  expect(report.revisions[0].mime).toBe('text/markdown');
  const handoff = await eventually('hand-off to the Fact Checker', async () => (await messages()).find(message => message.kind === 'handoff'), 60_000);
  expect(handoff.body_md).toContain('Fact Checker');
});

test('3. a Fact Checker review task', async () => {
  const task = await ctx.api.post(`/projects/${ctx.project.id}/tasks`, { title: 'Review the research report claims', role_key: 'fact_checker', mode: 'review' });
  expect(task.mode).toBe('review');
  await settled(item => item.id === task.id, 'review task');
  const review = await eventually('review reply', async () => (await messages()).find(message => message.ardent?.task_id && /claims \[S1\] and \[S3\]/.test(message.body_md)), 60_000);
  expect(review.author.kind).toBe('agent');
});

test('4. comment, revision, acceptance and export of the Markdown report', async () => {
  const report = (await deliverables()).find(item => item.name === 'Research Report');
  const first = report.revisions[0];
  const text = (await ctx.api.blob(first.blob_sha256)).text;
  const quote = 'Hydrometallurgical recovery returns most lithium, cobalt and nickel from spent cells.';
  const start = text.indexOf(quote);
  expect(start).toBeGreaterThan(0);
  const comment = await ctx.api.post(`/revisions/${first.id}/comments`, { anchor: { kind: 'text', start, end: start + quote.length, quote, source_sha256: first.blob_sha256 }, body_md: 'Cite the recovery rates.' });
  const request = await ctx.api.post(`/projects/${ctx.project.id}/revision-requests`, { comment_ids: [comment.id] });
  await settled(item => item.id === request.task.id, 'report revision');
  const revised = await eventually('Research Report r2', async () => (await deliverables()).find(item => item.name === 'Research Report' && item.revisions.length >= 2), 60_000);
  const second = revised.revisions.find((revision: any) => revision.revision === 2);
  expect(second.supersedes_revision_id).toBe(first.id);
  expect((await ctx.api.blob(second.blob_sha256)).text).toContain('[S2]');
  await ctx.api.post(`/revisions/${second.id}/decisions`, { decision: 'accepted' });
  await ctx.api.post(`/deliverables/${revised.id}/final`, { revision_id: second.id });
  const record = await ctx.api.post(`/projects/${ctx.project.id}/exports`, {});
  const directory = mkdtempSync(join(tmpdir(), 'studio-research-'));
  try {
    writeFileSync(join(directory, 'export.zip'), (await ctx.api.blob(record.blob_sha256)).body);
    const entries = execFileSync('unzip', ['-Z1', join(directory, 'export.zip')], { encoding: 'utf8' }).trim().split('\n');
    expect(entries).toContain('manifest.json');
    expect(entries.some(entry => entry.endsWith('.md'))).toBe(true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
