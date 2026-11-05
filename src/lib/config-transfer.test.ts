import {expect, it} from 'vitest';
import {configImportSchema} from '@contracts/emberpath-model-admin.generated';

it('accepts the published native version-1 export envelope and known read metadata without changing its values', () => {
  const archive = {version: 1, exportedAt: '2026-01-01T00:00:00Z', data: {
    providers: [{id: 'source-provider', slug: 'fixture', name: 'Fixture', kind: 'OPENAI_GENERIC', baseUrl: 'https://provider.example.com/v1',
      passthroughJson: '["/fixture"]', capabilityJson: null, lastHealthStatus: null, lastHealthAt: null, lastHealthError: null,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      models: [{id: 'source-model', providerId: 'source-provider', model: 'fixture-model', displayName: null, maxContextWindow: null,
        capabilityJson: null, enabled: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'}]}],
    aliases: [{id: 'source-alias', alias: 'fixture-alias', providerId: 'source-provider', upstreamModel: 'fixture-model', enabled: false}],
    routeRules: [{name: 'Fixture routing', kind: 'PROVIDER_PREFERENCE', matchJson: '{}', actionJson: '{"providerIds":["source-provider"]}'}],
    heuristicRules: [], runtimeSettings: [{key: 'fixture.setting', valueJson: '{ "synthetic": true }'}],
  }};
  expect(configImportSchema.parse(archive)).toEqual(archive);
  expect(configImportSchema.parse({data: archive.data})).toEqual({data: archive.data});
  expect(() => configImportSchema.parse({...archive, version: 2})).toThrow();
  expect(() => configImportSchema.parse({...archive, unexpectedOption: true})).toThrow();
  expect(() => configImportSchema.parse({data: {providers: [{...archive.data.providers[0], unknownOption: true}]}})).toThrow();
  expect(() => configImportSchema.parse({data: {providers: [{...archive.data.providers[0], capabilityJson: '{'}]}})).toThrow();
});
