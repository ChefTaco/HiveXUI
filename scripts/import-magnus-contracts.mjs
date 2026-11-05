// Replace contracts/magnus with a newer export from the Magnus repository:
//
//   (in Magnus)   npm run contracts:browser -- --output ./output/magnus-browser-contracts
//   (in HiveXUI)  npm run contracts:magnus:import -- /path/to/output/magnus-browser-contracts
//
// The export is verified before anything changes, then npm run typecheck tells you what moved.
import { copyFileSync, mkdtempSync, renameSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAMES, verifyMagnusContracts } from './check-magnus-contracts.mjs';

const source = process.argv[2];
if (!source) {
  console.error('usage: npm run contracts:magnus:import -- <export directory>');
  process.exit(2);
}
const directory = resolve(source);
const manifest = verifyMagnusContracts(directory);
const target = fileURLToPath(new URL('../contracts/magnus', import.meta.url));
const previous = verifyMagnusContracts(target);
const staging = mkdtempSync(join(tmpdir(), 'magnus-contracts-'));
try {
  for (const name of [...NAMES, 'provenance.json']) copyFileSync(join(directory, name), join(staging, name));
  verifyMagnusContracts(staging);
  for (const name of [...NAMES, 'provenance.json']) {
    // A rename cannot cross file systems, so stage beside the target first.
    cpSync(join(staging, name), join(target, name + '.incoming'));
    renameSync(join(target, name + '.incoming'), join(target, name));
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}
verifyMagnusContracts(target);
console.log(`Magnus browser contracts: ${previous.revision.slice(0, 12)} v${previous.version} -> ${manifest.revision.slice(0, 12)} v${manifest.version}.`);
console.log('Run npm run typecheck and npm test, and review the diff of contracts/magnus.');
