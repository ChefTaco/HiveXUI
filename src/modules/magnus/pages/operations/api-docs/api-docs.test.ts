import { describe, expect, it } from 'vitest';
import { methodTone, openApiSpecSchema, operationsOf } from './schemas';

describe('the API document', () => {
  const spec = openApiSpecSchema.parse({
    info: { title: 'Fleet', version: '2' },
    paths: {
      '/nodes': { get: { summary: 'List', tags: ['nodes'] }, parameters: [{ name: 'x' }], post: { description: 'Create' } },
      '/odd': { delete: 'not an object' },
    },
  });
  it('lists operations, and ignores keys that are not methods', () => {
    expect(operationsOf(spec).map((operation) => operation.key)).toEqual(['get /nodes', 'post /nodes', 'delete /odd']);
  });
  it('carries what each operation describes, and tolerates a damaged one', () => {
    const [list, create, odd] = operationsOf(spec);
    expect(list).toMatchObject({ summary: 'List', tags: ['nodes'] });
    expect(create).toMatchObject({ description: 'Create', tags: [] });
    expect(odd).toMatchObject({ method: 'delete', path: '/odd', tags: [] });
  });
  it('survives a document with no paths', () => {
    expect(operationsOf(openApiSpecSchema.parse({}))).toEqual([]);
  });
  it('marks writes and deletes', () => {
    expect([methodTone('get'), methodTone('post'), methodTone('delete')]).toEqual(['neutral', 'info', 'danger']);
  });
});
