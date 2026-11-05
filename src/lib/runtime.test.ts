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
  it('no longer exposes a Magnus console link, whatever runtime.json holds', async () => {
    const runtime = await import('./runtime');
    expect('magnusConsoleUrl' in runtime).toBe(false);
  });
  it('still accepts links.magnus for one release, because the schema is strict', () => {
    expect(
      runtimeSchema.safeParse({
        ...config,
        links: { magnus: 'https://fleet.example.com' },
      }).success,
    ).toBe(true);
    for (const magnus of [
      'http://fleet.example.com',
      'javascript:alert(1)',
      'https://user:password@fleet.example.com',
      'https://fleet.example.com?token=fake',
      'https://fleet.example.com#fake',
    ])
      expect(
        runtimeSchema.safeParse({ ...config, links: { magnus } }).success,
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

it('accepts magnus as a suite product with its public client', () => {
  expect(
    runtimeSchema.safeParse({
      schema: 1,
      products: { magnus: '/api/magnus' },
      identity: {
        issuer: 'https://identity.example.com',
        apiPrefix: '/api/oathweave',
        clients: { magnus: 'hivexui-magnus' },
      },
    }).success,
  ).toBe(true);
});

it('requires explicit standalone legacy mode and a client for every suite product', () => {
  expect(runtimeSchema.safeParse({ schema: 1, products: {} }).success).toBe(
    false,
  );
  expect(
    runtimeSchema.safeParse({ schema: 1, mode: 'legacy', products: {} })
      .success,
  ).toBe(true);
  expect(
    runtimeSchema.safeParse({
      schema: 1,
      products: { emberpath: '/api/emberpath' },
      identity: {
        issuer: 'https://identity.example.com',
        apiPrefix: '/api/oathweave',
        clients: {},
      },
    }).success,
  ).toBe(false);
});
