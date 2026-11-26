// Re-authentication without a product ever seeing a password, in the built app against the mocked
// runtime: an Emberpath credential change that needs a recent sign-in runs an OpenID Connect round
// trip (prompt=login, PKCE, Emberpath's nonce, Oathweave's login ticket), proves it to Emberpath with
// the ID token, and the change then goes through. Cancelling leaves it undone. Also: the sign-in
// portal's forced sign-in and cancel, and the screen of a console without Oathweave sign-in.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Request } from '@playwright/test';
import { FIXED_NOW, installMocks } from './mock-runtime';

const PASSWORD = 'obviously-fake-password';
const TICKET = 'fixture-login-ticket';

interface Recorded { method: string; path: string; body: string }

/** Requests the page sent, with their bodies, to check where the password went. */
function record(page: Page): Recorded[] {
  const seen: Recorded[] = [];
  page.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) seen.push({ method: request.method(), path: url.pathname, body: request.postData() ?? '' });
  });
  return seen;
}

/** An Emberpath key change that needs a step-up, and the step-up endpoints of Oathweave and Emberpath. */
async function stepUpMocks(page: Page) {
  const state = { stepped: false, verified: false, nonce: '', proofs: [] as string[] };
  // Registered after installMocks, so these answer first; anything else falls through to it.
  await page.route(/\/api\/emberpath\/client-keys\/ck_1$/, (route) => state.stepped
    ? route.fulfill({ json: { data: { id: 'ck_1', name: 'build-agent', keyPrefix: 'ep_ab12', enabled: false, metadataJson: '{}', lastUsedAt: null, expiresAt: null, createdAt: '2026-11-01T09:00:00.000Z', updatedAt: '2026-11-12T12:00:00.000Z' } } })
    : route.fulfill({ status: 403, json: { error: 'STEP_UP_REQUIRED', message: 'Sign in again before changing credentials or security policy.' } }));
  await page.route(/\/api\/emberpath\/auth\/step-up\/challenge$/, (route) => {
    state.nonce = 'emberpath-nonce-' + 'n'.repeat(27);
    return route.fulfill({ json: { nonce: state.nonce, startedAt: new Date(FIXED_NOW).toISOString(), expiresIn: 600, maxAgeSeconds: 300, audiences: ['hivexui-emberpath'] } });
  });
  await page.route(/\/api\/emberpath\/auth\/step-up$/, (route) => {
    const body = route.request().postDataJSON() as { idToken: string };
    state.proofs.push(body.idToken);
    state.stepped = true;
    return route.fulfill({ json: { ok: true, authTime: new Date(FIXED_NOW).toISOString(), recentUntil: new Date(FIXED_NOW).toISOString() } });
  });
  await page.route(/\/api\/iam\/auth\/step-up$/, (route) => {
    state.verified = true;
    return route.fulfill({ json: { success: true } });
  });
  await page.route(/\/api\/iam\/oauth\/authorize\/cancel$/, (route) => {
    const body = route.request().postDataJSON() as { state: string; redirectUri: string };
    const iss = 'https://identity.example.com';
    const redirectTo = `${body.redirectUri}?error=access_denied&error_description=Sign-in+cancelled&state=${body.state}&iss=${encodeURIComponent(iss)}`;
    return route.fulfill({ json: { error: 'access_denied', error_description: 'Sign-in cancelled', state: body.state, iss, redirectTo } });
  });
  await page.route(/\/api\/iam\/oauth\/authorize$/, (route) => {
    const body = route.request().postDataJSON() as { prompt?: string; loginTicket?: string };
    if (body.prompt === 'login' && (!body.loginTicket || !state.verified))
      return route.fulfill({ status: 401, json: { error: 'LOGIN_REQUIRED', message: 'Sign in again', reason: 'prompt_login', loginTicket: TICKET, loginTicketExpiresIn: 600 } });
    return route.fallback();
  });
  return state;
}

async function toggle(page: Page) {
  await page.getByRole('button', { name: 'Disable' }).first().click();
}

test('a credential change re-authenticates through Oathweave and proves it to Emberpath with an ID token', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await installMocks(page);
  const state = await stepUpMocks(page);
  const seen = record(page);
  await page.goto('/?page=keys', { waitUntil: 'networkidle' });
  await toggle(page);

  const dialog = page.getByRole('dialog', { name: 'Verify your identity' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('your password goes only to Oathweave');
  const results = await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => violation.id)).toEqual([]);
  await dialog.getByLabel('Current password').fill(PASSWORD);
  await dialog.getByLabel('Authenticator code (if enabled)').fill('123456');
  await dialog.getByRole('button', { name: 'Verify' }).click();

  // The refused change is not replayed: the person submits it again, and now it goes through.
  await expect(page.getByText('Identity verified. Review and submit the operation again.')).toBeVisible();
  expect(state.proofs).toHaveLength(1);
  const forced = seen.filter((entry) => entry.path === '/api/iam/oauth/authorize' && entry.body.includes('"prompt":"login"')).map((entry) => JSON.parse(entry.body) as Record<string, unknown>);
  expect(forced).toHaveLength(2);
  expect(forced[0]).toMatchObject({ clientId: 'hivexui-emberpath', nonce: state.nonce, codeChallengeMethod: 'S256' });
  expect(forced[0]).not.toHaveProperty('loginTicket');
  expect(forced[1]).toMatchObject({ loginTicket: TICKET, nonce: state.nonce });
  await toggle(page);
  await expect(page.getByText('API key updated')).toBeVisible();

  // The password went to Oathweave's own step-up only, never to a product.
  expect(seen.filter((entry) => entry.body.includes(PASSWORD)).map((entry) => entry.path)).toEqual(['/api/iam/auth/step-up']);
  expect(seen.some((entry) => entry.path.endsWith('/auth/login') || entry.path.endsWith('/auth/reauthenticate'))).toBe(false);
});

test('a cancelled re-authentication shows a clear, dismissible notice and leaves the change undone', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await installMocks(page);
  const state = await stepUpMocks(page);
  const seen = record(page);
  await page.goto('/?page=keys', { waitUntil: 'networkidle' });
  await toggle(page);
  const dialog = page.getByRole('dialog', { name: 'Verify your identity' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Identity verification cancelled').first()).toBeVisible();
  await expect(page.getByText('Identity verification was cancelled, so nothing was changed.').first()).toBeVisible();
  expect(state.stepped).toBe(false);
  expect(state.proofs).toHaveLength(0);
  expect(seen.some((entry) => entry.path === '/api/iam/oauth/authorize/cancel')).toBe(true);
  expect(seen.filter((entry) => entry.method === 'PUT' && entry.path === '/api/emberpath/client-keys/ck_1')).toHaveLength(1);
  // The notices can be dismissed.
  const close = page.getByRole('button', { name: /dismiss|close/i }).first();
  await close.click();
});

test('the sign-in portal asks for a new sign-in for prompt=login and returns a cancellation to the application', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await installMocks(page);
  await stepUpMocks(page);
  let navigated = '';
  await page.route(/^https:\/\/app\.example\.com\//, (route) => {
    navigated = route.request().url();
    return route.fulfill({ body: 'returned to the application', contentType: 'text/plain' });
  });
  const query = new URLSearchParams({
    client_id: 'hivexui-partner', redirect_uri: 'https://app.example.com/callback', response_type: 'code',
    state: 's'.repeat(43), nonce: 'n'.repeat(43), code_challenge: 'c'.repeat(43), code_challenge_method: 'S256',
    scope: 'openid profile', prompt: 'login', max_age: '0',
  });
  await page.goto('/auth/authorize?' + query, { waitUntil: 'networkidle' });
  await expect(page.getByText('The application asks you to sign in again before it continues.')).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => violation.id)).toEqual([]);
  await page.getByRole('button', { name: 'Cancel and return to the application' }).click();
  await expect.poll(() => navigated).toContain('https://app.example.com/callback?error=access_denied');
});

test('a console without Oathweave browser sign-in says what to configure, with no password form', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await installMocks(page);
  await page.route(/\/runtime\.json(\?.*)?$/, (route) => route.fulfill({ json: { schema: 1, mode: 'legacy', products: { emberpath: '/api/emberpath' } } }));
  const seen = record(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Configure Oathweave browser sign-in' })).toBeVisible();
  await expect(page).toHaveTitle('Configure Oathweave sign-in · HiveXUI');
  await expect(page.locator('input[type="password"]:visible')).toHaveCount(0);
  expect(seen).toEqual([]);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => violation.id)).toEqual([]);
});
