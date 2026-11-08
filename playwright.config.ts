// End-to-end tests of Ardent Project Studio against a real stack built from source
// (e2e/stack). `npm run e2e` starts the stack when Docker is available and skips otherwise.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e/studio',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  globalSetup: './e2e/studio/global-setup.ts',
  globalTeardown: './e2e/studio/global-teardown.ts',
  use: {
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
    trace: 'off',
    actionTimeout: 30_000,
  },
});
