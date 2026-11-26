// Console smoke checks against the real stack, beyond Studio: the IAM users, Memories and Skills
// catalogue pages read live Oathweave, HiveMem and HiveSkills answers through the console's own
// sign-in (so drift between the vendored contracts and the products shows up as a page error),
// sign-out and sign-in again return to the same page, and a product token is renewed past its
// lifetime without a new sign-in. Set STUDIO_E2E_ACCESS_TTL (seconds) when starting the stack to
// make the renewal check take minutes instead of Oathweave's 15.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { shot, signInPage } from './support/browser';
import { stack, stackAvailable } from './support/stack';

test.describe.configure({ mode: 'serial' });
test.skip(!stackAvailable(), 'The Studio end-to-end stack is not running (Docker unavailable or not started)');

let context: BrowserContext;
let page: Page;
/** Page errors and contract failures the console logged. A live page should log none. */
const problems: string[] = [];

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ ignoreHTTPSErrors: true });
  page = await context.newPage();
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /contract|unexpected format|ZodError/i.test(message.text())) problems.push(message.text());
  });
});
test.afterAll(async () => { await context?.close(); });

/** The page's failure states: a section that could not load, a refused product, a page crash. */
async function expectNoPageError(): Promise<void> {
  await expect(page.getByText(/could not be loaded|answered in an unexpected format|Product access was declined|Something went wrong on this page/i)).toHaveCount(0);
  expect(problems).toEqual([]);
}

test('1. IAM users lists the seeded administrator from Oathweave', async () => {
  // Sign in on the overview: the Users page has its own Username field (Create user).
  await signInPage(page, '/');
  await page.goto(`${stack().origin}/?page=iam-users`);
  await expect(page.getByRole('heading', { name: 'Users', exact: true, level: 2 })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(stack().admin.username, { exact: true }).first()).toBeVisible();
  await expectNoPageError();
  await shot(page, 'console-iam-users');
});

test('2. Memories reads HiveMem', async () => {
  await page.goto(`${stack().origin}/?page=memories`);
  await expect(page.getByRole('heading', { name: 'Memories', exact: true, level: 2 })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Recent And Search Results')).toBeVisible();
  await expectNoPageError();
  await shot(page, 'console-memories');
});

test('3. the Skills catalogue reads HiveSkills', async () => {
  await page.goto(`${stack().origin}/?page=skills`);
  await expect(page.getByRole('heading', { name: 'Skills and assignments', exact: true, level: 2 })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/^\d+ skills$/)).toBeVisible();
  await expect(page.locator('.skills-module [role="alert"]')).toHaveCount(0);
  await expectNoPageError();
  await shot(page, 'console-skills');
});

test('4. signing out and in again returns to the same page', async () => {
  await page.goto(`${stack().origin}/?page=iam-users`);
  await expect(page.getByRole('heading', { name: 'Users', exact: true, level: 2 })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('.login-card')).toBeVisible();
  await page.getByLabel('Username').fill(stack().admin.username);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(stack().admin.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: 'Users', exact: true, level: 2 })).toBeVisible({ timeout: 60_000 });
  expect(new URL(page.url()).searchParams.get('page')).toBe('iam-users');
  await expectNoPageError();
});

test('5. a product token past its lifetime is renewed without a new sign-in', async () => {
  // The token the console holds for Oathweave's admin API, and how long it lasts.
  const issued = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/oauth/token') && response.request().method() === 'POST');
  await page.reload();
  const lifetime = Number((await (await issued).json()).expires_in);
  expect(lifetime).toBeGreaterThan(0);
  expect(lifetime).toBeLessThanOrEqual(900);
  await expect(page.getByRole('heading', { name: 'Users', exact: true, level: 2 })).toBeVisible({ timeout: 60_000 });
  // The console renews a token within 30 s of its expiry; wait until the first one has lapsed.
  test.setTimeout((lifetime + 300) * 1000);
  await page.waitForTimeout(lifetime * 1000 + 5_000);
  const renewed = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/oauth/token') && response.request().method() === 'POST', { timeout: 60_000 });
  // Not a reload: the console must renew the token it holds in memory.
  await page.locator('.ops-toolbar').getByRole('button', { name: 'Refresh' }).click();
  expect((await renewed).status()).toBe(200);
  await expect(page.getByText(stack().admin.username, { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  // Still signed in: no sign-in form replaced the page.
  await expect(page.locator('.login-card')).toHaveCount(0);
  await expectNoPageError();
});
