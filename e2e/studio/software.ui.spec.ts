// The node software card against the real stack: Magnus's read-only software status
// (GET /nodes/:nodeId/software, Magnus 3.1.0) through the console ingress, first as an API
// read checked against the vendored contract, then from the card on node detail. Neither read
// dispatches a command on the node.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { nodeSoftwareResponseSchema } from '../../contracts/magnus/browser';
import { shot, signInPage } from './support/browser';
import { call, signIn, stack, stackAvailable } from './support/stack';

test.describe.configure({ mode: 'serial' });
test.skip(!stackAvailable(), 'The Studio end-to-end stack is not running (Docker unavailable or not started)');

let token = '';
let context: BrowserContext;
let page: Page;
let agentVersion = '';

async function magnus(path: string): Promise<{ status: number; json: any; text: string }> {
  let reply = await call(`${stack().origin}/api/magnus${path}`, { headers: { Authorization: `Bearer ${token}` } });
  for (let attempt = 0; reply.status === 429 && attempt < 20; attempt++) {
    await new Promise(resolveWait => setTimeout(resolveWait, 5000));
    reply = await call(`${stack().origin}/api/magnus${path}`, { headers: { Authorization: `Bearer ${token}` } });
  }
  return reply;
}
const commandCount = async (): Promise<number> => {
  const reply = await magnus(`/commands?nodeId=${encodeURIComponent(stack().node.id)}&hours=720&pageSize=100`);
  expect(reply.status, reply.text.slice(0, 400)).toBe(200);
  return (reply.json.data as unknown[]).length;
};

test.beforeAll(async () => { token = await signIn('hivexui-magnus'); });
test.afterAll(async () => { await context?.close(); });

test('1. the software status reads through the ingress and matches the contract', async () => {
  const before = await commandCount();
  const reply = await magnus(`/nodes/${encodeURIComponent(stack().node.id)}/software`);
  expect(reply.status, reply.text.slice(0, 400)).toBe(200);
  const { data } = nodeSoftwareResponseSchema.parse(reply.json);
  expect(data.versions.node).toMatch(/^v?\d+\.\d+\.\d+/);
  expect(data.versions['magnus-agent']).toMatch(/^\d+\.\d+\.\d+/);
  agentVersion = data.versions['magnus-agent']!;
  expect(data.packageUpdates.source).toBe('local-package-cache');
  expect(await commandCount()).toBe(before);
});

test('2. Check versions on node detail shows the agent version without a command', async ({ browser }) => {
  const before = await commandCount();
  context = await browser.newContext({ ignoreHTTPSErrors: true });
  page = await context.newPage();
  const reads: string[] = [];
  page.on('request', request => { if (/\/api\/magnus\/nodes\/[^/]+\/software$/.test(new URL(request.url()).pathname)) reads.push(request.method()); });
  await signInPage(page, `/fleet/nodes/${encodeURIComponent(stack().node.id)}`);
  await expect(page.getByText('Software revisions')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Check versions' }).click();
  await expect(page.getByText('Last checked:')).toBeVisible();
  await expect(page.locator('dt', { hasText: /^magnus-agent$/ }).locator('xpath=following-sibling::dd')).toHaveText(agentVersion);
  await expect(page.getByText('Software status is unavailable')).toHaveCount(0);
  await shot(page, 'software-card');
  expect(reads).toEqual(['GET']);
  expect(await commandCount()).toBe(before);
});
