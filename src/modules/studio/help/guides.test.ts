import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STUDIO_GUIDES } from './guides';

describe('the guide text', () => {
  it('names only keys that docs/STUDIO.md documents', () => {
    const doc = readFileSync(new URL('../../../../docs/STUDIO.md', import.meta.url), 'utf8');
    const keyboard = doc.slice(doc.indexOf('## Keyboard'), doc.indexOf('## Accessibility'));
    const rows = new Set([...keyboard.matchAll(/^\| ([^|]+?) \|/gm)].map((match) => match[1]!));
    const named = Object.values(STUDIO_GUIDES).flatMap((guide) => guide.sections.flatMap((section) => section.keys ?? []).map((item) => item.keys));
    expect(named.length).toBeGreaterThan(0);
    for (const keys of named) expect(rows, keys).toContain(keys);
  });

  it('has a guide section in docs/STUDIO.md for every area', () => {
    const doc = readFileSync(new URL('../../../../docs/STUDIO.md', import.meta.url), 'utf8');
    for (const heading of ['## Projects', '## Team Assignment', '## Conversation Room', '## Agent Studio', '## Review']) expect(doc).toContain(`\n${heading}\n`);
  });
});
