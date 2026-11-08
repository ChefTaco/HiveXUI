import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tokensSource = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

type Rgb = readonly [number, number, number, number];

function block(selector: string): Map<string, string> {
  const start = tokensSource.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing ${selector}`);
  const body = tokensSource.slice(start, tokensSource.indexOf('\n}', start));
  const tokens = new Map<string, string>();
  for (const match of body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) tokens.set(match[1]!, match[2]!.trim());
  return tokens;
}

const tokens = block(':root');

function parse(value: string): Rgb {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (hex) return [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16), 1];
  const rgb = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), Number(rgb[4])];
  throw new Error(`Unparseable color ${value}`);
}
function over(top: Rgb, under: Rgb): Rgb {
  const alpha = top[3];
  return [0, 1, 2].map((i) => top[i]! * alpha + under[i]! * (1 - alpha)).concat(1) as unknown as Rgb;
}
function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SOLID = ['--surface-sunken', '--surface-page', '--surface', '--surface-raised', '--surface-hover'];
const STATUS = ['--success', '--warning', '--danger', '--info', '--signal'];

describe('theme contrast', () => {
  const color = (name: string) => parse(tokens.get(name)!);
  it.each(SOLID.flatMap((surface) => ['--text-strong', '--text', '--text-muted'].map((text) => [text, surface] as const)))('%s on %s is AA', (text, surface) => {
    expect(contrast(color(text), color(surface))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(['--surface-page', '--surface', '--surface-raised', '--surface-hover'].flatMap((surface) => ['--accent', ...STATUS].map((text) => [text, surface] as const)))('%s text on %s is AA', (text, surface) => {
    expect(contrast(color(text), color(surface))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(['--surface', '--surface-raised', '--surface-page'].flatMap((surface) => ['--accent', ...STATUS].map((tone) => [tone, surface] as const)))('%s text on its tint over %s is AA', (tone, surface) => {
    expect(contrast(color(tone), over(color(`${tone}-soft`), color(surface)))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(['--text', '--text-strong'].flatMap((text) => ['--accent', ...STATUS].map((tone) => [text, tone] as const)))('%s on the %s tint is AA', (text, tone) => {
    expect(contrast(color(text), over(color(`${tone}-soft`), color('--surface')))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(['--accent', ...STATUS])('label on solid %s is AA', (tone) => {
    expect(contrast(color(`--on-${tone.slice(2)}`), color(tone))).toBeGreaterThanOrEqual(4.5);
  });
  it('labels on the hovered accent stay AA', () => {
    expect(contrast(color('--on-accent'), color('--accent-hover'))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(['--surface-page', '--surface', '--surface-raised', '--surface-hover'].flatMap((surface) => [1, 2, 3, 4, 5, 6].map((index) => [`--persona-${index}`, surface] as const)))('portrait color %s stands out on %s', (persona, surface) => {
    expect(contrast(color(persona), color(surface))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(['--surface-page', '--surface', '--surface-raised'])('control outlines and focus reach 3:1 on %s', (surface) => {
    expect(contrast(color('--border-strong'), color(surface))).toBeGreaterThanOrEqual(3);
    expect(contrast(color('--focus'), color(surface))).toBeGreaterThanOrEqual(3);
  });
});

describe('the theme', () => {
  it('stops motion for people who ask for reduced motion', () => {
    const base = readFileSync(new URL('./base.css', import.meta.url), 'utf8');
    expect(base).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none !important/);
  });
  it('is one set of tokens, dark whatever the operating system prefers', () => {
    expect(tokensSource.match(/:root\b/g)).toHaveLength(1);
    expect(tokensSource).not.toMatch(/prefers-color-scheme|data-theme/);
    expect(tokensSource).toMatch(/^\s*color-scheme: dark;$/m);
  });
  it('uses meaning, not hue, for every token name', () => {
    const hue = /amber|teal|coral|sky|violet|red|green|blue|gold|cyan|magenta|neon/;
    expect([...tokens.keys()].filter((name) => hue.test(name))).toEqual([]);
  });
});
