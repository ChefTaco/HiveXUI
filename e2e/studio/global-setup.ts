// Starts the stack once for the run unless one is already running. Without Docker the specs
// skip themselves (see support/stack.ts stackAvailable), so a local run without Docker stays green.
// STUDIO_E2E_REQUIRED=1 (the scheduled CI run) turns that into a failure: no Docker, a stack that
// does not start, or any skipped spec (support/required-reporter.ts) fails the run.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { stackAvailable } from './support/stack';

const stackRequired = (): boolean => process.env.STUDIO_E2E_REQUIRED === '1';

export default function globalSetup(): void {
  if (stackAvailable() || process.env.STUDIO_E2E_NO_START === '1') return;
  const script = join(import.meta.dirname, '../stack/stack.mjs');
  if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
    if (stackRequired()) throw new Error('STUDIO_E2E_REQUIRED=1, but Docker is not available: the end-to-end stack cannot start');
    process.stdout.write('[studio-e2e] Docker is not available: the Studio end-to-end specs are skipped\n');
    return;
  }
  const result = spawnSync(process.execPath, [script, 'up'], { stdio: 'inherit' });
  if (result.status !== 0) {
    // Playwright runs no teardown after a failed setup: remove what this attempt started.
    if (process.env.STUDIO_E2E_KEEP !== '1') spawnSync(process.execPath, [script, 'down'], { stdio: 'inherit' });
    throw new Error('The Studio end-to-end stack did not start');
  }
  process.env.STUDIO_E2E_STARTED = '1';
}
