// Verify the locally pinned Hive Registry browser contract. Hive has no export of its own yet, so
// this holds the file to its recorded checksum and source revision; it never reads sibling source.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

const root = new URL('../contracts/hive-registry/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('provenance.json', root), 'utf8'));
const hash = /^[a-f0-9]{64}$/u;
if (
  manifest.schema !== 1 ||
  manifest.product !== 'hive-registry-browser' ||
  manifest.origin !== 'local-pin' ||
  !Number.isInteger(manifest.version) ||
  manifest.repository !== 'https://github.com/ChefTaco/hive' ||
  !/^[a-f0-9]{40}$/u.test(manifest.revision) ||
  !Array.isArray(manifest.sources) ||
  manifest.sources.length === 0 ||
  manifest.sources.some((source) => !source.path.startsWith('services/hive-registry/src/') || !hash.test(source.sha256)) ||
  JSON.stringify(manifest.files?.map((file) => file.path)) !== JSON.stringify(['browser.ts'])
)
  throw Error('Hive Registry browser contract provenance drift');
if (JSON.stringify(readdirSync(root).sort()) !== JSON.stringify(['browser.ts', 'provenance.json']))
  throw Error('Hive Registry browser contract directory holds an unexpected file');
const bytes = readFileSync(new URL('browser.ts', root));
if (manifest.files[0].sha256 !== createHash('sha256').update(bytes).digest('hex'))
  throw Error('Hive Registry browser contract drift: review it and record the new checksum');
const text = bytes.toString('utf8');
for (const match of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/gu))
  if ((match[1] ?? match[2]) !== 'zod') throw Error('Browser contract imports a backend implementation');
if (Number(/registryBrowserContractVersion\s*=\s*(\d+)/u.exec(text)?.[1]) !== manifest.version)
  throw Error('Hive Registry browser contract version drift');
console.log('Hive Registry browser contract matches its local pin (no Hive export exists yet).');
