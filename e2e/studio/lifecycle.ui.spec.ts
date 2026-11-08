// An Ardent agent's fleet lifecycle against the real stack: New Agent in the Magnus console, enrolled
// in HiveMem by Magnus's own Oathweave service identity (Magnus holds no HiveMem token); a HiveSkills
// catalog skill installed from Agent Studio; a model change applied from Agent Studio's draft; and the
// HiveMem credential renewed by Magnus's renewal job, reloaded on the running gateway and shown in the
// console. The stack issues one-hour credentials; the spec makes this one due and restarts Magnus,
// whose renewal job runs at start, instead of waiting half an hour.
import { execFileSync } from 'node:child_process';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { shot, signInPage } from './support/browser';
import { call, container, eventually, signIn, stack, stackAvailable } from './support/stack';

test.describe.configure({ mode: 'serial' });
test.skip(!stackAvailable(), 'The Studio end-to-end stack is not running (Docker unavailable or not started)');

let context: BrowserContext;
let page: Page;
let magnusToken = '';
const run = Date.now().toString(36).slice(-5);
const profile = `scribe${run}`;
const ref = () => `${stack().node.id}~${profile}`;
const ALTERNATE_MODEL = 'studio-fixture-large';

/**
 * Magnus through the console ingress, as the signed-in operator (an ADMIN). The operator shares Magnus's
 * per-person Ardent budget (60 requests a minute) with the console pages this spec drives faster than a
 * person would, so a 429 waits for the window to move on.
 */
async function magnus(path: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
  const send = () => call(`${stack().origin}/api/magnus${path}`, { method: init.method ?? 'GET', headers: { Authorization: `Bearer ${magnusToken}` }, ...(init.body === undefined ? {} : { body: init.body }) });
  let reply = await send();
  for (let attempt = 0; reply.status === 429 && attempt < 20; attempt++) {
    await new Promise(resolveWait => setTimeout(resolveWait, 5000));
    reply = await send();
  }
  if (reply.status >= 400) throw new Error(`Magnus ${init.method ?? 'GET'} ${path} answered ${reply.status}: ${reply.text.slice(0, 400)}`);
  return reply.json?.data ?? reply.json;
}
const profilePath = () => `/ardent/installations/${encodeURIComponent(stack().node.id)}/profiles/${encodeURIComponent(profile)}`;
const resource = (name: string) => magnus(`${profilePath()}/${name}`);
const action = (name: string, body?: unknown) => magnus(`${profilePath()}/action`, { method: 'POST', body: { action: name, ...(body === undefined ? {} : { body }) } });
async function credential(): Promise<any> {
  const installation = await magnus(`/ardent/installations/${encodeURIComponent(stack().node.id)}`);
  return installation.profiles.find((item: any) => item.id === profile)?.hivemem;
}
async function audit(name: string): Promise<any[]> {
  return ((await magnus(`/audit?action=${encodeURIComponent(name)}&pageSize=200`)) as any[]).filter(event => event.targetId === `${stack().node.id}:${profile}`);
}
/** HiveMem's audit, read with the stack's own HiveMem admin token (Magnus never holds one). */
async function hivememAudit(): Promise<any[]> {
  const reply = await call(`${stack().origin}/api/hivemem/admin/audit?limit=200`, { headers: { Authorization: `Bearer ${stack().secrets!.hivememAdminToken}` } });
  if (reply.status !== 200) throw new Error(`HiveMem audit answered ${reply.status}: ${reply.text.slice(0, 200)}`);
  return reply.json.events as any[];
}
/** The model fixture's request log, read inside its container (the model is not published). */
function modelLog(): any[] {
  const out = execFileSync('docker', ['exec', container('model'), 'node', '-e',
    "fetch('http://127.0.0.1:8080/fixture/log').then(r => r.text()).then(text => process.stdout.write(text))"], { encoding: 'utf8' });
  return JSON.parse(out) as any[];
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
  page = await context.newPage();
  magnusToken = await signIn('hivexui-magnus');
});
test.afterAll(async () => { await context?.close(); });

test('1. New Agent in the Magnus console enrolls HiveMem as Magnus\'s Oathweave service identity', async () => {
  // Magnus has a HiveMem client and no static HiveMem token.
  const environment = execFileSync('docker', ['exec', container('magnus'), 'printenv'], { encoding: 'utf8' });
  expect(environment).toMatch(/^MAGNUS_ARDENT_HIVEMEM_CLIENT_ID=magnus-hivemem$/m);
  expect(environment).not.toMatch(/^MAGNUS_ARDENT_HIVEMEM_ENROLLMENT_TOKEN=/m);

  await signInPage(page, '/fleet/ardent/profiles');
  await page.getByRole('button', { name: 'New Agent' }).click();
  await page.getByLabel('Profile ID').fill(profile);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('textbox', { name: 'SOUL.md' }).fill('# Scribe\nKeeps careful, dated notes.');
  await page.getByRole('textbox', { name: 'IDENTITY.md' }).fill('# Scribe\nAn Ardent agent that records findings for the team.');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByText('llama.cpp server').click();
  await page.getByPlaceholder('http://192.0.2.20:8080/v1').fill('http://model:8080');
  await page.getByPlaceholder('model name').fill('studio-fixture');
  await page.getByRole('button', { name: 'Next' }).click();
  await shot(page, '4x-01-new-agent-review');
  await page.getByRole('button', { name: 'Deploy' }).click();
  await expect(page.getByText('The agent is running with its identity, model and HiveMem memory.')).toBeVisible({ timeout: 300_000 });
  await shot(page, '4x-02-new-agent-deployed');

  // The credential Magnus recorded: its agent in the workspace Magnus created, due for renewal at half its lifetime.
  const recorded = await eventually('the recorded credential', async () => credential(), 60_000);
  expect(recorded).toMatchObject({ workspaceId: 'ardent-agents', state: 'ok', failures: 0, lastRenewedAt: null });
  const lifetime = Date.parse(recorded.expiresAt) - Date.now();
  expect(lifetime).toBeGreaterThan(0);
  expect(lifetime).toBeLessThanOrEqual((stack().credentialHours ?? 1) * 3_600_000);
  const memory = await eventually('HiveMem ready on the agent', async () => { const status = await resource('memory/status'); return status?.status === 'ready' ? status : null; }, 120_000);
  expect(memory.status).toBe('ready');
  // HiveMem's own audit: Magnus's service principal created the workspace and enrolled the agent.
  const enrolled = (await hivememAudit()).find(event => event.kind === 'actor-credential.enroll' && event.agent_id === recorded.agentId);
  expect(enrolled).toMatchObject({ actor: 'magnus-ardent', workspace_id: 'ardent-agents' });
});

test('2. Agent Studio installs the HiveSkills catalog skill onto the agent', async () => {
  const skill = stack().skill!;
  expect(skill?.slug).toBeTruthy();
  await page.goto(`${stack().origin}/studio/agents/${encodeURIComponent(ref())}?tab=capabilities`);
  await expect(page.getByRole('tablist', { name: 'Agent Studio sections' })).toBeVisible();
  const catalog = page.getByRole('region', { name: 'HiveSkills catalog' });
  await expect(catalog).toBeVisible({ timeout: 60_000 });
  await catalog.getByRole('searchbox', { name: 'Search the HiveSkills catalog' }).fill('field');
  const entry = catalog.getByRole('list', { name: 'Catalog skills' }).getByRole('listitem').filter({ hasText: skill.slug });
  await entry.getByRole('button', { name: 'Choose' }).click();
  await expect(catalog.getByText(`Release ${skill.version}`, { exact: false })).toBeVisible();
  await shot(page, '4x-03-skill-catalog-chosen');
  await catalog.getByRole('button', { name: 'Install' }).click();
  const outcome = catalog.getByRole('status').filter({ hasText: new RegExp(`${skill.slug} ${skill.version}`) });
  await expect(outcome).toBeVisible({ timeout: 120_000 });
  await shot(page, '4x-04-skill-installed');
  await expect(outcome).toHaveText(new RegExp(`Installed ${skill.slug} ${skill.version} and enabled\\.`));

  const audited = await eventually('the skill-install audit', async () => (await audit('ardent.skill-install')).find(event => event.details?.sha256 === skill.sha256 || JSON.stringify(event).includes(skill.slug)), 30_000);
  expect(JSON.stringify(audited)).toContain(skill.version);
  const config = await resource('config');
  expect(config.text).toContain(skill.slug);
  // Ardent lists the running profile, which loads the skill at its next restart: the console says so.
  expect((await resource('skills')).skills.find((item: any) => item.name === skill.slug)?.enabled).toBe(false);
  await expect(page.getByText('Enabled — applies after restart')).toBeVisible({ timeout: 30_000 });
});

test('3. Agent Studio applies a model change from its draft', async () => {
  await page.goto(`${stack().origin}/studio/agents/${encodeURIComponent(ref())}?tab=preview`);
  const draft = page.locator('.agent-draft');
  await expect(draft).toBeVisible({ timeout: 60_000 });
  // The draft starts from the saved configuration, so the skill enabled before a restart is on.
  await expect(draft.locator('label.toggle', { hasText: stack().skill!.slug }).locator('input')).toBeChecked();
  await draft.getByRole('textbox', { name: 'Model' }).fill(ALTERNATE_MODEL);
  await shot(page, '4x-05-apply-model-draft');
  await draft.getByRole('button', { name: 'Apply', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: /^Apply Model\?/ });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Apply', exact: true }).click();
  const results = page.getByRole('status', { name: 'Apply results' });
  await expect(results).toBeVisible({ timeout: 60_000 });
  await expect(results.locator('li').filter({ hasText: 'Model' }).getByText('Applied', { exact: true })).toBeVisible();
  await results.scrollIntoViewIfNeeded();
  await shot(page, '4x-06-apply-model-results');

  const config = await resource('config');
  expect(config.text).toContain(ALTERNATE_MODEL);
  // The model takes effect when the profile restarts; the agent's next request carries it.
  await action('service-restart');
  await eventually('the profile back after the restart', async () => (await resource('memory/status').catch(() => null))?.status === 'ready', 120_000);
  expect((await resource('skills')).skills.find((item: any) => item.name === stack().skill!.slug)?.enabled).toBe(true);
  const before = modelLog().length;
  const preview = await magnus(`${profilePath()}/action`, { method: 'POST', body: { action: 'preview-submit', body: { prompt: 'Say hello in one line.' } } }).catch((error: Error) => ({ error: error.message }));
  expect(preview.error ?? null).toBeNull();
  const used = await eventually('a model request after the restart', async () => modelLog().slice(before).find(entry => entry.model), 120_000);
  expect(used.model).toBe(ALTERNATE_MODEL);
});

test('4. Magnus renews the HiveMem credential, reloads it on the gateway, and the console shows it', async () => {
  const before = await credential();
  expect(before?.state).toBe('ok');
  // Due now instead of at half the lifetime; the renewal job runs when Magnus starts.
  execFileSync('docker', ['exec', container('magnus-postgres'), 'psql', '-U', 'magnus', '-d', 'magnus', '-v', 'ON_ERROR_STOP=1', '-c',
    `UPDATE ardent_hivemem_credentials SET "nextAttemptAt" = now() - interval '1 minute' WHERE "nodeId" = '${stack().node.id}' AND profile = '${profile}'`]);
  execFileSync('docker', ['restart', '-t', '10', container('magnus')]);
  await eventually('Magnus back after its restart', async () => (await call(`${stack().origin}/api/magnus/health/ready`)).status === 200, 180_000, 2000);

  const renewed = await eventually('the renewed credential', async () => {
    const current = await credential().catch(() => null);
    return current?.lastRenewedAt ? current : null;
  }, 180_000, 2000);
  expect(renewed.state).toBe('ok');
  expect(renewed.failures).toBe(0);
  expect(renewed.lastError).toBeNull();
  expect(Date.parse(renewed.expiresAt)).toBeGreaterThan(Date.parse(before.expiresAt));
  expect(renewed.agentId).toBe(before.agentId);
  const event = (await audit('ardent.hivemem.renew')).find(item => item.details?.status === 'succeeded');
  expect(event?.details).toMatchObject({ status: 'succeeded', activation: 'reloaded', agentId: before.agentId });
  expect(event.details.warning).toBeUndefined();
  const memory = await resource('memory/status');
  expect(memory.status).toBe('ready');
  const renewal = (await hivememAudit()).find(event => event.kind === 'actor-credential.renew' && event.agent_id === before.agentId);
  expect(renewal).toMatchObject({ actor: 'magnus-ardent', workspace_id: 'ardent-agents' });

  // Agent Studio's header badge and the Magnus profile page show the renewed credential.
  await page.goto(`${stack().origin}/studio/agents/${encodeURIComponent(ref())}`);
  await expect(page.getByText(/^HiveMem credential: /)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('HiveMem ready')).toBeVisible();
  await shot(page, '4x-07-agent-studio-credential-badge');
  await page.goto(`${stack().origin}/fleet/ardent/profiles/${encodeURIComponent(ref())}`);
  const panel = page.locator('[data-hivemem-credential]');
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByText('Last renewed')).toBeVisible();
  await expect(panel.locator('time').nth(1)).toHaveText(/ago|less than a minute/);
  await panel.scrollIntoViewIfNeeded();
  await shot(page, '4x-08-profile-credential-renewed');
});
