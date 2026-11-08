// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { anchorLabel, findRendered, imageAnchor, locateQuote, pdfAnchor, regionFromPoints, renderedQuote, svgViewBox, textAnchor, textOffset } from './anchors';

const SHA = 'f'.repeat(64);

describe('text anchors', () => {
  it('quote the source exactly at their offsets, in either selection direction', () => {
    const source = 'The bridge creaks.';
    expect(textAnchor(source, 4, 10, SHA)).toEqual({ kind: 'text', start: 4, end: 10, quote: 'bridge', source_sha256: SHA });
    expect(textAnchor(source, 10, 4, SHA)?.quote).toBe('bridge');
    expect(textAnchor(source, 3, 3, SHA)).toBeNull();
  });

  it('count UTF-16 units, as the service does', () => {
    const source = 'Map 🗺️ of the archive';
    const start = source.indexOf('of');
    expect(textAnchor(source, start, start + 2, SHA)).toMatchObject({ start: 8, end: 10, quote: 'of' });
  });

  it('read a plain-text selection offset from the rendered text', () => {
    const pre = document.createElement('pre');
    pre.textContent = 'line one\nline two';
    expect(textOffset(pre, pre.firstChild!, 9)).toBe(9);
  });
});

describe('Markdown offsets', () => {
  const source = '# Sunken Archive\n\nThe **old** bridge creaks over the [dark water](https://example.com/water).\n\nThe bridge holds.\n';
  const block = { start: source.indexOf('The **old**'), end: source.indexOf('.\n\nThe bridge holds') + 1 };

  it('finds plain rendered text at its source offsets', () => {
    const at = locateQuote(source, block.start, block.end, 'creaks over');
    expect(at && source.slice(at.start, at.end)).toBe('creaks over');
  });

  it('maps a selection across emphasis back to the source, markup included', () => {
    const at = locateQuote(source, block.start, block.end, 'old bridge');
    expect(at && source.slice(at.start, at.end)).toBe('old** bridge');
    const anchor = textAnchor(source, at!.start, at!.end, SHA)!;
    expect(source.slice(anchor.start, anchor.end)).toBe(anchor.quote);
  });

  it('skips a link target that does not render', () => {
    const at = locateQuote(source, block.start, block.end, 'dark water.');
    expect(at && source.slice(at.start, at.end)).toBe('dark water](https://example.com/water).');
  });

  it('chooses between repeats by where the selection sat', () => {
    const repeated = 'bridge, then a bridge, then the last bridge';
    const first = locateQuote(repeated, 0, repeated.length, 'bridge', 0);
    const last = locateQuote(repeated, 0, repeated.length, 'bridge', 0.95);
    expect(first?.start).toBe(0);
    expect(last?.start).toBe(repeated.lastIndexOf('bridge'));
  });

  it('stays inside the block it was given', () => {
    const second = { start: source.indexOf('The bridge holds'), end: source.length };
    expect(locateQuote(source, second.start, second.end, 'bridge')?.start).toBe(second.start + 4);
    expect(locateQuote(source, second.start, second.end, 'creaks')).toBeNull();
  });

  it('finds a stored quote again in the rendered text, to mark it', () => {
    expect(renderedQuote('old** bridge')).toBe('old bridge');
    expect(renderedQuote('dark water](https://example.com/water).')).toBe('dark water.');
    const rendered = 'The old bridge\ncreaks over the dark water.';
    expect(findRendered(rendered, 'bridge creaks')).toEqual({ start: 8, end: 21 });
  });
});

describe('image regions', () => {
  const box = { left: 100, top: 50, width: 400, height: 200 };

  it('normalize a drag in any direction to the image', () => {
    expect(regionFromPoints({ x: 300, y: 150 }, { x: 200, y: 100 }, box)).toEqual({ x: 0.25, y: 0.25, w: 0.25, h: 0.25 });
  });

  it('clamp a drag that leaves the image, and ignore a click', () => {
    expect(regionFromPoints({ x: 400, y: 200 }, { x: 900, y: 900 }, box)).toEqual({ x: 0.75, y: 0.75, w: 0.25, h: 0.25 });
    expect(regionFromPoints({ x: 200, y: 100 }, { x: 201, y: 101 }, box)).toBeNull();
  });

  it('carry SVG viewBox coordinates when the source has them', () => {
    expect(svgViewBox('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 400 200"><rect/></svg>')).toEqual({ x: 10, y: 20, w: 400, h: 200 });
    expect(svgViewBox('<svg width="640px" height="480"></svg>')).toEqual({ x: 0, y: 0, w: 640, h: 480 });
    expect(svgViewBox('<svg></svg>')).toBeNull();
    expect(imageAnchor({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, { x: 10, y: 20, w: 400, h: 200 })).toEqual({ kind: 'image', x: 0.25, y: 0.5, w: 0.5, h: 0.25, viewbox: { x: 110, y: 120, w: 200, h: 50 } });
    expect(imageAnchor({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 })).toEqual({ kind: 'image', x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
  });
});

describe('PDF anchors and labels', () => {
  it('hold a page with a quote or a rectangle', () => {
    expect(pdfAnchor(3, { quote: '  Bestiary  ' })).toEqual({ kind: 'pdf', page: 3, quote: 'Bestiary' });
    expect(pdfAnchor(2, { rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } })).toEqual({ kind: 'pdf', page: 2, rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } });
  });

  it('describe every anchor kind in a few words', () => {
    expect(anchorLabel({ kind: 'text', start: 0, end: 6, quote: 'bridge', source_sha256: SHA })).toBe('“bridge”');
    expect(anchorLabel({ kind: 'docx', paragraph_id: 'p-4', start: 0, end: 3, quote: 'The' })).toBe('¶ “The”');
    expect(anchorLabel({ kind: 'pdf', page: 3 })).toBe('Page 3');
    expect(anchorLabel({ kind: 'image', x: 0.1, y: 0.2, w: 0.3, h: 0.4 })).toBe('Region at 10%, 20% · 30% × 40%');
    expect(anchorLabel({ kind: 'file' })).toBe('Whole file');
  });
});
