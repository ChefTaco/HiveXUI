import { describe, expect, it } from 'vitest';
import { displayNameOf, fileBlob, formatBytes, imageSource, isCategoryColor, isDeployable, isEditableText, mimeLabel, mimeOptionsFor, readsAsText, SKILL_MIME, splitTags, uploadMimeType } from './logic';

describe('uploads', () => {
  it('gives a type to the files browsers report without one', () => {
    expect(uploadMimeType('SOUL.md', '')).toBe('text/markdown');
    expect(uploadMimeType('a.YAML', '')).toBe('text/plain');
    expect(uploadMimeType('a.yaml', 'application/yaml')).toBe('text/plain');
    expect(uploadMimeType('a.md', 'text/markdown')).toBe('text/markdown');
    expect(uploadMimeType('b.bin', '')).toBe('application/octet-stream');
    expect(uploadMimeType('c.png', 'image/png')).toBe('image/png');
  });
  it('reads text as text and anything else as base64', () => {
    expect(readsAsText('a.md', '')).toBe(true);
    expect(readsAsText('a.txt', 'text/plain')).toBe(true);
    expect(readsAsText('a.png', 'image/png')).toBe(false);
  });
  it('names a file after its stem', () => {
    expect(displayNameOf('SOUL.md')).toBe('SOUL');
    expect(displayNameOf('a.b.c')).toBe('a.b');
  });
  it('splits tags', () => {
    expect(splitTags(' a, b ,,c ')).toEqual(['a', 'b', 'c']);
  });
});

describe('the edit form', () => {
  it('keeps a type it does not list, so saving never changes it silently', () => {
    expect(mimeOptionsFor('text/plain').some((option) => option.value === SKILL_MIME)).toBe(false);
    expect(mimeOptionsFor(SKILL_MIME).at(-1)).toEqual({ value: SKILL_MIME, label: 'Skill' });
  });
  it('edits only text', () => {
    expect(isEditableText('text/markdown')).toBe(true);
    expect(isEditableText('application/json')).toBe(true);
    expect(isEditableText('image/png')).toBe(false);
  });
  it('offers deploy only for skills and cron jobs', () => {
    expect(isDeployable(SKILL_MIME)).toBe(true);
    expect(isDeployable('application/x-magnus-cronjob')).toBe(true);
    expect(isDeployable('text/plain')).toBe(false);
  });
});

describe('downloads', () => {
  const text = (blob: Blob) => blob.text();
  it('saves text as it is, including a skill, which the old console tried to decode as base64', async () => {
    expect(await text(fileBlob('# hello', 'text/markdown'))).toBe('# hello');
    expect(await text(fileBlob('{"manifest":{}}', SKILL_MIME))).toBe('{"manifest":{}}');
  });
  it('decodes binary content', async () => {
    expect(await text(fileBlob(btoa('binary!'), 'application/pdf'))).toBe('binary!');
  });
  it('saves content that is not valid base64 as it is', async () => {
    expect(await text(fileBlob('key: value #', 'application/octet-stream'))).toBe('key: value #');
  });
});

describe('colors and images', () => {
  it('accepts only hex colors, since they reach an inline style', () => {
    expect(isCategoryColor('#6366f1')).toBe(true);
    expect(isCategoryColor('#abc')).toBe(true);
    for (const value of ['red', 'url(x)', '#12', 'var(--accent)', '']) expect(isCategoryColor(value)).toBe(false);
  });
  it('builds a data URL, and refuses to pass through one that is not an image', () => {
    expect(imageSource('QUJD', 'image/png')).toBe('data:image/png;base64,QUJD');
    expect(imageSource('data:image/png;base64,QUJD', 'image/png')).toBe('data:image/png;base64,QUJD');
    expect(imageSource('data:text/html,x', 'image/png')).toBe('data:image/png;base64,data:text/html,x');
  });
});

describe('labels', () => {
  it('labels types and sizes', () => {
    expect(mimeLabel('text/markdown')).toBe('Markdown');
    expect(mimeLabel('application/x-custom')).toBe('X-CUSTOM');
    expect(formatBytes(12)).toBe('12 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MB');
  });
});
