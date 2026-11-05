// Verify the checksum-pinned product release export without sibling source imports.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const contract = readFileSync(new URL('../contracts/chattermost-admin.generated.ts', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../contracts/chattermost-admin.provenance.json', import.meta.url), 'utf8'));
if (manifest.schema !== 1 || manifest.product !== 'chattermost-browser-admin' || manifest.version !== 1 || manifest.repository !== 'https://github.com/ChefTaco/ChatterMost' || !/^[a-f0-9]{40}$/.test(manifest.revision) || manifest.source !== 'src/shared/browser-admin.ts' || manifest.sha256 !== createHash('sha256').update(contract).digest('hex')) throw Error('ChatterMost released browser contract drift');
if (/from\s+['"](?!zod['"])/.test(contract.toString())) throw Error('Browser contract imports a nonpublic implementation');
console.log('ChatterMost browser administration release contract verified.');
const conversation=readFileSync(new URL('../contracts/chattermost-chat.generated.ts',import.meta.url));
const conversationManifest=JSON.parse(readFileSync(new URL('../contracts/chattermost-chat.provenance.json',import.meta.url),'utf8'));
if(conversationManifest.schema!==1||conversationManifest.product!=='chattermost-browser-chat'||conversationManifest.version!==1||conversationManifest.repository!=='https://github.com/ChefTaco/ChatterMost'||!/^[a-f0-9]{40}$/u.test(conversationManifest.revision)||conversationManifest.source!=='src/shared/browser-chat.ts'||conversationManifest.sha256!==createHash('sha256').update(conversation).digest('hex'))throw Error('ChatterMost released conversation contract drift');
if(/from\s+['"](?!zod['"])/u.test(conversation.toString('utf8')))throw Error('Conversation contract imports backend implementation');
const types=readFileSync(new URL('../contracts/chattermost.generated.ts',import.meta.url),'utf8');if(!/^\/\/[^\n]*\nexport type \* from "\.\/chattermost-chat\.generated";\n$/u.test(types))throw Error('Native protocol types must come from released conversation schemas');
console.log('ChatterMost immutable conversation contract verified.');
