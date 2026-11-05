import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ suite: true, installation: undefined as string | undefined, fetch: vi.fn() }));
vi.mock('./runtime', () => ({ browserIdentity: () => mocks.suite ? {} : undefined, enrollmentInstallationId: () => mocks.installation }));
vi.mock('./transport', () => ({ apiFetch: mocks.fetch, clearAccess: vi.fn() }));
const { adminApi } = await import('./api');
const result = { ok: true, actorId: 'fixture-agent', action: 'rotate', operationId: 'fixture-operation', identifiers: { routerClientKeyId: 'fixture-router' }, secrets: { routerApiKey: 'obviously-fake-key' }, steps: [{ service: 'emberpath', state: 'completed', status: 200, ok: true }], receiptExpiresAt: null, remediation: null };
afterEach(() => { mocks.fetch.mockReset(); mocks.suite = true; mocks.installation = undefined; });
it('sends suite enrollment to Oathweave and never submits browser-provided resource identifiers for lifecycle operations', async () => {
 mocks.fetch.mockResolvedValue(Response.json(result));
 await adminApi.rotateHiveActor('fixture-agent', { operationId: 'fixture-operation', identifiers: { routerClientKeyId: 'untrusted-resource' }, label: 'Untrusted label' });
 expect(mocks.fetch).toHaveBeenCalledWith('/api/iam/enrollments/fixture-agent/rotate', expect.objectContaining({ method: 'POST', body: JSON.stringify({ operationId: 'fixture-operation' }) }));
 mocks.fetch.mockResolvedValue(Response.json(result));
 await adminApi.resumeHiveActor('fixture-agent', 'fixture-operation');
 expect(mocks.fetch).toHaveBeenLastCalledWith('/api/iam/enrollments/fixture-agent/operations/fixture-operation/resume', expect.objectContaining({ method: 'POST' }));
});
it('validates owned resource contracts and keeps retained standalone coordinator compatibility', async () => {
 mocks.fetch.mockResolvedValue(Response.json({ installationId: 'fixture-installation', data: [{ id: 'fixture-agent', kind: 'service-account', label: 'Fixture Actor', status: 'active', sources: [], identifiers: {}, capabilities: [], linkedResourceCount: 0, lastActivityAt: null, enrollmentStatus: 'partial', credentialExpiresAt: null, latestOperation: { id: 'fixture-operation', action: 'enroll', status: 'partial' } }] }));
 expect((await adminApi.hiveActors()).data[0]?.id).toBe('fixture-agent');
 expect(mocks.fetch).toHaveBeenCalledWith('/api/iam/enrollments', expect.anything());
 mocks.fetch.mockResolvedValue(Response.json({ ...result, secrets: { routerApiKey: 42 } }));
 await expect(adminApi.recoverHiveActorOperation('fixture-agent', 'fixture-operation')).rejects.toThrow();
 mocks.suite = false; mocks.fetch.mockResolvedValue(Response.json({ data: [] }));
 await adminApi.hiveActors(); expect(mocks.fetch).toHaveBeenLastCalledWith('/api/hive/actors', expect.anything());
});

it('binds every mutation and recovery request to the explicitly selected installation namespace', async () => {
 mocks.installation = 'installation-two'; mocks.fetch.mockResolvedValue(Response.json(result));
 await adminApi.rotateHiveActor('fixture-agent', { operationId: 'fixture-operation' });
 expect(mocks.fetch).toHaveBeenCalledWith('/api/iam/enrollments/fixture-agent/rotate?installationId=installation-two', expect.anything());
 mocks.fetch.mockResolvedValue(Response.json({ ...result, secrets: {} }));
 await adminApi.recoverHiveActorOperation('fixture-agent', 'fixture-operation');
 expect(mocks.fetch).toHaveBeenLastCalledWith('/api/iam/enrollments/fixture-agent/operations/fixture-operation?installationId=installation-two', expect.anything());
});
