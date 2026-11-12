// Accessibility checks with axe against the production build, served by `vite preview` with a mocked
// runtime (e2e/a11y/mock-runtime.ts). Needs no Docker or backends: `npm run e2e:a11y`.
import { defineConfig } from '@playwright/test';

const PORT = 4317;

export default defineConfig({
  testDir: 'e2e/a11y',
  testMatch: '*.spec.ts',
  fullyParallel: true,
  timeout: 60_000,
  reporter: [['list']],
  webServer: {
    command: `npx vite build --logLevel warn && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    timeout: 240_000,
    reuseExistingServer: false,
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
    locale: 'en-US',
  },
});
