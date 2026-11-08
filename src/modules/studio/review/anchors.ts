// Comment anchors, from what the reviewer selected to what the service stores (§3.5). Pure, so the
// offset and region rules are tested without a browser. A text anchor quotes the revision's own
// source exactly: the service rejects a quote that differs from the bytes at those offsets.
import type { CommentAnchor } from './api';

export type TextAnchor = Extract<CommentAnchor, { kind: 'text' }>;
export type ImageAnchor = Extract<CommentAnchor, { kind: 'image' }>;
export type PdfAnchor = Extract<CommentAnchor, { kind: 'pdf' }>;
export type DocxAnchor = Extract<CommentAnchor, { kind: 'docx' }>;
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface ViewBox extends Region {}

const QUOTE_LIMIT = 4000;
/** Characters Markdown uses for emphasis, code, links and strikethrough, which render as nothing. */
const MARKUP = /[*_`~[\]\\]/;

export function textAnchor(source: string, start: number, end: number, sha256: string): TextAnchor | null {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(source.length, Math.max(start, end));
  if (to <= from || to - from > QUOTE_LIMIT) return null;
  return { kind: 'text', start: from, end: to, quote: source.slice(from, to), source_sha256: sha256 };
}

/** Every place `quote` occurs in `text`, allowing Markdown markup between its characters. */
function matches(text: string, quote: string): Array<{ start: number; end: number }> {
  const found: Array<{ start: number; end: number }> = [];
  for (let at = text.indexOf(quote); at >= 0; at = text.indexOf(quote, at + 1)) found.push({ start: at, end: at + quote.length });
  if (found.length) return found;
  const wanted = quote.replace(/\s+/g, ' ').trim();
  if (!wanted) return found;
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== wanted[0]) continue;
    let index = start;
    let matched = 0;
    while (matched < wanted.length && index < text.length) {
      const want = wanted[matched]!;
      const have = text[index]!;
      if (have === want && want !== ' ') {
        index += 1;
        matched += 1;
      } else if (want === ' ' && /\s/.test(have)) {
        while (index < text.length && /\s/.test(text[index]!)) index += 1;
        matched += 1;
      } else if (have === ']' && text[index + 1] === '(') {
        // A link's target is not rendered: skip "](…)".
        const close = text.indexOf(')', index + 2);
        if (close < 0) break;
        index = close + 1;
      } else if (MARKUP.test(have)) {
        index += 1;
      } else break;
    }
    if (matched === wanted.length) found.push({ start, end: index });
  }
  return found;
}

/**
 * Where a quote selected in rendered Markdown sits in the source block it came from. `hint` is the
 * selection's position within the block's rendered text (0 to 1), to choose between repeats.
 */
export function locateQuote(source: string, blockStart: number, blockEnd: number, quote: string, hint = 0): { start: number; end: number } | null {
  const block = source.slice(blockStart, blockEnd);
  const candidates = matches(block, quote.trim());
  if (!candidates.length) return null;
  const target = hint * block.length;
  const best = candidates.reduce((closest, item) => (Math.abs(item.start - target) < Math.abs(closest.start - target) ? item : closest));
  return { start: blockStart + best.start, end: blockStart + best.end };
}

/** A selection's offset in the text of `root`, which renders the source unchanged (plain text). */
export function textOffset(root: Node, node: Node, offset: number): number {
  const range = (root.ownerDocument ?? document).createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;
const clamp = (value: number) => Math.min(1, Math.max(0, value));
/** Drags shorter than this, as a fraction of the image, are clicks. */
export const MIN_REGION = 0.01;

/** The normalized rectangle between two pointer positions over a box, kept inside it. */
export function regionFromPoints(a: { x: number; y: number }, b: { x: number; y: number }, box: { left: number; top: number; width: number; height: number }): Region | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const x1 = clamp((a.x - box.left) / box.width);
  const x2 = clamp((b.x - box.left) / box.width);
  const y1 = clamp((a.y - box.top) / box.height);
  const y2 = clamp((b.y - box.top) / box.height);
  const x = round(Math.min(x1, x2));
  const y = round(Math.min(y1, y2));
  const w = round(Math.min(Math.abs(x2 - x1), 1 - x));
  const h = round(Math.min(Math.abs(y2 - y1), 1 - y));
  return w < MIN_REGION || h < MIN_REGION ? null : { x, y, w, h };
}

/** The root viewBox of an SVG document's source, else its numeric width and height. Never renders it. */
export function svgViewBox(source: string): ViewBox | null {
  const tag = /<svg\b[^>]*>/i.exec(source)?.[0];
  if (!tag) return null;
  const attribute = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
  const box = attribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (box && box.length === 4 && box.every(Number.isFinite) && box[2]! > 0 && box[3]! > 0) return { x: box[0]!, y: box[1]!, w: box[2]!, h: box[3]! };
  const width = Number.parseFloat(attribute('width') ?? '');
  const height = Number.parseFloat(attribute('height') ?? '');
  return width > 0 && height > 0 ? { x: 0, y: 0, w: width, h: height } : null;
}

export function imageAnchor(region: Region, viewBox?: ViewBox | null): ImageAnchor {
  return {
    kind: 'image',
    ...region,
    ...(viewBox ? { viewbox: { x: round(viewBox.x + region.x * viewBox.w), y: round(viewBox.y + region.y * viewBox.h), w: round(region.w * viewBox.w), h: round(region.h * viewBox.h) } } : {}),
  };
}

export function pdfAnchor(page: number, extra: { rect?: Region | null; quote?: string | null } = {}): PdfAnchor {
  const quote = extra.quote?.trim().slice(0, QUOTE_LIMIT);
  return { kind: 'pdf', page, ...(extra.rect ? { rect: extra.rect } : {}), ...(quote ? { quote } : {}) };
}

const percent = (value: number) => `${Math.round(value * 100)}%`;
const excerpt = (text: string, length = 60) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
};

/** Where a comment points, in a few words for its card. */
export function anchorLabel(anchor: CommentAnchor): string {
  switch (anchor.kind) {
    case 'text':
      return `“${excerpt(anchor.quote)}”`;
    case 'docx':
      return `¶ “${excerpt(anchor.quote)}”`;
    case 'pdf':
      return `Page ${anchor.page}${anchor.quote ? ` · “${excerpt(anchor.quote)}”` : anchor.rect ? ` · region ${percent(anchor.rect.w)} × ${percent(anchor.rect.h)}` : ''}`;
    case 'image':
      return `Region at ${percent(anchor.x)}, ${percent(anchor.y)} · ${percent(anchor.w)} × ${percent(anchor.h)}`;
    case 'file':
      return 'Whole file';
  }
}

/** A source quote as Markdown renders it: link targets and markup characters removed. */
export const renderedQuote = (quote: string): string => quote.replace(/\]\([^)]*\)/g, '').replace(/[*_`~[\]\\]/g, '');

/** Where `quote` appears in rendered text, comparing with whitespace runs collapsed. */
export function findRendered(text: string, quote: string): { start: number; end: number } | null {
  const map: number[] = [];
  let flat = '';
  for (let index = 0; index < text.length; index += 1) {
    const space = /\s/.test(text[index]!);
    if (space && flat.endsWith(' ')) continue;
    flat += space ? ' ' : text[index];
    map.push(index);
  }
  const wanted = quote.replace(/\s+/g, ' ').trim();
  const at = wanted ? flat.indexOf(wanted) : -1;
  if (at < 0) return null;
  return { start: map[at]!, end: map[at + wanted.length - 1]! + 1 };
}
