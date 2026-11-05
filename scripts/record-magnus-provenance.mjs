// Record which Magnus source files a work package ported. Hashes the bytes at the module's pinned
// revision, from a read-only clone, so a later change in Magnus is visible.
//
//   npm run magnus:provenance -- <fleet|operations|provisioning|agents> <magnus clone> <path>...
//
// Paths are relative to the Magnus repository: apps/dashboard/src/app/cron/page.tsx
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [pack, clone, ...sources] = process.argv.slice(2);
const packs = ['fleet', 'operations', 'provisioning', 'agents'];
if (!packs.includes(pack) || !clone || sources.length === 0) {
  console.error(`usage: npm run magnus:provenance -- <${packs.join('|')}> <magnus clone> <path>...`);
  process.exit(2);
}
const manifestUrl = new URL('../src/modules/magnus/provenance.json', import.meta.url);
const { revision } = JSON.parse(readFileSync(manifestUrl, 'utf8'));
const target = new URL(`../src/modules/magnus/routes/${pack}.provenance.json`, import.meta.url);
const record = JSON.parse(readFileSync(target, 'utf8'));
const files = new Map(record.files.map((file) => [file.source, file]));
for (const source of sources) {
  // The bytes at the pinned revision, not whatever the working tree holds.
  const bytes = execFileSync('git', ['-C', clone, 'show', `${revision}:${source}`], { maxBuffer: 64 * 1024 * 1024 });
  files.set(source, { source, sha256: createHash('sha256').update(bytes).digest('hex') });
}
record.files = [...files.values()].sort((left, right) => left.source.localeCompare(right.source));
writeFileSync(target, JSON.stringify(record, null, 2) + '\n');
console.log(`${pack}: ${record.files.length} source files recorded at ${revision.slice(0, 12)}.`);
