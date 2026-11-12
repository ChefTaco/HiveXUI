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
