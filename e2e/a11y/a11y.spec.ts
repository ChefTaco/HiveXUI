// Accessibility check of the built app against a mocked runtime (no backends needed). Fails on any
// serious or critical WCAG 2.1 A/AA violation that axe finds on these pages.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { FIXED_NOW, installMocks } from './mock-runtime';

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
  { name: 'Agent 360 traffic', path: '/agents/node-1~lead?tab=traffic' },
  { name: 'Agent 360 skills', path: '/agents/node-1~lead?tab=skills' },
];

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
