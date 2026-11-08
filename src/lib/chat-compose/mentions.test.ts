import { expect, it } from 'vitest';
import { mentionedNames } from './mentions';

it('finds each mention once, lowercased and without the @', () => {
  expect(mentionedNames('Ask @Writer and @map.maker_2, then @writer again')).toEqual(new Set(['writer', 'map.maker_2']));
});

it('finds nothing in a message without mentions', () => {
  expect(mentionedNames('no mention here, or an email at example.com')).toEqual(new Set());
  expect(mentionedNames('')).toEqual(new Set());
});
