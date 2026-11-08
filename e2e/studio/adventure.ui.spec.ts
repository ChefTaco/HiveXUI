// The adventure acceptance scenario in the browser: the console's Studio section, the
// fullscreen Studio page and every area, driven as an operator would, against the real stack.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { shot, signInPage } from './support/browser';
import { StudioApi, eventually, signIn, stack, stackAvailable } from './support/stack';

test.describe.configure({ mode: 'serial' });
test.skip(!stackAvailable(), 'The Studio end-to-end stack is not running (Docker unavailable or not started)');

let context: BrowserContext;
let page: Page;
let api: StudioApi;
const run = Date.now().toString(36).slice(-5);
const projectName = `Emberfall One-Shot ${run}`;
const mapper = `cartog${run}`;
let projectId = '';

function tinyPng(): Buffer {
  const crc = (buffer: Buffer) => { let c = ~0; for (const byte of buffer) { c ^= byte; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type: string, data: Buffer) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([length, body, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(64, 0); header.writeUInt32BE(64, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.concat(Array.from({ length: 64 }, (_, y) => Buffer.concat([Buffer.from([0]), Buffer.alloc(64 * 3, y * 3)])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** Drag a rectangle across an element, in fractions of its box. */
async function drag(target: ReturnType<Page['locator']>, from: [number, number], to: [number, number]): Promise<void> {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * (from[0] + to[0]) / 2, box.y + box.height * (from[1] + to[1]) / 2, { steps: 5 });
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 5 });
  await page.mouse.up();
}

const transcript = () => page.getByRole('list', { name: 'Messages' });
const roomMessage = (text: string | RegExp) => transcript().locator('li[data-message]').filter({ hasText: text });

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true, acceptDownloads: true });
  page = await context.newPage();
  api = new StudioApi(await signIn('hivexui-ardentstudio'));
});
test.afterAll(async () => { await context?.close(); });

test('console: the Studio section opens the fullscreen page and ✕ returns to the console', async () => {
  await signInPage(page, '/');
  const nav = page.getByRole('navigation', { name: 'Products' });
  await nav.getByRole('button', { name: 'Studio', exact: true }).click();
  await shot(page, '01-console-studio-section');
  await nav.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page).toHaveURL(/\/studio$/);
  await expect(page.getByRole('navigation', { name: 'Products' })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Connected' })).toBeVisible();
  await shot(page, '02-studio-home');
  await page.getByRole('button', { name: 'Close Studio' }).click();
  await expect(page).not.toHaveURL(/\/studio/);
  await expect(page.getByRole('navigation', { name: 'Products' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/studio$/);
});

test('1. create the project: brief, deliverables and two references indexed', async () => {
  await page.getByRole('link', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill(projectName);
  await page.getByLabel('Brief').fill('A short hopeful one-shot along the ember road, for four players.');
  await page.getByLabel('Audience').fill('Tabletop group');
  await page.getByLabel('Tags').fill('adventure, one-shot');
  for (const [index, name, kind, formats] of [[1, 'Adventure Text', 'document', ['.docx', '.pdf']], [2, 'Region Map', 'map', ['.svg']]] as const) {
    await page.getByRole('button', { name: 'Add deliverable' }).click();
    await page.getByLabel(`Deliverable ${index} name`).fill(name);
    const row = page.getByLabel(`Deliverable ${index} name`).locator('xpath=ancestor::*[.//button[starts-with(@aria-label,"Remove deliverable")]][1]');
    await row.getByLabel('Kind').fill(kind);
    // New deliverables start as Markdown; these two are not.
    await row.getByRole('button', { name: '.md', exact: true }).click();
    for (const format of formats) {
      const toggle = row.getByRole('button', { name: format, exact: true });
      if (await toggle.count() === 0) await row.getByRole('button', { name: 'More formats' }).click();
      await row.getByRole('button', { name: format, exact: true }).click();
    }
  }
  await shot(page, '03-create-brief');
  await page.getByRole('button', { name: 'Create and continue' }).click();
  await expect(page).toHaveURL(/step=2/);
  projectId = new URL(page.url()).searchParams.get('project')!;
  await page.getByLabel('Reference files').setInputFiles([
    { name: 'style-guide.md', mimeType: 'text/markdown', buffer: Buffer.from('# Style guide\n\nWarm light against ash. Names are short and old.\n') },
    { name: 'sample-map.png', mimeType: 'image/png', buffer: tinyPng() },
  ]);
  const references = page.getByRole('list', { name: 'References' });
  await expect(references.getByText('style-guide.md')).toBeVisible();
  await eventually('references indexed', async () => {
    const files = (await api.get(`/projects/${projectId}/files`)).files as any[];
    return files.length === 2 && files.every(file => ['indexed', 'unsupported'].includes(file.knowledge.state));
  }, 90_000);
  await page.reload();
  await expect(page.getByRole('list', { name: 'References' }).getByText(/indexed/i).first()).toBeVisible();
  await shot(page, '04-create-references-indexed');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: /From a template/ }).check({ force: true });
  await page.getByRole('radiogroup', { name: 'Team template' }).getByRole('radio', { name: /^Adventure Studio(?! \(short)/ }).check({ force: true });
  await shot(page, '05-create-starting-team');
  await page.getByRole('button', { name: 'Open Team Assignment' }).click();
  await expect(page).toHaveURL(new RegExp(`/studio/p/${projectId}/team`));
});

test('2. team: customize roles, bind two agents, New Agent for the Cartographer, publish and save the variant', async () => {
  await expect(page.getByRole('heading', { name: 'Team Assignment' })).toBeVisible();
  await shot(page, '06-team-designer-canvas');
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Table' }).click();
  for (const name of ['Encounter Designer', 'Continuity Editor', 'Layout Editor']) {
    await page.getByRole('button', { name: `Delete ${name}` }).click();
    // A role without work is removed at once; one with work asks first.
    const confirm = page.getByRole('alertdialog').getByRole('button', { name: 'Delete role' });
    if (await confirm.isVisible({ timeout: 1000 }).catch(() => false)) await confirm.click();
    await expect(page.getByRole('button', { name: `Delete ${name}` })).toHaveCount(0);
  }
  await page.getByLabel('Deliverables of Worldbuilder, comma separated').fill('Adventure Text');
  await page.getByLabel('Deliverables of Worldbuilder, comma separated').blur();
  await page.getByLabel('Deliverables of Cartographer, comma separated').fill('Region Map');
  await page.getByLabel('Deliverables of Cartographer, comma separated').blur();
  const [first, second] = stack().agents;
  for (const [role, agent] of [['Story Lead', first!.profile], ['Worldbuilder', second!.profile]] as const) {
    await page.getByRole('button', { name: `Choose the agent for ${role}` }).click();
    const picker = page.getByRole('dialog', { name: `Agent for ${role}` });
    await picker.getByRole('button', { name: `Bind ${agent}` }).click();
    await expect(picker).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Choose the agent for Cartographer' }).click();
  await page.getByRole('dialog', { name: 'Agent for Cartographer' }).getByRole('button', { name: 'New agent' }).click();
  const wizard = page.getByRole('dialog', { name: 'New agent for Cartographer' });
  await wizard.locator('label.agent-wizard-choice').first().click();
  await wizard.getByLabel('Profile ID').fill(mapper);
  await wizard.getByRole('button', { name: 'Next' }).click();
  await wizard.getByRole('textbox', { name: 'SOUL.md' }).fill('# Cartographer\nDraws clear, readable maps.');
  await wizard.getByRole('textbox', { name: 'IDENTITY.md' }).fill('# Cartographer\nAn Ardent agent that draws region maps for adventures.');
  await wizard.getByRole('button', { name: 'Next' }).click();
  await wizard.getByText('llama.cpp server').click();
  await wizard.getByPlaceholder('http://192.0.2.20:8080/v1').fill('http://model:8080');
  await wizard.getByPlaceholder('model name').fill('studio-fixture');
  await wizard.getByRole('button', { name: 'Next' }).click();
  await shot(page, '07-new-agent-review');
  await wizard.getByRole('button', { name: 'Deploy' }).click();
  await expect(wizard.getByText('The agent is running with its identity, model and HiveMem memory.')).toBeVisible({ timeout: 240_000 });
  await shot(page, '08-new-agent-deployed');
  await wizard.getByRole('button', { name: 'Bind to Cartographer' }).click();
  await expect(wizard).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: mapper })).toBeVisible();
  await shot(page, '09-team-table-bound');
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Current r1/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Save as template' }).click();
  const save = page.getByRole('dialog', { name: 'Save team as template' });
  await save.getByLabel('Template name').fill(`Adventure Studio (short) ${run}`);
  await save.getByLabel('Changelog').fill('Three roles for one-shots');
  await save.getByRole('button', { name: /Save template/ }).click();
  await expect(page.getByText(`Saved Adventure Studio (short) ${run}`)).toBeVisible();
  const team = await api.get(`/projects/${projectId}/team`);
  expect(team.current.revision).toBe(1);
  expect(team.current.body.roles.map((role: any) => role.key).sort()).toEqual(['cartographer', 'story_lead', 'worldbuilder']);
  await page.getByRole('link', { name: 'Start in Room' }).click();
  await expect(page).toHaveURL(new RegExp(`/studio/p/${projectId}/room`));
});

test('3-4. room: a streamed reply, a clarification answered, a pinned decision and a task from a message', async () => {
  await expect(page.getByRole('main', { name: 'Conversation Room' })).toBeVisible();
  await expect(page.locator('.room-live')).toHaveText(/Live/);
  await shot(page, '10-room-idle');
  const composer = page.getByRole('form', { name: 'Write a message' });
  await composer.getByLabel('Message').fill('@worldbuilder propose three region names');
  await composer.getByRole('button', { name: 'Send' }).click();
  const streaming = transcript().locator('li[data-message][data-state="streaming"]');
  await expect(streaming.first()).toBeVisible({ timeout: 60_000 });
  await expect(streaming.first().locator('.room-msg__text--live')).toContainText(/\w+/, { timeout: 60_000 });
  await shot(page, '11-room-streaming-reply');
  await expect(roomMessage('Ashen Fen').last()).not.toHaveAttribute('data-state', 'streaming', { timeout: 60_000 });
  await expect(roomMessage('a still lake that shines at night').first()).toBeVisible();
  await shot(page, '12-room-reply-stored');

  await composer.getByLabel('Message').fill('Outline the adventure');
  await composer.getByRole('button', { name: 'Send' }).click();
  const answer = page.getByRole('form', { name: 'Answer the question' });
  await expect(answer).toBeVisible({ timeout: 60_000 });
  await shot(page, '13-room-clarification');
  await answer.getByRole('radio', { name: 'Hopeful adventure' }).click();
  await answer.getByRole('button', { name: 'Send answer' }).click();
  const proposal = roomMessage('Three acts: the Ember Road');
  await expect(proposal.first()).toBeVisible({ timeout: 60_000 });
  await proposal.first().getByRole('button', { name: 'Pin as decision' }).click();
  const pin = page.getByRole('dialog', { name: 'Pin a decision' });
  await pin.getByRole('button', { name: 'Pin decision' }).click();
  await expect(page.getByText(/Pinned “/)).toBeVisible();
  await expect(roomMessage(/Handed off to Worldbuilder/).first()).toBeVisible({ timeout: 60_000 });
  await expect(roomMessage(/no delegates_to or hands_off_to relationship/).first()).toBeVisible({ timeout: 120_000 });
  await expect(roomMessage(/Delivered Adventure Text/).first()).toBeVisible({ timeout: 120_000 });
  await shot(page, '14-room-decision-handoff-delivery');

  await proposal.first().hover();
  await proposal.first().getByRole('button', { name: 'Create task' }).click();
  const form = page.getByRole('dialog', { name: 'Create a task' });
  await form.getByLabel('Title').fill('Draw the region map');
  await form.getByLabel('Role').selectOption({ label: 'Cartographer' });
  await form.getByLabel('Instructions').fill('Show Ashen Fen, Cinderwatch Heights and Glowmere.');
  await form.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByText('Task created: Draw the region map.')).toBeVisible();
  await expect(roomMessage(/Delivered Region Map/).first()).toBeVisible({ timeout: 120_000 });
  await page.getByRole('button', { name: /^Decisions, / }).click();
  await expect(page.getByRole('dialog', { name: 'Decisions' }).getByText('Adventure outline')).toBeVisible();
  await shot(page, '15-room-decisions-drawer');
  await page.getByRole('dialog', { name: 'Decisions' }).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: /^Tasks, / }).click();
  await expect(page.getByRole('dialog', { name: 'Tasks' }).getByText('Draw the region map')).toBeVisible();
  await shot(page, '16-room-tasks-drawer');
  await page.getByRole('dialog', { name: 'Tasks' }).getByRole('button', { name: 'Close' }).click();
});

test('5. Agent Studio from the room: Development, a streaming Preview, and back to the room', async () => {
  const ref = `${stack().node.id}~${mapper}`;
  await page.goto(`${stack().origin}/studio/p/${projectId}/agents/${encodeURIComponent(ref)}?from=room`);
  await expect(page.getByRole('tablist', { name: 'Agent Studio sections' })).toBeVisible();
  await page.getByRole('tab', { name: 'Development' }).click();
  await shot(page, '17-agent-studio-development');
  await page.getByRole('tab', { name: 'Preview' }).click();
  await page.getByLabel('Message to preview').fill('Describe the map you would draw for Ashen Fen.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(/Finished/).first()).toBeVisible({ timeout: 120_000 });
  await shot(page, '18-agent-studio-preview');
  const identity = await api.get(`/agents/${encodeURIComponent(ref)}/draft`).catch(() => null);
  expect(identity).not.toBeNull();
  await page.getByRole('link', { name: 'Back to the room' }).click();
  await expect(page).toHaveURL(new RegExp(`/studio/p/${projectId}/room`));
});

test('6. a poster over 2 MiB, review comments on the map and the PDF, revision requests, compare, accept, final and export', async () => {
  const composer = page.getByRole('form', { name: 'Write a message' });
  await composer.getByLabel('Message').fill('@cartographer make a print poster of the map');
  await composer.getByRole('button', { name: 'Send' }).click();
  await expect(roomMessage(/Delivered map-poster\.png/).first()).toBeVisible({ timeout: 180_000 });
  await shot(page, '19-room-deliveries');

  await page.goto(`${stack().origin}/studio/p/${projectId}/review`);
  const list = page.getByRole('complementary', { name: 'Deliverables' });
  await list.getByRole('button', { name: /^Region Map/ }).click();
  const region = page.getByRole('application', { name: /Draw a region on .* to comment on it/ });
  await expect(region).toBeVisible();
  await drag(region, [0.45, 0.62], [0.62, 0.75]);
  await page.getByLabel('Comment', { exact: true }).fill('Add a ford across the swamp.');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Comments on this revision' }).getByText('Add a ford across the swamp.')).toBeVisible();
  await shot(page, '20-review-map-comment');
  await page.getByRole('checkbox', { name: /^Include in a revision request/ }).first().check();
  await page.getByRole('button', { name: /^Request revision/ }).click();
  await page.getByRole('dialog', { name: 'Request revision' }).getByRole('button', { name: 'Send revision task' }).click();
  await expect(page.getByText(/Revision task created/)).toBeVisible();

  await list.getByRole('button', { name: /^Adventure Text/ }).click();
  await page.getByRole('group', { name: 'Comment on' }).getByRole('button', { name: 'Mark a region' }).click();
  const pdfRegion = page.getByRole('application', { name: /Draw a region on page 1 to comment on it/ });
  await expect(pdfRegion).toBeVisible({ timeout: 30_000 });
  // The page is taller than the window: mark a region in its visible top part.
  await pdfRegion.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -2000);
  await drag(pdfRegion, [0.1, 0.12], [0.9, 0.2]);
  await expect(page.getByText(/^Page 1 ·/).first()).toBeVisible();
  await page.getByLabel('Comment', { exact: true }).fill('Shorten the finale.');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await shot(page, '21-review-pdf-comment');
  await page.getByRole('checkbox', { name: /^Include in a revision request/ }).first().check();
  await page.getByRole('button', { name: /^Request revision/ }).click();
  await page.getByRole('dialog', { name: 'Request revision' }).getByRole('button', { name: 'Send revision task' }).click();
  await expect(page.getByText(/Revision task created/)).toBeVisible();

  const revised = await eventually('second revisions', async () => {
    const all = (await api.get(`/projects/${projectId}/deliverables`)).deliverables as any[];
    const map = all.find(item => item.name === 'Region Map'); const text = all.find(item => item.name === 'Adventure Text');
    return map?.revisions.length >= 2 && text?.revisions.length >= 2 ? { map, text } : undefined;
  }, 240_000, 2000);
  expect(revised.map.revisions.find((item: any) => item.revision === 2).supersedes_revision_id).toBe(revised.map.revisions.find((item: any) => item.revision === 1).id);

  await page.reload();
  await list.getByRole('button', { name: /^Region Map/ }).click();
  await page.getByLabel('Revision', { exact: true }).selectOption({ label: 'Revision 2' });
  await expect(page.getByText(/→ r2|addressed/i).first()).toBeVisible({ timeout: 30_000 }).catch(() => undefined);
  await page.getByLabel('Compare with').selectOption({ label: 'Compare with revision 1' });
  await page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: 'Swipe' }).click();
  await shot(page, '22-review-map-compare-swipe');
  await page.getByLabel('Compare with').selectOption({ label: 'No comparison' });
  for (const name of ['Region Map', 'Adventure Text']) {
    await list.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    // The comment on revision 1 points at the revision that addressed it; the reviewer resolves it.
    await page.getByLabel('Revision', { exact: true }).selectOption({ label: 'Revision 1' });
    const comments = page.getByRole('list', { name: 'Comments on this revision' });
    await expect(comments.getByRole('button', { name: '→ rev 2' }).first()).toBeVisible();
    if (name === 'Region Map') await shot(page, '22b-review-comment-addressed');
    await comments.getByRole('button', { name: 'Resolve' }).first().click();
    await page.getByLabel('Revision', { exact: true }).selectOption({ label: 'Revision 2' });
    await page.getByRole('group', { name: 'Review decision' }).getByRole('button', { name: 'Accept' }).click();
    await page.getByRole('dialog', { name: 'Accept' }).getByRole('button', { name: 'Accept revision' }).click();
    await expect(page.getByText(/Revision 2: Accepted\./)).toBeVisible();
    await page.getByRole('group', { name: 'Review decision' }).getByRole('button', { name: 'Mark final' }).click();
    await expect(page.getByText(new RegExp(`Revision 2 is the final ${name}`))).toBeVisible();
  }
  const comments = (await Promise.all(((await api.get(`/projects/${projectId}/deliverables`)).deliverables as any[])
    .flatMap(item => item.revisions.map((revision: any) => api.get(`/revisions/${revision.id}/comments`))))).flatMap(item => item.comments);
  expect(comments.map((comment: any) => comment.anchor.kind).sort()).toEqual(['image', 'pdf']);
  expect(comments.every((comment: any) => comment.state === 'resolved' && comment.addressed_in_revision_id)).toBe(true);
  await shot(page, '23-review-accepted-final');
  const download = page.waitForEvent('download');
  await page.getByRole('group', { name: 'Review decision' }).getByRole('button', { name: 'Export package' }).click();
  const file = await download;
  const directory = mkdtempSync(join(tmpdir(), 'studio-ui-export-'));
  try {
    const path = join(directory, 'export.zip');
    await file.saveAs(path);
    const entries = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' }).trim().split('\n');
    expect(entries).toContain('manifest.json');
    expect(entries.some(entry => entry.endsWith('.svg'))).toBe(true);
    expect(entries.some(entry => entry.endsWith('.pdf'))).toBe(true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
  await shot(page, '24-review-exported');
});

test('8. close with ✕, sign out and in, reopen: team, decisions and history are intact', async () => {
  await page.getByRole('button', { name: 'Close Studio' }).click();
  await expect(page).not.toHaveURL(/\/studio/);
  await context.clearCookies();
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
  await signInPage(page, `/studio/p/${projectId}/room`);
  await expect(page.getByRole('main', { name: 'Conversation Room' })).toBeVisible();
  await expect(roomMessage('Outline the adventure').first()).toBeVisible();
  await page.getByRole('button', { name: /^Decisions, / }).click();
  await expect(page.getByRole('dialog', { name: 'Decisions' }).getByText('Adventure outline')).toBeVisible();
  await page.getByRole('dialog', { name: 'Decisions' }).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('link', { name: 'Team' }).click();
  await expect(page.getByText(/Current r1/).first()).toBeVisible();
  await shot(page, '25-reopened-team');
});

test('reconnect: the room shows the dropped stream and catches up after it returns', async () => {
  await page.goto(`${stack().origin}/studio/p/${projectId}/room`);
  await expect(page.locator('.room-live')).toHaveText(/Live/);
  // Kill the stream where a network would: the console ingress goes away and comes back.
  const ingress = `${stack().project ?? 'studio-e2e'}-ingress-1`;
  execFileSync('docker', ['stop', '-t', '1', ingress]);
  try {
    await expect(page.locator('.room-live')).toHaveText(/Reconnecting|Offline|Connecting/, { timeout: 60_000 });
    await shot(page, '26-room-reconnecting');
  } finally { execFileSync('docker', ['start', ingress]); }
  await eventually('ingress back', async () => (await api.get('/health/live').catch(() => null)) !== null, 60_000);
  const team = (await api.get(`/projects/${projectId}/conversations`)).conversations.find((item: any) => item.kind === 'team');
  await api.post(`/conversations/${team.id}/messages`, { body_md: '@worldbuilder propose three region names, once more' });
  await expect(page.locator('.room-live')).toHaveText(/Live/, { timeout: 90_000 });
  await expect(roomMessage('once more').first()).toBeVisible({ timeout: 60_000 });
  await expect(transcript().locator('li[data-message]').last()).toContainText('a still lake', { timeout: 60_000 });
  await shot(page, '27-room-caught-up');
});
