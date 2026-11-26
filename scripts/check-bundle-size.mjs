// Fails when the production build grows past its budget. Run after `npm run build`.
//   - the first load (the scripts, module preloads and stylesheets index.html names), gzip-compressed
//   - every JavaScript chunk, uncompressed: Vite's own warning threshold, so no chunk reaches it
// Web workers (pdf.js) load on demand and are counted only by the second rule's exemption list.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

export const FIRST_LOAD_GZIP_KB = 230;
export const CHUNK_KB = 500;
const WORKER = /\.worker(\.min)?-[\w-]+\.js$/;

const dist = process.argv[2] ?? 'dist';
const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const firstLoad = [...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+\.(?:js|css))"/g)].map((match) => match[1]);
if (firstLoad.length === 0) throw new Error(`${dist}/index.html names no assets: is this a build?`);
const firstLoadGzip = firstLoad.reduce((sum, file) => sum + gzipSync(readFileSync(join(dist, file)), { level: 9 }).length, 0);

const chunks = readdirSync(join(dist, 'assets'))
  .filter((name) => name.endsWith('.js') && !WORKER.test(name))
  .map((name) => ({ name, size: statSync(join(dist, 'assets', name)).size }))
  .sort((a, b) => b.size - a.size);
const oversized = chunks.filter((chunk) => chunk.size > CHUNK_KB * 1024);

console.log(`First load: ${kb(firstLoadGzip)} kB gzip in ${firstLoad.length} files (budget ${FIRST_LOAD_GZIP_KB} kB).`);
console.log(`Largest chunk: ${chunks[0]?.name ?? 'none'} at ${kb(chunks[0]?.size ?? 0)} kB (budget ${CHUNK_KB} kB per chunk).`);
const failures = [
  ...(firstLoadGzip > FIRST_LOAD_GZIP_KB * 1024 ? [`the first load is ${kb(firstLoadGzip)} kB gzip, over ${FIRST_LOAD_GZIP_KB} kB`] : []),
  ...oversized.map((chunk) => `${chunk.name} is ${kb(chunk.size)} kB, over ${CHUNK_KB} kB: split it with a lazy import`),
];
if (failures.length) {
  console.error(`Bundle budget exceeded:\n${failures.map((line) => `  - ${line}`).join('\n')}`);
  process.exit(1);
}
