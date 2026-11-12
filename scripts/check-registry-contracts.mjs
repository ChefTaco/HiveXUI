// Verify the product-owned, immutable Hive Registry browser contract export. Exports the validator
// so a future import command can apply the same rules before it replaces anything.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const NAMES = ['browser.ts'];
const SOURCES = { 'browser.ts': 'services/hive-registry/src/browser-contract.ts' };
const IGNORED = new Set(['provenance.json']);

export function verifyRegistryContracts(directory) {
  const root = directory.endsWith('/') ? directory : directory + '/';
  const manifest = JSON.parse(readFileSync(root + 'provenance.json', 'utf8'));
  if (
    manifest.schema !== 1 ||
    manifest.product !== 'hive-registry-browser' ||
    !Number.isInteger(manifest.version) ||
    manifest.repository !== 'https://github.com/ChefTaco/hive' ||
    !/^[a-f0-9]{40}$/u.test(manifest.revision) ||
    JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(['files', 'product', 'repository', 'revision', 'schema', 'version']) ||
    JSON.stringify(manifest.files?.map((file) => file.path)) !== JSON.stringify(NAMES)
  )
    throw Error('Hive Registry browser contract provenance drift');
  const present = readdirSync(root).filter((name) => !IGNORED.has(name)).sort();
  if (JSON.stringify(present) !== JSON.stringify([...NAMES].sort()))
    throw Error('Hive Registry browser contract directory holds an unexpected file');
  for (const file of manifest.files) {
    const bytes = readFileSync(root + file.path);
    if (file.source !== SOURCES[file.path] || file.sha256 !== createHash('sha256').update(bytes).digest('hex'))
      throw Error('Hive Registry browser contract drift');
    const text = bytes.toString('utf8');
    for (const match of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/gu))
      if ((match[1] ?? match[2]) !== 'zod') throw Error('Browser contract imports backend implementation');
    const declared = /registryBrowserContractVersion\s*=\s*(\d+)/u.exec(text)?.[1];
    if (Number(declared) !== manifest.version) throw Error('Hive Registry browser contract version drift');
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyRegistryContracts(new URL('../contracts/hive-registry/', import.meta.url).pathname);
  console.log('Hive Registry immutable browser contract verified.');
}
