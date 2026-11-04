import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  cpSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const destination = join(root, 'notices/dependencies');
mkdirSync(destination, { recursive: true });
const queue = Object.keys(manifest.dependencies).map((name) => ({
  name,
  from: root,
  recursive: true,
}));
queue.push(
  { name: 'tailwindcss', from: root, recursive: false },
  { name: 'vite', from: root, recursive: false },
);
const inventory = [];
const seen = new Set();
for (let index = 0; index < queue.length; index++) {
  const item = queue[index];
  if (seen.has(item.name)) continue;
  seen.add(item.name);
  const require = createRequire(join(item.from, 'package.json'));
  let folder = dirname(require.resolve(item.name));
  let pkg;
  while (true) {
    const file = join(folder, 'package.json');
    if (existsSync(file)) {
      const candidate = JSON.parse(readFileSync(file, 'utf8'));
      if (candidate.name === item.name) {
        pkg = candidate;
        break;
      }
    }
    const parent = dirname(folder);
    if (parent === folder)
      throw new Error('Cannot identify dependency license owner: ' + item.name);
    folder = parent;
  }
  const license = [
    'LICENSE',
    'LICENSE.md',
    'LICENSE.txt',
    'license',
    'OFL.txt',
    'OFL',
  ].find((name) => existsSync(join(folder, name)));
  if (!license)
    throw new Error('Missing browser dependency license: ' + item.name);
  const bytes = readFileSync(join(folder, license));
  const file = item.name.replaceAll('@', '').replaceAll('/', '-') + '.LICENSE';
  writeFileSync(join(destination, file), bytes);
  inventory.push({
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  if (item.recursive)
    for (const name of Object.keys(pkg.dependencies ?? {}))
      queue.push({ name, from: folder, recursive: true });
}
writeFileSync(
  join(destination, 'inventory.json'),
  JSON.stringify(
    inventory.sort((a, b) => a.name.localeCompare(b.name)),
    null,
    2,
  ) + '\n',
);
const output = join(root, 'dist/licenses');
mkdirSync(output, { recursive: true });
cpSync(join(root, 'LICENSE'), join(output, 'LICENSE'));
cpSync(join(root, 'NOTICE'), join(output, 'NOTICE'));
cpSync(join(root, 'notices'), join(output, 'upstream'), { recursive: true });
console.log(
  'Preserved browser licenses for ' + inventory.length + ' dependencies.',
);
