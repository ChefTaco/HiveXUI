// The Emberpath client key in the built app, against a mocked Magnus: New Agent asks for it only for an
// Emberpath alias and maps Magnus's refusals, resume asks for it again on EMBERPATH_KEY_REQUIRED, an
// existing agent's page sets it, and each of these passes axe.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Request } from '@playwright/test';
import { FIXED_NOW, installMocks } from './mock-runtime';

/** Obviously fake Emberpath client keys. */
const KEY = 'fixture-emberpath-key-0005';
const KEY_2 = 'fixture-emberpath-key-0006';
const T = '2026-11-08T00:00:00.000Z';
const INSTALLATION = {
  nodeId: 'node-1', nodeName: 'node-1', hostname: 'node-1.example.internal', reachable: true, error: null, installed: true, version: '3.5.1', owner: 'ardent', checkedAt: T,
  capabilities: { studio: 6 }, profiles: [{ id: 'lead', name: 'lead', backend: 'llamacpp', apiPort: 9910, running: true, a2aEnabled: true, channels: { web: true }, error: null }],
};
const DEPLOY = ['profile-create', 'service-start', 'identity-soul', 'identity-identity', 'hivemem-enroll', 'config-save', 'skill-set', 'service-restart', 'ready-probe'];
const MODEL_CREDENTIAL = ['profile-check', 'config-save', 'service-restart', 'ready-probe'];
function operation(kind: 'deploy' | 'model-credential', status: 'succeeded' | 'failed', profile: string) {
  const names = kind === 'deploy' ? DEPLOY : MODEL_CREDENTIAL;
  const failedAt = status === 'failed' ? names.indexOf('config-save') : names.length;
  return {
    id: 'op-1', kind, nodeId: 'node-1', profile, status, createdBy: 'usr_admin', attempts: 1, error: status === 'failed' ? 'config-save: Emberpath key missing' : null,
    steps: names.map((name, index) => ({ name, startedAt: null, finishedAt: null, receipt: index < failedAt ? {} : null, error: index === failedAt ? 'Emberpath key missing' : null,
      status: index < failedAt ? 'succeeded' : index === failedAt ? 'failed' : 'pending' })),
    request: { apiPort: kind === 'deploy' ? 9911 : null, model: { emberpath_alias: 'general' }, skills: [], hivemem: true, artifacts_max_bytes: null },
    createdAt: T, updatedAt: T, completedAt: T,
  };
}
const stream = (data: unknown) => `event: operation\ndata: ${JSON.stringify(data)}\n\nevent: done\ndata: ${JSON.stringify(data)}\n\n`;

interface Plan {
  deploy?: Array<{ status: number; code?: string }>;
  resume?: Array<{ status: number; code?: string }>;
  set?: Array<{ status: number; code?: string }>;
  streams?: unknown[];
}
/** Magnus answers for the routes these flows call, over the shared mocks. Records what each POST carried. */
async function mockMagnus(page: Page, plan: Plan): Promise<Array<{ path: string; body: unknown }>> {
  const posts: Array<{ path: string; body: unknown }> = [];
  const streams = [...(plan.streams ?? [])];
  const answer = (queue: Array<{ status: number; code?: string }> | undefined) => {
    const next = queue?.shift() ?? { status: 202 };
    return next.code ? { status: next.status, json: { success: false, error: { code: next.code, message: next.code } } } : { status: 202, json: { success: true, data: { operationId: 'op-1' } } };
  };
  const record = (request: Request) => {
    const text = request.postData();
    posts.push({ path: new URL(request.url()).pathname.replace(/^\/api\/magnus/, ''), body: text ? JSON.parse(text) as unknown : null });
  };
  await page.route(/\/api\/magnus\/ardent\/installations$/, (route) => route.fulfill({ json: { success: true, data: [INSTALLATION] } }));
  await page.route(/\/api\/magnus\/ardent\/installations\/node-1$/, (route) => route.fulfill({ json: { success: true, data: INSTALLATION } }));
  await page.route(/\/api\/magnus\/ardent\/installations\/node-1\/profiles\/lead\/memory\/status$/, (route) =>
    route.fulfill({ json: { success: true, data: { status: 'ready', agent_id: 'ardent-lead', workspace_id: 'ardent-agents', retrieval: 'hybrid', storage: 'sqlite', reason: null } } }));
  await page.route(/\/api\/magnus\/ardent\/installations\/node-1\/profiles\/lead\/status$/, (route) => route.fulfill({ json: { success: true, data: { backend: 'llamacpp', version: '3.5.1' } } }));
  await page.route(/\/api\/magnus\/ardent\/agents$/, (route) => { record(route.request()); return route.fulfill(answer(plan.deploy)); });
  await page.route(/\/api\/magnus\/ardent\/agents\/operations\/op-1\/resume$/, (route) => { record(route.request()); return route.fulfill(answer(plan.resume)); });
  await page.route(/\/api\/magnus\/ardent\/installations\/node-1\/profiles\/lead\/model-credential$/, (route) => { record(route.request()); return route.fulfill(answer(plan.set)); });
  await page.route(/\/api\/magnus\/ardent\/agents\/operations\/op-1\/stream$/, (route) =>
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: stream(streams.shift()) }));
  return posts;
}

async function scan(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({ rule: violation.id, impact: violation.impact, help: violation.help, targets: violation.nodes.map((node) => node.target.join(' ')).slice(0, 5) }));
}
const keyField = (page: Page) => page.getByLabel('Emberpath client key');

/** Open New Agent and fill it up to the Model step. */
async function toModelStep(page: Page) {
  await page.goto('/fleet/ardent/profiles', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New Agent' }).click();
  await page.getByLabel('Profile ID').fill('scout');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('[aria-current="step"]')).toContainText('Model');
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await installMocks(page);
});

test('New Agent asks for the Emberpath key only for an alias, requires it, and passes axe', async ({ page }) => {
  const posts = await mockMagnus(page, { streams: [operation('deploy', 'succeeded', 'scout')] });
  await toModelStep(page);
  await expect(keyField(page)).toHaveAttribute('type', 'password');
  await expect(keyField(page)).toHaveAttribute('autocomplete', 'off');
  await expect(page.getByText('Emberpath → API Keys', { exact: false })).toBeVisible();
  const issue = page.getByRole('link', { name: /Issue a key in Emberpath/ });
  await expect(issue).toHaveAttribute('href', '/?page=keys&issue=ardent-scout');
  await expect(issue).toHaveAttribute('target', '_blank');
  await page.getByRole('radio', { name: /^llama\.cpp server/ }).check();
  await expect(keyField(page)).toHaveCount(0);
  await page.getByRole('radio', { name: /^Emberpath alias/ }).check();
  await page.getByRole('textbox', { name: 'Emberpath alias' }).fill('general');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Enter the Emberpath client key for this agent' })).toBeVisible();
  expect(await scan(page)).toEqual([]);
  await keyField(page).fill(KEY);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Deploy' }).click();
  await expect(page.getByText('The agent is running with its identity, model and HiveMem memory.')).toBeVisible();
  expect(posts).toEqual([{ path: '/ardent/agents', body: expect.objectContaining({ model: { emberpath_alias: 'general' }, emberpath_client_key: KEY }) }]);
  expect(await page.content()).not.toContain(KEY);
});

test('New Agent shows a refused key beside its field, and resume asks for the key again', async ({ page }) => {
  const posts = await mockMagnus(page, {
    deploy: [{ status: 422, code: 'EMBERPATH_KEY_INVALID' }],
    resume: [{ status: 409, code: 'EMBERPATH_KEY_REQUIRED' }],
    streams: [operation('deploy', 'failed', 'scout'), operation('deploy', 'succeeded', 'scout')],
  });
  await toModelStep(page);
  await page.getByRole('textbox', { name: 'Emberpath alias' }).fill('general');
  await keyField(page).fill(KEY);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Deploy' }).click();
  await expect(page.locator('[aria-current="step"]')).toContainText('Model');
  await expect(page.getByRole('alert').filter({ hasText: 'Emberpath refused this key' })).toBeVisible();
  await expect(keyField(page)).toHaveValue('');
  expect(await scan(page)).toEqual([]);
  await keyField(page).fill(KEY_2);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Deploy' }).click();
  await expect(page.getByText('Stopped at "Configure model, memory and artifacts".', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByText('Magnus no longer holds the one you entered', { exact: false })).toBeVisible();
  expect(await scan(page)).toEqual([]);
  await keyField(page).fill(KEY_2);
  await page.getByRole('button', { name: 'Resume with key' }).click();
  await expect(page.getByRole('button', { name: 'Open profile' })).toBeVisible();
  expect(posts.map((post) => [post.path, (post.body as { emberpath_client_key?: string } | null)?.emberpath_client_key ?? null])).toEqual([
    ['/ardent/agents', KEY], ['/ardent/agents', KEY_2], ['/ardent/agents/operations/op-1/resume', null], ['/ardent/agents/operations/op-1/resume', KEY_2]]);
  expect(await page.content()).not.toMatch(/fixture-emberpath-key-000[56]/u);
});

test('Set Emberpath key on an existing agent maps refusals, follows the operation and passes axe', async ({ page }) => {
  const posts = await mockMagnus(page, { set: [{ status: 422, code: 'EMBERPATH_KEY_FORBIDDEN' }], streams: [operation('model-credential', 'succeeded', 'lead')] });
  await page.goto('/fleet/ardent/profiles/node-1~lead', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Set Emberpath key' }).click();
  const drawer = page.getByRole('dialog', { name: 'Set Emberpath key' });
  await expect(drawer.getByLabel('Emberpath client key')).toHaveAttribute('type', 'password');
  expect(await scan(page)).toEqual([]);
  await drawer.getByLabel('Emberpath client key').fill(KEY);
  await drawer.getByRole('button', { name: 'Set key' }).click();
  await expect(drawer.getByRole('alert').filter({ hasText: 'models:read and inference:write' })).toBeVisible();
  await expect(drawer.getByLabel('Emberpath client key')).toHaveValue('');
  await drawer.getByLabel('Emberpath client key').fill(KEY_2);
  await drawer.getByRole('button', { name: 'Set key' }).click();
  await expect(drawer.getByText('The agent restarted with its new Emberpath key.')).toBeVisible();
  await expect(drawer.locator('[data-step="config-save"]')).toContainText('Deliver the Emberpath key');
  expect(await scan(page)).toEqual([]);
  expect(posts).toEqual([
    { path: '/ardent/installations/node-1/profiles/lead/model-credential', body: { emberpath_client_key: KEY } },
    { path: '/ardent/installations/node-1/profiles/lead/model-credential', body: { emberpath_client_key: KEY_2 } }]);
  expect(await page.content()).not.toMatch(/fixture-emberpath-key-000[56]/u);
});

test('the Issue key link opens Emberpath\'s Issue key drawer with the suggested name', async ({ page }) => {
  await page.goto('/?page=keys&issue=ardent-scout', { waitUntil: 'networkidle' });
  const drawer = page.getByRole('dialog', { name: 'API key details' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('textbox').first()).toHaveValue('ardent-scout');
  await expect(page).not.toHaveURL(/issue=/);
  expect(await scan(page)).toEqual([]);
});
