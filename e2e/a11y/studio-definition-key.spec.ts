// Create agent from definition in the built app, against a mocked ArdentStudio: an Emberpath-alias
// definition asks for the Emberpath client key, sends it to the deploy check and the deploy, maps a refused
// key beside its field and clears it, and the drawer passes axe.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Request } from '@playwright/test';
import { AGENT_TEMPLATE_ID, agentTemplateDetail, builtDefinition, definitionOperation } from '../../src/modules/studio/test-fixtures';
import { FIXED_NOW, installMocks } from './mock-runtime';

/** Obviously fake Emberpath client keys. */
const KEY = 'fixture-emberpath-key-0031';
const KEY_2 = 'fixture-emberpath-key-0032';
const T = '2026-11-08T00:00:00.000Z';
const INSTALLATION = {
  nodeId: 'node-1', nodeName: 'node-1', hostname: 'node-1.example.internal', reachable: true, error: null, installed: true, version: '3.5.1', owner: 'ardent', checkedAt: T,
  capabilities: { studio: 6 }, profiles: [],
};
const BASE = `/api/ardentstudio/v1/templates/${AGENT_TEMPLATE_ID}/versions/1`;
const PASSED = { definition: { name: 'Archivist', sha256: 'b'.repeat(64) }, omitted: [], preflight: { ok: true, problems: [] } };
const REFUSED_KEY = { ...PASSED, preflight: { ok: false, problems: [{ code: 'SECRET_UNBOUND', detail: 'emberpath_client_key: Emberpath refused the client key (403)' }] } };

/** ArdentStudio and Magnus answers for this flow, over the shared mocks. Records what each POST carried. */
async function mockStudio(page: Page, checks: unknown[]): Promise<Array<{ path: string; body: unknown }>> {
  const posts: Array<{ path: string; body: unknown }> = [];
  const queue = [...checks];
  const record = (request: Request) => {
    const text = request.postData();
    posts.push({ path: new URL(request.url()).pathname.replace(BASE, ''), body: text ? JSON.parse(text) as unknown : null });
  };
  await page.route(/\/api\/magnus\/ardent\/installations$/, (route) => route.fulfill({ json: { success: true, data: [INSTALLATION] } }));
  await page.route(new RegExp(`/api/ardentstudio/v1/templates/${AGENT_TEMPLATE_ID}$`), (route) => route.fulfill({ json: agentTemplateDetail() }));
  await page.route(new RegExp(`${BASE}/definition$`), (route) => route.fulfill({ json: builtDefinition() }));
  await page.route(new RegExp(`${BASE}/deploy-check$`), (route) => { record(route.request()); return route.fulfill({ json: queue.shift() ?? PASSED }); });
  await page.route(new RegExp(`${BASE}/deploy$`), (route) => { record(route.request()); return route.fulfill({ status: 201, json: definitionOperation('succeeded') }); });
  return posts;
}

async function scan(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({ rule: violation.id, impact: violation.impact, help: violation.help, targets: violation.nodes.map((node) => node.target.join(' ')).slice(0, 5) }));
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await installMocks(page);
});

test('Create agent from definition asks for the Emberpath key, maps a refused key, sends it and passes axe', async ({ page }) => {
  const posts = await mockStudio(page, [REFUSED_KEY]);
  await page.goto(`/studio/gallery?kind=agents&template=${AGENT_TEMPLATE_ID}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Create agent' }).click();
  const drawer = page.getByRole('dialog', { name: 'Create agent from Archivist' });
  const key = drawer.getByLabel('Emberpath client key');
  await expect(key).toHaveAttribute('type', 'password');
  await expect(key).toHaveAttribute('autocomplete', 'off');
  await expect(drawer.getByText('research-large')).toBeVisible();
  await drawer.getByLabel('Profile ID').fill('archivist');
  await drawer.getByRole('button', { name: 'Create agent' }).click();
  await expect(drawer.getByRole('alert').filter({ hasText: 'Enter the Emberpath client key for this agent' })).toBeVisible();
  expect(await scan(page)).toEqual([]);

  await key.fill(KEY);
  await drawer.getByRole('button', { name: 'Create agent' }).click();
  await expect(drawer.getByRole('alert').filter({ hasText: 'Emberpath refused this key: Emberpath refused the client key (403)' })).toBeVisible();
  await expect(key).toHaveValue('');
  expect(await scan(page)).toEqual([]);

  await key.fill(KEY_2);
  await drawer.getByRole('button', { name: 'Create agent' }).click();
  await expect(drawer.getByText('The agent is running with the definition', { exact: false })).toBeVisible();
  expect(await scan(page)).toEqual([]);
  expect(posts).toEqual([
    { path: '/deploy-check', body: { node_id: 'node-1', bindings: { hivemem: 'default' }, emberpath_client_key: KEY } },
    { path: '/deploy-check', body: { node_id: 'node-1', bindings: { hivemem: 'default' }, emberpath_client_key: KEY_2 } },
    { path: '/deploy', body: { node_id: 'node-1', profile: 'archivist', bindings: { hivemem: 'default' }, emberpath_client_key: KEY_2 } },
  ]);
  expect(await page.content()).not.toMatch(/fixture-emberpath-key-003[12]/u);
});
