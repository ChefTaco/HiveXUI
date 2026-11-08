// Replace the vendored Ardent Project Studio contract with a newer export from its repository:
//
//   (in ArdentStudio)  npm run export:browser-contracts -- ./output/ardentstudio-browser-contracts
//   (in HiveXUI)       npm run contracts:ardentstudio:import -- /path/to/output/ardentstudio-browser-contracts
//
// The export is verified before anything changes, then npm run typecheck tells you what moved.
import { copyFileSync, readFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILES, PROVENANCE, verifyArdentStudioContracts, verifyVendored } from './check-ardentstudio-contracts.mjs';

const source = process.argv[2];
if (!source) {
  console.error('usage: npm run contracts:ardentstudio:import -- <export directory>');
  process.exit(2);
}
const directory = resolve(source);
const manifest = verifyArdentStudioContracts(JSON.parse(readFileSync(join(directory, 'provenance.json'), 'utf8')), (name) => readFileSync(join(directory, name)));
const target = fileURLToPath(new URL('../contracts', import.meta.url));
const previous = verifyVendored(target);
const copies = [...FILES.map((file) => [file.path, file.vendored]), ['provenance.json', PROVENANCE]];
// Stage beside the target first, so a rename never crosses file systems.
for (const [from, to] of copies) copyFileSync(join(directory, from), join(target, to + '.incoming'));
for (const [, to] of copies) renameSync(join(target, to + '.incoming'), join(target, to));
verifyVendored(target);
console.log(`Ardent Project Studio browser contracts: ${previous.revision.slice(0, 12)} v${previous.version} -> ${manifest.revision.slice(0, 12)} v${manifest.version}.`);
console.log('Run npm run typecheck and npm test, and review the diff of contracts/ardentstudio.*.');
