import {describe, expect, it} from 'vitest';
import type {Provider} from '../lib/types';
import {providerSchema, providerReadSchema, providerCapabilitySchema, providerRedactedValue, providerWriteErrorCodes} from '@contracts/emberpath-model-admin.generated';
import {formFromProvider, hasStoredSecret, parseProviderModels, providerCredentialProblem, providerFormForWrite, providerModelForWrite, providerOrigin, providerSaveRefusal} from './provider-form';

const capabilities = providerCapabilitySchema.parse({streaming: true, tools: false, supportedRoutes: ['v1.responses'], tags: ['synthetic'],
  inputCostPerMillionTokens: 0, qualityScore: 87, maxContextWindow: 65536});
function readProvider(): Provider {
  return {id: 'provider-fixture', slug: 'synthetic', name: 'Synthetic provider', kind: 'OPENAI_GENERIC',
    baseUrl: 'https://provider.example.com/v1', authMode: 'BEARER', authHeaderName: 'Authorization',
    authSecretMasked: 'masked-only', defaultHeaders: {'x-fixture': 'synthetic'}, capabilities,
    timeoutMs: 120000, maxRetries: 1, concurrency: 16, priority: 100, weight: 100, failoverGroup: null, enabled: true, lastHealthStatus: null, lastHealthError: null, lastHealthAt: null,
    models: [Object.assign({model: 'synthetic-model', displayName: null, maxContextWindow: null, enabled: false,
      capabilityJson: JSON.stringify(capabilities)}, {id: 'row-fixture', providerId: 'provider-fixture',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'}),
      {model: 'named-model', displayName: '', maxContextWindow: 32768, enabled: true, capabilityJson: '{}', id: 'named-row-fixture', providerId: 'provider-fixture', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'}]};
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

describe('stored credentials stay with the server they were entered for', () => {
  // As Emberpath returns it: the secret masked, a credential header hidden, a harmless one shown.
  const hiddenProvider = (): Provider => ({...readProvider(), hasAuthSecret: true,
    defaultHeaders: {'x-api-token': providerRedactedValue, 'anthropic-version': '2023-06-01'}, redactedDefaultHeaders: ['x-api-token']});

  it('round-trips hidden header values as the stand-in and never as a made-up value', () => {
    const provider = hiddenProvider();
    const form = formFromProvider(provider); form.name = 'Renamed provider';
    expect(providerCredentialProblem(provider, form)).toBeNull();
    const write = providerFormForWrite(form);
    expect(write.defaultHeaders).toEqual({'x-api-token': providerRedactedValue, 'anthropic-version': '2023-06-01'});
    expect(write).not.toHaveProperty('authSecret');
    expect(write).not.toHaveProperty('redactedDefaultHeaders'); expect(write).not.toHaveProperty('hasAuthSecret');
  });

  it('allows a path change on the same server without asking for anything', () => {
    const provider = hiddenProvider();
    for (const baseUrl of ['https://provider.example.com/api/v2', 'https://PROVIDER.example.com:443/v1', ' https://provider.example.com/v1 ']) {
      expect(providerCredentialProblem(provider, {...formFromProvider(provider), baseUrl})).toBeNull();
    }
  });

  it.each([
    ['another host', 'https://other.example.net/v1', 'https://other.example.net'],
    ['another port', 'https://provider.example.com:8443/v1', 'https://provider.example.com:8443'],
    ['another scheme', 'http://provider.example.com/v1', 'http://provider.example.com'],
  ])('asks for the secret and the hidden headers again when the base URL moves to %s', (_label, baseUrl, origin) => {
    const provider = hiddenProvider();
    const problem = providerCredentialProblem(provider, {...formFromProvider(provider), baseUrl});
    expect(problem).toMatchObject({secret: true, headers: ['x-api-token']});
    expect(problem?.message).toContain(`different server (${origin})`);
    expect(problem?.message).toContain('(https://provider.example.com)');
    expect(problem?.message).toContain('enter the auth secret again');
    expect(problem?.message).toContain('"x-api-token"');
    expect(problem?.message).not.toContain('masked-only');
  });

  it('is satisfied once the secret is typed and every hidden header is replaced or removed', () => {
    const provider = hiddenProvider();
    const moved = {...formFromProvider(provider), baseUrl: 'https://other.example.net/v1'};
    expect(providerCredentialProblem(provider, {...moved, authSecret: 'synthetic-new-secret'})).toMatchObject({secret: false, headers: ['x-api-token']});
    expect(providerCredentialProblem(provider, {...moved, defaultHeaders: '{"x-api-token":"synthetic-new-header"}'})).toMatchObject({secret: true, headers: []});
    expect(providerCredentialProblem(provider, {...moved, authSecret: 'synthetic-new-secret', defaultHeaders: '{"x-api-token":"synthetic-new-header"}'})).toBeNull();
    expect(providerCredentialProblem(provider, {...moved, authSecret: 'synthetic-new-secret', defaultHeaders: '{"anthropic-version":"2023-06-01"}'})).toBeNull();
    // Auth mode NONE tells Emberpath to discard the stored secret with the move.
    expect(providerCredentialProblem(provider, {...moved, authMode: 'NONE', defaultHeaders: '{}'})).toBeNull();
  });

  it('asks nothing of a provider without stored credentials, and nothing while the address is not a URL yet', () => {
    const open: Provider = {...readProvider(), authSecretMasked: null, hasAuthSecret: false, defaultHeaders: {}, redactedDefaultHeaders: []};
    expect(providerCredentialProblem(open, {...formFromProvider(open), baseUrl: 'https://other.example.net/v1'})).toBeNull();
    const provider = hiddenProvider();
    expect(providerCredentialProblem(provider, {...formFromProvider(provider), baseUrl: 'https://'})).toBeNull();
    expect(providerCredentialProblem(null, {...formFromProvider(provider), baseUrl: 'https://other.example.net/v1', defaultHeaders: '{}'})).toBeNull();
  });

  it('still asks for the secret against an Emberpath that predates hasAuthSecret and shows headers in clear', () => {
    const older = readProvider();
    expect(hasStoredSecret(older)).toBe(true);
    expect(hasStoredSecret({...older, authSecretMasked: null})).toBe(false);
    expect(hasStoredSecret({...older, authSecretMasked: null, hasAuthSecret: true})).toBe(true);
    expect(providerCredentialProblem(older, {...formFromProvider(older), baseUrl: 'https://other.example.net/v1'})).toMatchObject({secret: true, headers: []});
  });

  it('never sends the stand-in for a header that has no stored value', () => {
    const provider = hiddenProvider();
    const form = {...formFromProvider(provider), defaultHeaders: JSON.stringify({'X-Api-Token': providerRedactedValue, 'x-new': providerRedactedValue})};
    const problem = providerCredentialProblem(provider, form);
    expect(problem).toMatchObject({secret: false, headers: ['x-new']});
    expect(problem?.message).toContain('Enter the real value for "x-new"');
    // A new provider, or an Emberpath that hides nothing, stores no value the stand-in could mean.
    expect(providerCredentialProblem(null, {...form, defaultHeaders: JSON.stringify({'x-api-token': providerRedactedValue})})?.headers).toEqual(['x-api-token']);
    expect(providerCredentialProblem(readProvider(), {...form, defaultHeaders: JSON.stringify({'x-fixture': providerRedactedValue})})?.headers).toEqual(['x-fixture']);
  });

  it('sends an OAuth-authorized Codex provider to Authorize Codex instead of asking for a secret', () => {
    const codex: Provider = {...readProvider(), kind: 'CODEX', baseUrl: 'https://chatgpt.example.com/backend-api/codex', hasAuthSecret: true, defaultHeaders: {version: 'hive-router'}, redactedDefaultHeaders: []};
    const problem = providerCredentialProblem(codex, {...formFromProvider(codex), baseUrl: 'https://other.example.net/codex'});
    expect(problem?.message).toContain('Authorize Codex'); expect(problem?.message).not.toContain('enter the auth secret again');
  });

  it('compares scheme, host and port only', () => {
    expect(providerOrigin('https://provider.example.com:443/v1?x=1')).toBe('https://provider.example.com');
    expect(providerOrigin('ftp://provider.example.com')).toBeNull(); expect(providerOrigin('not a url')).toBeNull();
  });

  it('puts Emberpath refusal codes in the words of this page and leaves other errors alone', () => {
    for (const code of Object.values(providerWriteErrorCodes)) expect(providerSaveRefusal(code)).toMatch(/^Emberpath did not save: /);
    expect(providerSaveRefusal(providerWriteErrorCodes.originChangeRequiresSecret)).toContain('different server');
    expect(providerSaveRefusal('conflict')).toBeUndefined(); expect(providerSaveRefusal(undefined)).toBeUndefined();
  });

  it('refuses a base URL with a user name or password before it is sent', () => {
    const provider = hiddenProvider();
    expect(() => providerFormForWrite({...formFromProvider(provider), baseUrl: 'https://operator:synthetic@provider.example.com/v1'})).toThrow();
  });
});
