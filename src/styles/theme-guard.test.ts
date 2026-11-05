import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';

/** Keeps every page, including ones ported later, on the shared theme. See docs/THEME.md. */
const SOURCE = fileURLToPath(new URL('..', import.meta.url));
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
const files = walk(SOURCE);
const read = (file: string) => readFileSync(file, 'utf8');
const relative = (file: string) => file.slice(SOURCE.length);
const stylesheets = files.filter((file) => file.endsWith('.css'));
const components = files.filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file));
const moduleStylesheets = stylesheets.filter((file) => !relative(file).startsWith('styles/'));
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function matching(sources: string[], pattern: RegExp): string[] {
  return sources.flatMap((file) => [...read(file).matchAll(pattern)].map((match) => `${relative(file)}: ${match[0]}`));
}

describe('stylesheets', () => {
  const styled = stylesheets.filter((file) => !file.endsWith('tokens.css'));

  it('take every color from tokens.css', () => {
    const literal = styled.flatMap((file) => {
      const css = withoutComments(read(file)).replace(/url\([^)]*\)/g, '');
      return [...css.matchAll(/#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\(/gi)].map((match) => `${relative(file)}: ${match[0]}`);
    });
    expect(literal).toEqual([]);
  });

  it('take every font size and family from tokens.css', () => {
    const literal = styled.flatMap((file) => [...withoutComments(read(file)).matchAll(/font-(?:size|family):(?!\s*(?:var\(|inherit))[^;]+;/g)].map((match) => `${relative(file)}: ${match[0]}`));
    expect(literal).toEqual([]);
  });

  it('import Tailwind in exactly one place, in layers', () => {
    expect(stylesheets.filter((file) => /@import\s+['"]tailwindcss/.test(read(file))).map(relative)).toEqual(['styles/index.css']);
    expect(read(join(SOURCE, 'styles/index.css'))).toMatch(/^@layer theme, base, components, utilities;$/m);
  });

  it('keep module styles inside a cascade layer', () => {
    for (const file of moduleStylesheets) {
      const css = withoutComments(read(file)).trim();
      expect(css.startsWith('@layer components {') && css.endsWith('}'), relative(file)).toBe(true);
      let depth = 0;
      for (let index = css.indexOf('{'); index < css.length; index += 1) {
        if (css[index] === '{') depth += 1;
        if (css[index] === '}') depth -= 1;
        if (depth === 0 && index < css.length - 1) expect.fail(`${relative(file)} has CSS outside its layer`);
      }
    }
  });

  it('never name a class after a Tailwind utility', async () => {
    const names = new Set(stylesheets.filter((file) => !file.endsWith('tokens.css') && !file.endsWith('index.css')).flatMap((file) => [...withoutComments(read(file)).replace(/url\([^)]*\)/g, '').replace(/html\[data-fx='low'\] [^,{]+/g, '').matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].map((match) => match[1]!)));
    expect(names.size).toBeGreaterThan(100);
    const compiler = await compile(`@tailwind utilities; ${read(join(SOURCE, 'styles/tokens.css'))}`);
    const generated = compiler.build([...names]);
    expect([...names].filter((name) => generated.includes(`.${name} {`) || generated.includes(`.${name}{`))).toEqual([]);
  });
});

describe('components', () => {
  it('use readable text: no arbitrary sizes under the 12px floor', () => {
    expect(matching(components, /\btext-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/g)).toEqual([]);
  });

  it('do not set sizes or colors outside the scale', () => {
    expect(matching(components, /\btext-\[\d[^\]]*\]/g)).toEqual([]);
    expect(matching(components, /\b(?:bg|text|border|ring|from|via|to|fill|stroke)-(?:\[#|white\b|black\b|(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d)/g)).toEqual([]);
  });

  it('do not use legacy token names', () => {
    expect(matching(components, /var\(--(?:amber|teal|sky|violet|coral|muted|bg-void|text-bright|border-light)\b[^)]*\)/g)).toEqual([]);
  });

  it('define every glow and effect hook they use', () => {
    const effects = read(join(SOURCE, 'styles/effects.css'));
    const used = new Set(components.flatMap((file) => [...read(file).matchAll(/\b(?:glow-(?:text-)?[a-z]+(?:--[a-z]+)?|panel-corners|grid-bg|scan-sweep)\b/g)].map((match) => match[0])));
    expect([...used].filter((name) => !effects.includes(`.${name}`))).toEqual([]);
  });

  it('take glow color from tokens in shadows', () => {
    expect(matching(components, /shadow-\[[^\]]*(?:rgba?\(|#[0-9a-f]{3,8})[^\]]*\]/gi)).toEqual([]);
  });

  it('do not shout: uppercase and wide tracking stay out of page text', () => {
    expect(matching(components, /\buppercase\b(?=[^"'`\n]*["'`])|\btracking-(?:wide|wider|widest|\[)[^\s"'`]*/g)).toEqual([]);
  });

  it('do not carry raw colors in inline styles', () => {
    expect(matching(components, /style=\{\{[^}]*(?:#[0-9a-f]{3,8}\b|rgba?\()[^}]*\}\}/gi)).toEqual([]);
  });

  it('style every button: a bare <button> has no look under preflight', () => {
    const bare = components.flatMap((file) => [...read(file).matchAll(/<button\b((?:[^>"'{]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\})*)>/g)].filter((match) => !/\bclassName=/.test(match[1]!)).map((match) => `${relative(file)}: ${match[0].slice(0, 60)}`));
    expect(bare).toEqual([]);
  });
});
