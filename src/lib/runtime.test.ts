import { describe, expect, it } from 'vitest';
import { runtimeSchema } from './runtime';
describe('public console runtime configuration', () => {
  const config = {
    schema: 1,
    products: {},
    identity: {
      issuer: 'https://identity.example.com',
      apiPrefix: '/api/oathweave',
      clients: { oathweave: 'hivexui-oathweave' },
    },
  };
  it('accepts public identifiers and rejects credentials, queries and fragments in issuer URLs', () => {
    expect(runtimeSchema.safeParse(config).success).toBe(true);
    for (const issuer of [
      'http://identity.example.com',
      'https://user:password@identity.example.com',
      'https://identity.example.com?secret=obviously-fake',
      'https://identity.example.com#fragment',
    ])
      expect(
        runtimeSchema.safeParse({
          ...config,
          identity: { ...config.identity, issuer },
        }).success,
      ).toBe(false);
  });
  it('rejects infrastructure configuration fields and external API prefixes', () => {
    expect(
      runtimeSchema.safeParse({
        ...config,
        administratorToken: 'obviously-fake-token',
      }).success,
    ).toBe(false);
    expect(
      runtimeSchema.safeParse({
        ...config,
        products: { oathweave: 'https://external.example.com/api' },
      }).success,
    ).toBe(false);
  });
});
