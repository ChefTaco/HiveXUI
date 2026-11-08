// The research acceptance scenario in the browser: a project from the Research Team, a sourced
// summary, a Fact Checker review task, a comment on the Markdown report's text, a revision,
// acceptance and an export.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { shot, signInPage } from './support/browser';
import { StudioApi, eventually, signIn, stack, stackAvailable } from './support/stack';

test.describe.configure({ mode: 'serial' });
test.skip(!stackAvailable(), 'The Studio end-to-end stack is not running (Docker unavailable or not started)');

let context: BrowserContext;
let page: Page;
let api: StudioApi;
let projectId = '';
const run = Date.now().toString(36).slice(-5);
const roomMessage = (text: string | RegExp) => page.getByRole('list', { name: 'Messages' }).locator('li[data-message]').filter({ hasText: text });

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true, acceptDownloads: true });
  page = await context.newPage();
  api = new StudioApi(await signIn('hivexui-ardentstudio'));
});
test.afterAll(async () => { await context?.close(); });

test('1. a Battery Recycling Brief from the Research Team, bound and published', async () => {
  await signInPage(page, '/studio/new');
  await page.getByLabel('Project name').fill(`Battery Recycling Brief ${run}`);
  await page.getByLabel('Brief').fill('A sourced brief on lithium-ion battery recycling.');
  await page.getByRole('button', { name: 'Add deliverable' }).click();
  await page.getByLabel('Deliverable 1 name').fill('Research Report');
  await page.getByLabel('Kind').fill('report');
  await page.getByRole('button', { name: 'Create and continue' }).click();
  await expect(page).toHaveURL(/step=2/);
  projectId = new URL(page.url()).searchParams.get('project')!;
  await page.getByLabel('Reference files').setInputFiles([{ name: 'scope-notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Scope\n\nCover collection, hydrometallurgy and direct recycling.\n') }]);
  await expect(page.getByRole('list', { name: 'References' }).getByText('scope-notes.md')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: /From a template/ }).check({ force: true });
  await page.getByRole('radiogroup', { name: 'Team template' }).getByRole('radio', { name: /^Research Team/ }).check({ force: true });
  await page.getByRole('button', { name: 'Open Team Assignment' }).click();
  await expect(page.getByRole('heading', { name: 'Team Assignment' })).toBeVisible();
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Table' }).click();
  for (const name of ['Source Scout', 'Analyst', 'Editor']) {
    await page.getByRole('button', { name: `Delete ${name}` }).click();
    const confirm = page.getByRole('alertdialog').getByRole('button', { name: 'Delete role' });
    if (await confirm.isVisible({ timeout: 1000 }).catch(() => false)) await confirm.click();
    await expect(page.getByRole('button', { name: `Delete ${name}` })).toHaveCount(0);
  }
  await page.getByLabel('Deliverables of Lead Researcher, comma separated').fill('Research Report');
  await page.getByLabel('Deliverables of Lead Researcher, comma separated').blur();
  const [lead, checker] = stack().agents;
  for (const [role, agent] of [['Lead Researcher', lead!.profile], ['Fact Checker', checker!.profile]] as const) {
    await page.getByRole('button', { name: `Choose the agent for ${role}` }).click();
    await page.getByRole('dialog', { name: `Agent for ${role}` }).getByRole('button', { name: `Bind ${agent}` }).click();
  }
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Team' }).click();
  await expect(page.getByRole('group', { name: /^Team canvas: 2 roles/ })).toBeVisible();
  await shot(page, '30-research-team-canvas');
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Current r1/).first()).toBeVisible();
  await page.getByRole('link', { name: 'Start in Room' }).click();
  await expect(page.getByRole('main', { name: 'Conversation Room' })).toBeVisible();
});

test('2-3. a sourced summary, the report delivered, and a Fact Checker review task', async () => {
  const composer = page.getByRole('form', { name: 'Write a message' });
  await composer.getByLabel('To').selectOption({ index: 1 });
  await composer.getByLabel('Message').fill('Write a sourced summary of battery recycling.');
  await composer.getByRole('button', { name: 'Send' }).click();
  await expect(roomMessage(/collection limits recycled supply \[S1\]/).first()).toBeVisible({ timeout: 120_000 });
  await expect(roomMessage(/Delivered Research Report/).first()).toBeVisible({ timeout: 120_000 });
  await expect(roomMessage(/Handed off to Fact Checker/).first()).toBeVisible({ timeout: 60_000 });
  await shot(page, '31-research-room-summary');
  const summary = roomMessage(/collection limits recycled supply/).first();
  await summary.hover();
  await summary.getByRole('button', { name: 'Create task' }).click();
  const form = page.getByRole('dialog', { name: 'Create a task' });
  await form.getByLabel('Title').fill('Review the research report claims');
  await form.getByLabel('Role').selectOption({ label: 'Fact Checker' });
  await form.getByLabel('Kind').selectOption({ label: 'Review' });
  await form.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByText('Task created: Review the research report claims.')).toBeVisible();
  await expect(roomMessage(/claims \[S1\] and \[S3\] match their sources/).first()).toBeVisible({ timeout: 120_000 });
  const tasks = (await api.get(`/projects/${projectId}/tasks`)).tasks as any[];
  expect(tasks.find(task => task.title === 'Review the research report claims')?.mode).toBe('review');
  await shot(page, '32-research-room-review');
});

test('4. a comment on the report text, a revision, acceptance and an export', async () => {
  await page.goto(`${stack().origin}/studio/p/${projectId}/review`);
  await page.getByRole('complementary', { name: 'Deliverables' }).getByRole('button', { name: /^Research Report/ }).click();
  const article = page.getByRole('article', { name: /Select text to comment on it/ });
  await expect(article).toContainText('Hydrometallurgical recovery');
  // Select the sentence the way a reviewer drags across it.
  const sentence = article.getByText(/Hydrometallurgical recovery returns most lithium/);
  const box = (await sentence.boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText(/^On:/).locator('..')).toContainText('Hydrometallurgical');
  await page.getByLabel('Comment', { exact: true }).fill('Cite the recovery rates.');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await shot(page, '33-research-review-text-comment');
  await page.getByRole('checkbox', { name: /^Include in a revision request/ }).first().check();
  await page.getByRole('button', { name: /^Request revision/ }).click();
  await page.getByRole('dialog', { name: 'Request revision' }).getByRole('button', { name: 'Send revision task' }).click();
  await expect(page.getByText(/Revision task created/)).toBeVisible();
  await eventually('report r2', async () => ((await api.get(`/projects/${projectId}/deliverables`)).deliverables as any[]).find(item => item.name === 'Research Report')?.revisions.length >= 2, 180_000, 2000);
  await page.reload();
  await page.getByRole('complementary', { name: 'Deliverables' }).getByRole('button', { name: /^Research Report/ }).click();
  await page.getByLabel('Revision', { exact: true }).selectOption({ label: 'Revision 2' });
  await page.getByLabel('Compare with').selectOption({ label: 'Compare with revision 1' });
  await expect(page.getByRole('figure', { name: 'Revision 2' }).getByRole('insertion')).toContainText('Recovery rates depend on the feedstock chemistry [S2].');
  await shot(page, '34-research-review-diff');
  await page.getByLabel('Compare with').selectOption({ label: 'No comparison' });
  await page.getByLabel('Revision', { exact: true }).selectOption({ label: 'Revision 1' });
  const comments = page.getByRole('list', { name: 'Comments on this revision' });
  await expect(comments.getByRole('button', { name: '→ rev 2' })).toBeVisible();
  await comments.getByRole('button', { name: 'Resolve' }).click();
  await page.getByLabel('Revision', { exact: true }).selectOption({ label: 'Revision 2' });
  await page.getByRole('group', { name: 'Review decision' }).getByRole('button', { name: 'Accept' }).click();
  await page.getByRole('dialog', { name: 'Accept' }).getByRole('button', { name: 'Accept revision' }).click();
  await page.getByRole('group', { name: 'Review decision' }).getByRole('button', { name: 'Mark final' }).click();
  await expect(page.getByText(/Revision 2 is the final Research Report/)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('group', { name: 'Review decision' }).getByRole('button', { name: 'Export package' }).click();
  const directory = mkdtempSync(join(tmpdir(), 'studio-research-ui-'));
  try {
    const path = join(directory, 'export.zip');
    await (await download).saveAs(path);
    const entries = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' }).trim().split('\n');
    expect(entries).toContain('manifest.json');
    expect(entries.some(entry => entry.endsWith('.md'))).toBe(true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
  const comment = (await api.get(`/revisions/${((await api.get(`/projects/${projectId}/deliverables`)).deliverables as any[]).find(item => item.name === 'Research Report').revisions.find((revision: any) => revision.revision === 1).id}/comments`)).comments[0];
  expect(comment.anchor).toMatchObject({ kind: 'text', quote: expect.stringContaining('Hydrometallurgical') });
  await shot(page, '35-research-exported');
});
