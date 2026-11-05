import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
for(const product of ['oathweave-browser','hiveskills']) {
  const provenance=JSON.parse(readFileSync(new URL('../contracts/'+product+'.provenance.json',import.meta.url)));
  const bytes=readFileSync(new URL('../contracts/'+product+'.generated.ts',import.meta.url));
  if(provenance.schema!==1||! /^[a-f0-9]{40}$/.test(provenance.sourceCommit)||provenance.sha256!==createHash('sha256').update(bytes).digest('hex')||!/^\d+\.\d+\.\d+$/.test(provenance.version))throw Error(product+' reviewed browser contract drift');
  if([...bytes.toString().matchAll(/from\s+['"]([^'"]+)/g)].some(match=>match[1]!=='zod'))throw Error(product+' browser contract imports a non-browser dependency');
}
console.log('Owned identity and Skills browser exports match reviewed pins');
