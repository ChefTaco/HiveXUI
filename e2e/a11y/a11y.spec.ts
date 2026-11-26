// Accessibility check of the built app against a mocked runtime (no backends needed). Fails on any
// serious or critical WCAG 2.1 A/AA violation that axe finds on these pages.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { CREDENTIAL_NODES, FIXED_NOW, installMocks, MAGNUS_SESSION_V3, NODE_CREDENTIAL_SUMMARY_V3, UPGRADE_ELIGIBILITY_V3 } from './mock-runtime';

const PAGES = [
  { name: 'Emberpath routers', path: '/?page=routers' },
  { name: 'Emberpath providers', path: '/?page=providers' },
  { name: 'Emberpath routing', path: '/?page=routing' },
  { name: 'Routing audit', path: '/?page=audit' },
  { name: 'Hive incidents', path: '/?page=incidents' },
  { name: 'Oathweave users', path: '/?page=iam-users' },
  { name: 'ChatterMost administration', path: '/?page=chat&chatAdmin=users' },
  { name: 'HiveSkills', path: '/?page=skills' },
  { name: 'HiveMem workspaces', path: '/?page=workspaces' },
  { name: 'Installation overview', path: '/' },
  { name: 'Inbox', path: '/?page=inbox' },
  { name: 'Setup checklist', path: '/?page=setup' },
  { name: 'Installed software', path: '/?page=software' },
  { name: 'Cindertrace overview', path: '/security-fusion' },
  { name: 'Cindertrace cases', path: '/security-fusion/cases' },
  { name: 'Cindertrace case', path: '/security-fusion/cases/case-1' },
  { name: 'Cindertrace events', path: '/security-fusion/events' },
  { name: 'Cindertrace entities', path: '/security-fusion/entities' },
  { name: 'Cindertrace sources', path: '/security-fusion/sources' },
  { name: 'Cindertrace evidence', path: '/security-fusion/evidence' },
  { name: 'Cindertrace policies', path: '/security-fusion/policies' },
  { name: 'Cindertrace security audit', path: '/security-fusion/audit?date=2026-11-10' },
  { name: 'Magnus fleet timeline', path: '/fleet/fleet-timeline' },
  { name: 'Magnus retention', path: '/fleet/retention' },
  { name: 'Agent 360 overview', path: '/agents/node-1~lead' },
  { name: 'Agent 360 memories', path: '/agents/node-1~lead?tab=memories' },
  { name: 'Agent 360 projects', path: '/agents/node-1~lead?tab=projects' },
  { name: 'Agent 360 cases', path: '/agents/node-1~lead?tab=cases' },
  { name: 'Agent 360 executions', path: '/agents/node-1~lead?tab=executions' },
  { name: 'Agent 360 traffic', path: '/agents/node-1~lead?tab=traffic' },
  { name: 'Magnus Ardent overview and agent dependencies', path: '/fleet/ardent' },
  { name: 'Agent 360 skills', path: '/agents/node-1~lead?tab=skills' },
  { name: 'Embermend', path: '/?page=embermend' },
  { name: 'Memories and memory operations', path: '/?page=memories' },
  { name: 'Chat conversation', path: '/?page=chat&chatTeam=team00000000000000000000001&chatChannel=chan00000000000000000000001' },
  { name: 'Account security', path: '/?page=account' },
  { name: 'Actors', path: '/?page=actors' },
  { name: 'Emberpath traces', path: '/?page=traces' },
  { name: 'Emberpath API keys', path: '/?page=keys' },
  { name: 'Emberpath testing', path: '/?page=testing' },
];
/** Pages checked again at a phone's width, where the sidebar becomes a drawer. */
const NARROW = ['Installation overview', 'Emberpath providers', 'Oathweave users', 'Embermend', 'Chat conversation', 'Cindertrace cases', 'Magnus fleet timeline', 'Agent 360 overview'];

async function scan(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({ rule: violation.id, impact: violation.impact, help: violation.help, targets: violation.nodes.map((node) => node.target.join(' ')).slice(0, 5) }));
}

test.describe('at 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const { name, path } of PAGES.filter((entry) => NARROW.includes(entry.name)))
    test(`${name} has no serious or critical accessibility violations and no sideways scroll`, async ({ page }) => {
      await page.clock.setFixedTime(FIXED_NOW);
      await installMocks(page);
      await page.goto(path, { waitUntil: 'networkidle' });
      await expect(page.locator('main h2').first()).toBeVisible();
      await page.waitForTimeout(500);
      expect(await scan(page)).toEqual([]);
      // The page itself never scrolls sideways; wide content scrolls inside its own frame.
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      // The navigation drawer opens over the page and its contents pass too.
      await page.getByRole('button', { name: 'Toggle navigation' }).click();
      await expect(page.locator('#product-navigation')).toBeVisible();
      expect(await scan(page)).toEqual([]);
    });
});

const STUDIO_PROJECT = '/studio/p/prj_01HZX3K6Q1V8R2M4N6P8T0W001';
const STUDIO_PAGES = [
  { name: 'Studio projects', path: '/studio', ready: 'Sunken Archive' },
  { name: 'Studio conversation room', path: `${STUDIO_PROJECT}/room`, ready: 'Team room' },
  { name: 'Studio review', path: `${STUDIO_PROJECT}/review`, ready: 'Deliverables from every agent' },
  { name: 'Studio team assignment', path: `${STUDIO_PROJECT}/team`, ready: 'Design the team' },
  { name: 'Agent Studio', path: '/studio/agents/node-1~lead', ready: 'lead on node-1' },
];
for (const { name, path, ready } of STUDIO_PAGES)
  test(`${name} has no serious or critical accessibility violations`, async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await installMocks(page);
    await page.goto(path, { waitUntil: 'networkidle' });
    await expect(page.locator('#studio-main')).toContainText(ready);
    await page.waitForTimeout(500);
    expect(await scan(page)).toEqual([]);
  });

test('memory operations have no serious or critical accessibility violations', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await installMocks(page);
  await page.goto('/?page=memories', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Open memory operations' }).click();
  await page.waitForTimeout(500);
  expect(await scan(page)).toEqual([]);
});

test('the sign-in screen has no serious or critical accessibility violations', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await installMocks(page, [], { signedOut: true });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  await expect(page).toHaveTitle('Sign in · HiveXUI');
  expect(await scan(page)).toEqual([]);
});

for (const { name, path } of PAGES)
  test(`${name} has no serious or critical accessibility violations`, async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await installMocks(page);
    await page.goto(path, { waitUntil: 'networkidle' });
    await expect(page.locator('main h2').first()).toBeVisible();
    // Let lazy modules and entry transitions settle before scanning.
    await page.waitForTimeout(500);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const blocking = results.violations
      .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
      .map((violation) => ({ rule: violation.id, impact: violation.impact, help: violation.help, targets: violation.nodes.map((node) => node.target.join(' ')).slice(0, 5) }));
    expect(blocking).toEqual([]);
  });

test('the keyboard opens an audit row and skips to the page content', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await installMocks(page);
  await page.goto('/?page=audit', { waitUntil: 'networkidle' });
  await expect(page).toHaveTitle('Routing audit · HiveXUI');
  // The first Tab reaches the skip link, which moves focus past the sidebar.
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  // A row's first-cell button opens the same drawer as clicking the row.
  const open = page.getByRole('button', { name: /open audit event auth\.login/ }).first();
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'auth.login' })).toBeVisible();
});

test('the shared confirmation dialog has no serious or critical accessibility violations', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await installMocks(page);
  await page.goto('/?page=iam-users', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Delete' }).first().click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  const results = await new AxeBuilder({ page }).include('[role="alertdialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => violation.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('the provider drawer says why a moved base URL needs the secret again, without accessibility violations', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await installMocks(page);
  await page.goto('/?page=providers', { waitUntil: 'networkidle' });
  await page.getByRole('row', { name: /Router A/ }).getByRole('button', { name: 'Edit' }).click();
  const drawer = page.getByRole('dialog', { name: 'Router A' });
  await expect(drawer).toBeVisible();
  // Nothing is asked while the provider stays on its server, even on another path.
  await drawer.getByLabel('Base URL').fill('https://router-a.example.com/api/v2');
  await expect(drawer.getByRole('status')).toHaveCount(0);
  await expect(drawer.getByText('Leave blank to keep the current secret')).toBeVisible();
  await drawer.getByLabel('Base URL').fill('https://elsewhere.example.net/v1');
  const notice = drawer.getByRole('status');
  await expect(notice).toContainText('The base URL now points to a different server (https://elsewhere.example.net)');
  await expect(notice).toContainText('enter the auth secret again');
  await expect(notice).toContainText('"x-api-token"');
  await expect(drawer.getByLabel('Auth Secret')).toHaveAttribute('aria-invalid', 'true');
  await page.waitForTimeout(500);
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => violation.id)).toEqual([]);
  // Typing the secret and a real header value clears the notice.
  await drawer.getByLabel('Auth Secret').fill('synthetic-secret');
  await drawer.getByLabel('Default Headers (JSON object)').fill('{"x-api-token":"synthetic-header","x-title":"Hive"}');
  await expect(drawer.getByRole('status')).toHaveCount(0);
});

test('the Magnus agent upgrade drawer has no serious or critical accessibility violations', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await installMocks(page);
  await page.goto('/fleet/nodes?upgrade=agents', { waitUntil: 'networkidle' });
  const drawer = page.getByRole('dialog', { name: 'Upgrade agents' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('1 agent requires a manual major-version upgrade')).toBeVisible();
  await page.waitForTimeout(500);
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => violation.id)).toEqual([]);
});

test('Allow major upgrade, its confirmation and the agents it holds back have no serious or critical accessibility violations', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await installMocks(page);
  await page.route(/\/api\/magnus\/console\/session$/, (route) => route.fulfill({ json: { success: true, data: MAGNUS_SESSION_V3 } }));
  await page.route(/\/api\/magnus\/agents\/upgrade\/eligibility$/, (route) => route.fulfill({ json: { success: true, data: UPGRADE_ELIGIBILITY_V3 } }));
  await page.goto('/fleet/nodes?upgrade=agents', { waitUntil: 'networkidle' });
  const drawer = page.getByRole('dialog', { name: 'Upgrade agents' });
  await expect(drawer.getByText('2 agents are on another major version than 3.0.2')).toBeVisible();
  const axe = async () => {
    await page.waitForTimeout(500);
    const results = await new AxeBuilder({ page }).include('[role="dialog"], [role="alertdialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => violation.id)).toEqual([]);
  };
  await axe();
  await drawer.getByRole('checkbox', { name: 'Allow major upgrade' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('2.10.x → 2.10.3 → 3.x');
  await expect(confirm).toContainText('valid for one hour');
  await axe();
  await confirm.getByRole('button', { name: 'Allow major upgrade' }).click();
  await expect(drawer.getByRole('note', { name: 'Agents a major upgrade holds back' })).toContainText('MAJOR_NEEDS_STEPPING_STONE: node-2');
  await expect(drawer.getByRole('checkbox', { name: 'Allow major upgrade' })).toBeChecked();
  await axe();
});

test('the Magnus node credentials panel and its approval have no serious or critical accessibility violations', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await installMocks(page);
  await page.route(/\/api\/magnus\/nodes\?page=1&pageSize=\d+$/, (route) => route.fulfill({ json: { success: true, data: CREDENTIAL_NODES, meta: { total: CREDENTIAL_NODES.length, page: 1, pageSize: 100, hasMore: false } } }));
  await page.goto('/fleet/nodes', { waitUntil: 'networkidle' });
  const panel = page.locator('#node-credentials');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Not ready for enforce: 3 things block it');
  await expect(panel).toContainText('Nodes whose keys were revoked');
  await expect(page.getByRole('region', { name: 'Fleet nodes' }).getByText('awaiting approval')).toBeVisible();
  await page.waitForTimeout(500);
  const scan = await new AxeBuilder({ page }).include('#node-credentials').include('[aria-label="Fleet nodes"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(scan.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => violation.id)).toEqual([]);
  await panel.getByRole('button', { name: 'Approve the key for node-2' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Approve this key binding?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Key fingerprint: dddddddddddddddd');
  await expect(dialog).toContainText('Address it called from: 198.51.100.7');
  const results = await new AxeBuilder({ page }).include('[role="alertdialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => violation.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('the Magnus 3.0.0 deprecation warning and server key rotation have no serious or critical accessibility violations', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await installMocks(page);
  await page.route(/\/api\/magnus\/nodes\?page=1&pageSize=\d+$/, (route) => route.fulfill({ json: { success: true, data: CREDENTIAL_NODES, meta: { total: CREDENTIAL_NODES.length, page: 1, pageSize: 100, hasMore: false } } }));
  await page.route(/\/api\/magnus\/node-credentials\/summary$/, (route) => route.fulfill({ json: { success: true, data: NODE_CREDENTIAL_SUMMARY_V3 } }));
  await page.goto('/fleet/nodes', { waitUntil: 'networkidle' });
  const panel = page.locator('#node-credentials');
  await expect(panel).toBeVisible();
  const warning = panel.getByRole('group', { name: 'NODE_AUTH_MODE=warn is deprecated' });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('the shared node secret is removed in the next major release');
  await expect(panel).toContainText('mode: warn (set)');
  await expect(panel).toContainText('Upgrade these agents to 2.10.2 or later.');
  await expect(panel.getByRole('list', { name: 'Server key rotation status' })).toContainText('0 of 1 keyed node');
  await panel.getByText('Rotate the server key', { exact: true }).click();
  await expect(panel).toContainText('magnus-server node-auth server-key promote --force --grace-hours 168');
  await page.waitForTimeout(500);
  const scan = await new AxeBuilder({ page }).include('#node-credentials').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(scan.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => violation.id)).toEqual([]);
});

test('the Magnus node key list and its revoke dialog have no serious or critical accessibility violations', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await installMocks(page);
  await page.route(/\/api\/magnus\/nodes\/node-1$/, (route) => route.fulfill({ json: { success: true, data: CREDENTIAL_NODES[0] } }));
  await page.goto('/fleet/nodes/node-1', { waitUntil: 'networkidle' });
  const keys = page.getByRole('region', { name: 'Keys of this node' });
  await expect(keys).toBeVisible();
  await expect(keys).toContainText('9999999988888888');
  await expect(keys).toContainText('revoked');
  await page.waitForTimeout(500);
  const scan = await new AxeBuilder({ page }).include('[aria-label="Keys of this node"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(scan.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => violation.id)).toEqual([]);
  let sent = 0;
  await page.route(/\/api\/magnus\/nodes\/node-1\/credentials\/revoke$/, (route) => { sent++; return route.abort(); });
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Revoke this node’s keys?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Key fingerprint: 9999999988888888 (active)');
  await expect(dialog).toContainText('until the node is enrolled again with a token, or its credentials are reset');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('textbox', { name: 'Reason (optional)' }).fill('host rebuilt');
  await expect(dialog).toContainText('12/500');
  const results = await new AxeBuilder({ page }).include('[role="alertdialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => violation.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(sent).toBe(0);
});

test('the inbox drawer has no serious or critical accessibility violations', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await installMocks(page);
  await page.goto('/?page=providers', { waitUntil: 'networkidle' });
  const bell = page.getByRole('button', { name: /^Inbox, \d+ unread$/ });
  await expect(bell).toBeVisible();
  await bell.click();
  const drawer = page.getByRole('dialog', { name: 'Inbox' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Couldn't reach HiveSkills.")).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Case opened: repeated sign-in failures' })).toBeVisible();
  await page.waitForTimeout(500);
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => violation.id)).toEqual([]);
  // Following an event's link closes the drawer and opens its page.
  await drawer.getByRole('link', { name: 'Case opened: repeated sign-in failures' }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/\/security-fusion\/cases\/case-1$/);
});

test('the command palette with record results has no serious or critical accessibility violations', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await installMocks(page);
  await page.goto('/?page=providers', { waitUntil: 'networkidle' });
  await expect(page.locator('main h2').first()).toBeVisible();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Search screens and records' });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole('combobox', { name: 'Search screens and records' })).toBeFocused();
  await page.keyboard.type('node');
  // Screens answer at once; each product's records join as it answers.
  const results = palette.getByRole('listbox', { name: 'Results' });
  await expect(results.getByRole('group', { name: 'Screens' })).toBeVisible();
  await expect(results.getByRole('group', { name: 'Magnus' }).getByRole('option', { name: /node-scout/ })).toBeVisible();
  await expect(results.getByRole('group', { name: 'HiveMem' }).getByRole('option', { name: /Deploys to node-2/ })).toBeVisible();
  await expect(results.getByRole('group', { name: 'Cindertrace' }).getByRole('option', { name: /New service listening on a node/ })).toBeVisible();
  // Oathweave's client list is not served: a quiet note, not an error.
  await expect(results.getByText("Couldn't search Oathweave")).toBeVisible();
  await expect(palette.getByRole('status')).toHaveText(/^\d+ results$/);
  await page.waitForTimeout(300);
  const scan = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(scan.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => violation.id)).toEqual([]);
  // A record opens through the route table: the Cindertrace case.
  await results.getByRole('option', { name: /New service listening on a node/ }).click();
  await expect(palette).toBeHidden();
  await expect(page).toHaveURL(/\/security-fusion\/cases\/case-3$/);
});

test('the setup checklist and its header nudge show what is pending, and pass axe', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await installMocks(page);
  await page.goto('/?page=setup', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 2, name: 'Setup' })).toBeVisible();
  const nudge = page.getByRole('button', { name: /^Setup\s*4\s*steps pending$/ });
  await expect(nudge).toBeVisible();
  const steps = page.getByRole('list', { name: 'Setup steps' }).getByRole('article');
  await expect(steps).toHaveCount(6);
  const admin = steps.filter({ hasText: 'Create your own administrator account' });
  await expect(admin.locator('.badge')).toHaveText('Looks done');
  await expect(admin).toContainText('Looks done — run ./hive.sh setup done first-admin to record it.');
  await expect(steps.filter({ hasText: 'Install the Magnus agent' }).getByText('Not done yet: Magnus has no enrolled node yet.')).toBeVisible();
  await expect(steps.filter({ hasText: 'Add the HiveXUI browser clients' }).getByText(/^Couldn't check:/)).toBeVisible();
  await expect(steps.filter({ hasText: 'A step from a newer controller' }).getByText('Pending', { exact: true })).toBeVisible();
  await expect(page.getByText('Docs: deployment/FULL.md#installing-the-agent')).toBeVisible();
  await page.waitForTimeout(300);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => violation.id)).toEqual([]);
  // The nudge stays in the header on every page, and leads back to the checklist.
  const products = page.getByRole('navigation', { name: 'Products' });
  await products.getByRole('button', { name: 'Hive', exact: true }).click();
  await products.getByRole('button', { name: 'Inbox', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Inbox' })).toBeVisible();
  await nudge.click();
  await expect(page).toHaveURL(/\?page=setup$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Setup' })).toBeVisible();
});

test('installed software needs suite sign-in, so a legacy recovery console says it is not available', async ({ page }) => {
  await installMocks(page);
  await page.goto('/?page=software', { waitUntil: 'networkidle' });
  await expect(page.getByText('Installed software is not available here')).toBeVisible();
});

test('Agent 360 executions and the Ardent dependency report show their states, and pass axe', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await installMocks(page);
  await page.goto('/agents/node-1~lead?tab=executions', { waitUntil: 'networkidle' });
  await expect(page.getByText('Needs decision (effect unknown)')).toBeVisible();
  await expect(page.getByText('Recovering', { exact: true })).toBeVisible();
  await page.goto('/fleet/ardent', { waitUntil: 'networkidle' });
  const report = page.getByRole('list', { name: 'Agent dependencies' });
  await expect(report.getByText('Awaiting configuration')).toBeVisible();
  await expect(report.getByText('Unsupported')).toBeVisible();
  await page.waitForTimeout(500);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => violation.id)).toEqual([]);
});
