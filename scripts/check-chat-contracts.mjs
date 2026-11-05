// Verify the checksum-pinned product release export without sibling source imports.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const contract = readFileSync(new URL('../contracts/chattermost-admin.generated.ts', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../contracts/chattermost-admin.provenance.json', import.meta.url), 'utf8'));
if (manifest.schema !== 1 || manifest.product !== 'chattermost-browser-admin' || manifest.version !== 1 || manifest.repository !== 'https://github.com/ChefTaco/ChatterMost' || !/^[a-f0-9]{40}$/.test(manifest.revision) || manifest.source !== 'src/shared/browser-admin.ts' || manifest.sha256 !== createHash('sha256').update(contract).digest('hex')) throw Error('ChatterMost released browser contract drift');
if (/from\s+['"](?!zod['"])/.test(contract.toString())) throw Error('Browser contract imports a nonpublic implementation');
console.log('ChatterMost browser administration release contract verified.');
