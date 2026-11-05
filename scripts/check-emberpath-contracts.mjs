// Verify a reviewed product-owned immutable export; never read sibling source.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const bytes = readFileSync(new URL('../contracts/emberpath-model-admin.generated.ts', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../contracts/emberpath-model-admin.provenance.json', import.meta.url), 'utf8'));
if (manifest.schema !== 1 || manifest.product !== 'emberpath-model-admin' || manifest.contractVersion !== 1 ||
    !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/u.test(manifest.productVersion) ||
    manifest.repository !== 'https://github.com/ChefTaco/Emberpath' || !/^[a-f0-9]{40}$/u.test(manifest.revision) ||
    manifest.source !== 'src/contracts/model-admin.ts' || manifest.sha256 !== createHash('sha256').update(bytes).digest('hex'))
  throw Error('Emberpath released model administration contract drift');
if (/from\s+['"](?!zod['"])/u.test(bytes.toString('utf8'))) throw Error('Browser contract imports a backend implementation');
console.log('Emberpath released model administration contract verified.');
