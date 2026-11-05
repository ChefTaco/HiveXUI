import {describe, expect, it} from 'vitest';
import type {Provider} from '../lib/types';
import {providerSchema, providerReadSchema} from '@contracts/emberpath-model-admin.generated';
import {formFromProvider, parseProviderModels, providerFormForWrite, providerModelForWrite} from './provider-form';

const capabilities = {streaming: true, tools: false, supportedRoutes: ['v1.responses'], tags: ['synthetic'],
  inputCostPerMillionTokens: 0, qualityScore: 87, maxContextWindow: 65536};
function readProvider(): Provider {
  return {id: 'provider-fixture', slug: 'synthetic', name: 'Synthetic provider', kind: 'OPENAI_GENERIC',
    baseUrl: 'https://provider.example.com/v1', authMode: 'BEARER', authHeaderName: 'Authorization',
    authSecretMasked: 'masked-only', defaultHeaders: {'x-fixture': 'synthetic'}, capabilities,
    timeoutMs: 120000, maxRetries: 1, concurrency: 16, priority: 100, weight: 100, failoverGroup: null, enabled: true,
    models: [Object.assign({model: 'synthetic-model', displayName: null, maxContextWindow: null, enabled: false,
      capabilityJson: JSON.stringify(capabilities)}, {id: 'row-fixture', providerId: 'provider-fixture',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'}),
      {model: 'named-model', displayName: '', maxContextWindow: 32768, enabled: true, capabilityJson: '{}'}]};
}

describe('provider read DTO to edit request', () => {
  it('renames a sanitized provider while preserving every writable model field and keeping its credential unchanged', () => {
    const provider = readProvider(), before = structuredClone(provider);
    const form = formFromProvider(provider); form.name = 'Renamed provider';
    const write = providerFormForWrite(form);
    expect(providerSchema.parse(write)).toEqual(write);
    expect(write).not.toHaveProperty('authSecret');
    expect(write).not.toHaveProperty('authSecretMasked');
    expect(write.models).toEqual([
      {model: 'synthetic-model', enabled: false, capabilityJson: capabilities},
      {model: 'named-model', displayName: '', maxContextWindow: 32768, enabled: true, capabilityJson: {}},
    ]);
    expect(write).toMatchObject({name: 'Renamed provider', defaultHeaders: provider.defaultHeaders, capabilities});
    expect(provider).toEqual(before);
    for (const model of write.models) {
      for (const field of ['id', 'providerId', 'createdAt', 'updatedAt']) expect(model).not.toHaveProperty(field);
    }
  });

  it('round-trips the complete native read DTO through the owned write validator', () => {
    const fixture = readProvider();
    const read = providerReadSchema.parse({...fixture, lastHealthStatus: null, lastHealthError: null, lastHealthAt: null,
      models: fixture.models.map((model, index) => ({...model, id: 'row-' + index, providerId: fixture.id,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'}))});
    const form = formFromProvider(read); form.name = 'Changed name';
    const written = providerSchema.parse(providerFormForWrite(form));
    expect(written.name).toBe('Changed name');
    expect(written.models[0]).toMatchObject({model: 'synthetic-model', enabled: false, capabilityJson: capabilities});
    expect(written).not.toHaveProperty('authSecret');
  });

  it('refuses malformed and non-object stored capability JSON with an actionable error instead of silently discarding it', () => {
    for (const capabilityJson of ['{', 'null', '[]', '"invalid"', 'false']) {
      expect(() => providerModelForWrite({model: 'synthetic-model', capabilityJson})).toThrow(/synthetic-model.*invalid capability JSON.*repair/);
    }
    expect(providerModelForWrite({model: 'no-overrides'})).toEqual({model: 'no-overrides', enabled: true, capabilityJson: {}});
    expect(providerModelForWrite({model: 'native-null', capabilityJson: null})).toEqual({model: 'native-null', enabled: true, capabilityJson: {}});
  });

  it('rejects read-only fields, nulls and invalid native model writes before submitting an edited JSON array', () => {
    for (const row of [{model: 'fixture', id: 'row'}, {model: 'fixture', displayName: null},
      {model: 'fixture', maxContextWindow: 0}, {model: 'fixture', capabilityJson: '{}'}, {model: ''}]) {
      expect(() => parseProviderModels(JSON.stringify([row]))).toThrow();
    }
  });
});
