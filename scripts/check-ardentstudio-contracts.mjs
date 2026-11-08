// Verify the product-owned, immutable Ardent Project Studio browser contract export. Exports the
// validator so the import command applies the same rules before it replaces anything.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Each exported file and the name it is vendored under in contracts/. */
export const FILES = [
  { path: 'browser.ts', source: 'src/shared/browser.ts', vendored: 'ardentstudio.generated.ts' },
  { path: 'openapi-browser.json', source: 'docs/openapi-browser.json', vendored: 'ardentstudio.openapi.json' },
];
export const PROVENANCE = 'ardentstudio.provenance.json';

/** `files` maps an export's own file names to the directory they are read from. */
export function verifyArdentStudioContracts(manifest, read) {
  if (
    manifest.schema !== 1 ||
    manifest.product !== 'ardentstudio-browser' ||
    !Number.isInteger(manifest.version) ||
    manifest.repository !== 'https://github.com/ChefTaco/ArdentStudio' ||
    !/^[a-f0-9]{40}$/u.test(manifest.revision) ||
    JSON.stringify(manifest.files?.map((file) => [file.path, file.source])) !== JSON.stringify(FILES.map((file) => [file.path, file.source]))
  )
    throw Error('Ardent Project Studio browser contract provenance drift');
  for (const file of manifest.files) {
    const bytes = read(file.path);
    if (file.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw Error('Ardent Project Studio browser contract drift');
    if (file.path !== 'browser.ts') continue;
    const text = bytes.toString('utf8');
    for (const match of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/gu))
      if ((match[1] ?? match[2]) !== 'zod') throw Error('Browser contract imports backend implementation');
    if (Number(/ardentStudioBrowserContractVersion\s*=\s*(\d+)/u.exec(text)?.[1]) !== manifest.version)
      throw Error('Ardent Project Studio browser contract version drift');
  }
  const openapi = JSON.parse(read('openapi-browser.json').toString('utf8'));
  if (openapi.openapi !== '3.1.0' || openapi.info?.version !== String(manifest.version))
    throw Error('Ardent Project Studio OpenAPI document does not match the contract version');
  return manifest;
}

/** The vendored copy in contracts/. */
export function verifyVendored(directory) {
  const root = directory.endsWith('/') ? directory : directory + '/';
  const manifest = JSON.parse(readFileSync(root + PROVENANCE, 'utf8'));
  const vendored = new Map(FILES.map((file) => [file.path, file.vendored]));
  return verifyArdentStudioContracts(manifest, (name) => readFileSync(root + vendored.get(name)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyVendored(new URL('../contracts/', import.meta.url).pathname);
  console.log('Ardent Project Studio immutable browser contracts verified.');
}
