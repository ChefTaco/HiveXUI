import { describe, expect, it } from 'vitest';
import { completeMention, mentionAtCaret, mentionedNames } from './mentions';

it('finds each mention once, lowercased and without the @', () => {
  expect(mentionedNames('Ask @Writer and @map.maker_2, then @writer again')).toEqual(new Set(['writer', 'map.maker_2']));
});

it('finds nothing in a message without mentions', () => {
  expect(mentionedNames('no mention here, or an email at example.com')).toEqual(new Set());
  expect(mentionedNames('')).toEqual(new Set());
});

describe('mention autocomplete', () => {
  it('finds the mention being typed at the caret, and nothing inside a word or an address', () => {
    expect(mentionAtCaret('Ask @wor', 8)).toEqual({ start: 4, query: 'wor' });
    expect(mentionAtCaret('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionAtCaret('(@Lead', 6)).toEqual({ start: 1, query: 'lead' });
    expect(mentionAtCaret('mail me@example', 15)).toBeNull();
    expect(mentionAtCaret('Ask @world now', 14)).toBeNull();
  });

  it('completes the mention in place, keeping the text after the caret', () => {
    expect(completeMention('Ask @wo please', 7, 4, 'world')).toEqual({ draft: 'Ask @world please', caret: 11 });
    expect(completeMention('@', 1, 0, 'lead')).toEqual({ draft: '@lead ', caret: 6 });
  });
});
