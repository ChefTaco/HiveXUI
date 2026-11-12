import { describe, expect, it } from 'vitest';
import { registryConnectionWithCapabilitiesSchema } from './registry-capabilities';

const connection = { id: 'magnus', consolePath: null, browserPrefix: '/api/magnus', nativeApis: {}, documentation: null };

describe('Registry capabilities, until the Registry release ships them', () => {
  it('reads events.v1 and drops keys it does not know', () => {
    const parsed = registryConnectionWithCapabilitiesSchema.parse({ ...connection, capabilities: { 'events.v1': { path: '/api/v1/hive/events' }, 'future.v2': { x: 1 } } });
    expect(parsed.capabilities).toEqual({ 'events.v1': { path: '/api/v1/hive/events' } });
  });
  it('is optional', () => {
    expect(registryConnectionWithCapabilitiesSchema.parse(connection).capabilities).toBeUndefined();
  });
  it('accepts only a same-origin path', () => {
    for (const path of ['https://example.com/events', '/api/../oathweave', 'relative'])
      expect(registryConnectionWithCapabilitiesSchema.safeParse({ ...connection, capabilities: { 'events.v1': { path } } }).success).toBe(false);
  });
});
