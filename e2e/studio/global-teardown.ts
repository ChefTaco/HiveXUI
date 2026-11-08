// Removes the stack this run started; a stack that was already running is left for reuse.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export default function globalTeardown(): void {
  if (process.env.STUDIO_E2E_STARTED !== '1' || process.env.STUDIO_E2E_KEEP === '1') return;
  spawnSync(process.execPath, [join(import.meta.dirname, '../stack/stack.mjs'), 'down'], { stdio: 'inherit' });
}
