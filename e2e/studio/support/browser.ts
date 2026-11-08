// Browser helpers for the Studio specs: operator sign-in through the console and screenshots.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { stack } from './stack';

export const shotsDir = resolve(process.env.STUDIO_E2E_SHOTS ?? join(import.meta.dirname, '../../../output/studio-e2e-shots'));

export async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: join(shotsDir, `${name}.png`) });
}

/** Sign in on the console's own sign-in page, as an operator does. */
export async function signInPage(page: Page, path = '/'): Promise<void> {
  const { origin, admin } = stack();
  await page.goto(origin + path);
  await page.getByLabel('Username').fill(admin.username);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(admin.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByLabel('Username')).toHaveCount(0, { timeout: 30_000 });
}
