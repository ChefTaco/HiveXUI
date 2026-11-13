import {expect, it, vi} from 'vitest';
import {createEmberpathApi} from './emberpath-api';
import * as contracts from '@contracts/emberpath-model-admin.generated';
import {apiFailureFromBody} from './api-error';

it('uses native defaults and rejects invalid or unknown writes before transport', async () => {
  const request = vi.fn().mockResolvedValue({data: {id: 'rule', name: 'Fixture', kind: 'SAFETY', priority: 100,
    enabled: true, matchJson: '{}', actionJson: '{}', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'}});
  const api = createEmberpathApi(request);
  await api.createRouteRule({name: 'Fixture', kind: 'SAFETY', matchJson: {}, actionJson: {}});
  expect(request).toHaveBeenCalledExactlyOnceWith('/api/route-rules', {method: 'POST', body: {name: 'Fixture', kind: 'SAFETY', priority: 100, enabled: true, matchJson: {}, actionJson: {}}});
  request.mockClear();
  const invalid = [
    () => api.createRouteRule({name: 'Fixture', kind: 'SAFETY', matchJson: {}, actionJson: {providerIds: 'invalid'}} as never),
    () => api.createHeuristic({name: 'Fixture', category: 'fixture', pattern: 'fixture', actionJson: {action: 'redirect'}} as never),
    () => api.createClientKey({name: 'Fixture', metadata: {unexpected: true}} as never),
    () => api.updateClientKey('fixture', {keyHash: 'obviously-fake-hash'} as never),
    () => api.updateRoutingObjective({goal: 'invalid'} as never),
    () => api.runRoutingTest({modelAlias: '', prompt: 'fixture'}),
    () => api.previewRouting({cases: []}),
    () => api.applyRoutingRevision('fixture', {unexpected: true}),
  ];
  for (const write of invalid) expect(write).toThrow();
  expect(request).not.toHaveBeenCalled();
});

it('parses one-time key shapes precisely and strips unexpected secret fields from ordinary read records', async () => {
  const request = vi.fn().mockResolvedValue({data: {id: 'key', name: 'Fixture', keyPrefix: 'fakekey', apiKey: 'obviously-fake-one-time-key'}});
  const api = createEmberpathApi(request);
  expect(await api.createClientKey({name: 'Fixture'})).toEqual({data: {id: 'key', name: 'Fixture', keyPrefix: 'fakekey', apiKey: 'obviously-fake-one-time-key'}});
  const row = {id: 'key', name: 'Fixture', keyPrefix: 'fakekey', enabled: false, metadataJson: '{"quota":{"dailyRequests":2}}',
    lastUsedAt: null, expiresAt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'};
  request.mockResolvedValue({data: [{...row, keyHash: 'obviously-fake-stored-hash', apiKey: 'obviously-fake-secret'}]});
  expect(await api.clientKeys()).toEqual({data: [row]});
  request.mockResolvedValue({data: {...row, apiKey: 'obviously-fake-replacement-key'}});
  expect((await api.rotateClientKey('unsafe/key')).data.apiKey).toBe('obviously-fake-replacement-key');
  expect(request).toHaveBeenLastCalledWith('/api/client-keys/unsafe%2Fkey/rotate', {method: 'POST'});
});

it('rejects malformed responses on every formerly unchecked console read', async () => {
  const request = vi.fn().mockResolvedValue({data: [{}]});
  const api = createEmberpathApi(request);
  for (const read of [api.providers, api.aliases, api.routeRules, api.heuristics, api.clientKeys, api.telemetry, api.traces, api.audit,
    api.runtimeSettings, api.emberpathMe, api.routingObjective, api.routingRevisions, api.codexOAuthStatus, api.startCodexOAuth, api.docsIndex, api.exportConfig,
    () => api.clientKeyUsage('fixture'), () => api.checkCodexOAuth('fixture')]) await expect(read()).rejects.toThrow();
});

it('preserves quota history and native revision-conflict errors without replaying requests', async () => {
  const conflict = new Error('Routing changed; refresh and preview again');
  const request = vi.fn().mockRejectedValue(conflict);
  const api = createEmberpathApi(request);
  await expect(api.applyRoutingRevision('fixture', {objective: {goal: 'balanced'}})).rejects.toBe(conflict);
  expect(request).toHaveBeenCalledTimes(1);
  request.mockResolvedValue({data: {clientApiKeyId: 'fixture', name: 'Fixture', history: {cutoverAt: 1, historicalCoverage: 'retained-traces-only'},
    daily: [{day: '2026-01-01', requests: 1, tokens: 3, costUsd: null, estimatedRequests: 1}], limits: {dailyRequests: 2},
    usage: {dayRequests: 1, monthRequests: 1, dayTokens: 3, monthTokens: 3}, allowed: true, exceeded: [], warnings: ['dailyRequests']}});
  expect((await api.clientKeyUsage('fixture')).data).toMatchObject({history: {historicalCoverage: 'retained-traces-only'}, warnings: ['dailyRequests']});
});

it('accepts only public authenticated principal fields before storing product permissions', async () => {
  const user = {id: 'fixture', username: 'admin', displayName: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', roles: [], permissions: ['router:providers:read']};
  const request = vi.fn().mockResolvedValue({user: {...user, passwordHash: 'obviously-fake-stored-password-hash'}});
  expect(await createEmberpathApi(request).emberpathMe()).toEqual({user});
});


it('sends metadata-only trace controls through the released key contract', async () => {
  const request = vi.fn().mockResolvedValue({data: {id: 'key', name: 'Fixture', keyPrefix: 'fakekey', apiKey: 'obviously-fake-one-time-key'}});
  const api = createEmberpathApi(request);
  await api.createClientKey({name: 'Fixture', metadata: {tracePrivacy: 'metadata-only', owner: 'fixture', environment: 'test'}});
  expect(request).toHaveBeenCalledExactlyOnceWith('/api/client-keys', {method: 'POST', body: {name: 'Fixture', metadata: {tracePrivacy: 'metadata-only', owner: 'fixture', environment: 'test'}}});
});

it('reads providers from Emberpath with and without the hidden-credential fields, and the import result with and without left-out headers', async () => {
  const older = {id: 'provider', slug: 'fixture', name: 'Fixture', kind: 'OPENAI', baseUrl: 'https://provider.example.com/v1', authMode: 'BEARER',
    authHeaderName: 'Authorization', authSecretMasked: 'masked-only', defaultHeaders: {'x-fixture': 'synthetic'},
    capabilities: {supportedRoutes: ['v1.responses', 'v1.decisions']}, timeoutMs: 120000, maxRetries: 1, concurrency: 16, priority: 100, weight: 100,
    failoverGroup: null, enabled: true, lastHealthStatus: null, lastHealthError: null, lastHealthAt: null, models: []};
  const newer = {...older, hasAuthSecret: true, defaultHeaders: {'x-fixture': contracts.providerRedactedValue}, redactedDefaultHeaders: ['x-fixture']};
  const request = vi.fn().mockResolvedValue({data: [older, newer]});
  const api = createEmberpathApi(request);
  expect((await api.providers()).data).toEqual([older, newer]);
  request.mockResolvedValue({ok: true});
  expect(await api.importConfig({data: {}})).toEqual({ok: true});
  request.mockResolvedValue({ok: true, redactedHeadersNotImported: [{provider: 'fixture', headers: ['x-fixture']}]});
  expect((await api.importConfig({data: {}})).redactedHeadersNotImported).toEqual([{provider: 'fixture', headers: ['x-fixture']}]);
});

it('keeps the code of a refused provider save next to its message', () => {
  const failure = apiFailureFromBody(422, {error: 'The base URL now points to a different server.', code: contracts.providerWriteErrorCodes.originChangeRequiresSecret});
  expect(failure).toMatchObject({code: 'provider_origin_change_requires_secret', remoteMessage: 'The base URL now points to a different server.'});
});
