import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Keeps every product section on the shared kit in `@ui`: confirmations in ConfirmDialog, buttons
 * through Button, page titles through PageHeader. See docs/THEME.md.
 */
const SOURCE = fileURLToPath(new URL('..', import.meta.url));
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
const relative = (file: string) => file.slice(SOURCE.length);
const sources = walk(SOURCE).filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file));
const withoutComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

function matching(pattern: RegExp, files = sources): string[] {
  return files.flatMap((file) => [...withoutComments(readFileSync(file, 'utf8')).matchAll(pattern)].map((match) => `${relative(file)}: ${match[0].trim()}`));
}

describe('product sections', () => {
  it('confirm in ConfirmDialog (useConfirm), never the browser prompt', () => {
    expect(matching(/\b(?:window|globalThis|self)\.confirm\s*\(/g)).toEqual([]);
    // A bare call is the global unless the file binds its own `confirm`, as chat administration does.
    const ownBinding = /(?:\b(?:const|let|var|function)\s+confirm\b|[{,]\s*confirm\s*[,}]|\bconfirm\s*:)/;
    const unbound = sources.filter((file) => !ownBinding.test(withoutComments(readFileSync(file, 'utf8'))));
    expect(matching(/(?<![\w.$])confirm\s*\(/g, unbound)).toEqual([]);
  });

  it('render buttons through Button or IconButton, and button-styled links through buttonClass', () => {
    expect(matching(/className=["'`]btn(?=["'`\s])/g)).toEqual([]);
  });

  it('title pages with PageHeader instead of the page-head class', () => {
    const pages = sources.filter((file) => relative(file) !== 'components/ui.tsx');
    expect(matching(/\bpage-head(?![\w-])/g, pages)).toEqual([]);
  });

  it('frame tables in TableFrame or DataTable', () => {
    expect(matching(/className=["'`][^"'`]*\btable-wrap\b/g)).toEqual([]);
  });
});
