// Starts the stack once for the run unless one is already running. Without Docker the specs
// skip themselves (see support/stack.ts stackAvailable), so CI without Docker stays green.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { stackAvailable } from './support/stack';

export default function globalSetup(): void {
  if (stackAvailable() || process.env.STUDIO_E2E_NO_START === '1') return;
  const script = join(import.meta.dirname, '../stack/stack.mjs');
  if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
    process.stdout.write('[studio-e2e] Docker is not available: the Studio end-to-end specs are skipped\n');
    return;
  }
  const result = spawnSync(process.execPath, [script, 'up'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('The Studio end-to-end stack did not start');
  process.env.STUDIO_E2E_STARTED = '1';
}
