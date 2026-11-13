import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccess, configureEndpoint } from '../../../../../lib/transport';
import { MagnusApiError, MagnusContractError } from '../../../api/errors';
import { stubApi, type RecordedRequest } from '../../../test-dom';
import { approvePendingBinding, checkDowngrade, decisionErrorMessage, downgradeErrorMessage, keyActionErrorMessage, listNodeKeys, listPendingBindings, readCredentialSummary, reasonBody, rejectPendingBinding, resetNodeKeys, revokeNodeKeys } from './api';
import { binding, nodeKey, resetResult, revokeResult, summary } from './fixtures';

const ok = (data: unknown) => ({ success: true, data });
const fail = (status: number, code: string, message: string) => Response.json({ success: false, error: { code, message } }, { status });

function serve(route: (request: RecordedRequest) => unknown) {
  const stub = stubApi(route);
  vi.stubGlobal('fetch', stub.request);
  return stub;
}

beforeEach(() => configureEndpoint('magnus', '/api/magnus'));
afterEach(() => {
  clearAccess();
  vi.unstubAllGlobals();
});

describe('the fleet summary', () => {
  it('reads GET /node-credentials/summary through the contract', async () => {
    const stub = serve(({ path }) => (path === '/node-credentials/summary' ? ok(summary()) : undefined));
    const data = await readCredentialSummary();
    expect(data?.mode).toBe('warn');
    expect(data?.blockers.map((blocker) => blocker.code)).toEqual(['NODES_WITHOUT_KEY', 'PENDING_BINDINGS']);
    expect(stub.requests.map((request) => request.path)).toEqual(['/node-credentials/summary']);
  });
  it('reads a 404 from an older Magnus as no feature, not as a failure', async () => {
    serve(() => undefined);
    await expect(readCredentialSummary()).resolves.toBeNull();
  });
  it('still fails on any other refusal', async () => {
    serve(() => fail(403, 'FORBIDDEN', 'Insufficient permissions'));
    await expect(readCredentialSummary()).rejects.toBeInstanceOf(MagnusApiError);
  });
});

describe('pending bindings', () => {
  it('lists only the waiting ones, for one node when asked', async () => {
    const stub = serve(({ path }) => (path.startsWith('/node-credentials/pending-bindings') ? ok([binding()]) : undefined));
    expect(await listPendingBindings()).toHaveLength(1);
    expect(await listPendingBindings({ nodeId: 'node 2' })).toHaveLength(1);
    expect(stub.requests.map((request) => request.path)).toEqual(['/node-credentials/pending-bindings?status=PENDING', '/node-credentials/pending-bindings?status=PENDING&nodeId=node+2']);
  });
  it('approves with an empty body and rejects with an optional, trimmed reason', async () => {
    const stub = serve(({ method, path }) => (method === 'POST' ? ok(binding({ status: path.endsWith('/approve') ? 'APPROVED' : 'REJECTED' })) : undefined));
    expect((await approvePendingBinding('pb-1')).status).toBe('APPROVED');
    // An id that would change the path is refused before anything is sent.
    await expect(approvePendingBinding('../pb-1')).rejects.toThrow();
    expect((await rejectPendingBinding('pb-1')).status).toBe('REJECTED');
    await rejectPendingBinding('pb-1', '  not this host  ');
    await rejectPendingBinding('pb-1', '   ');
    expect(stub.mutations()).toEqual([
      { method: 'POST', path: '/node-credentials/pending-bindings/pb-1/approve', body: {} },
      { method: 'POST', path: '/node-credentials/pending-bindings/pb-1/reject', body: {} },
      { method: 'POST', path: '/node-credentials/pending-bindings/pb-1/reject', body: { reason: 'not this host' } },
      { method: 'POST', path: '/node-credentials/pending-bindings/pb-1/reject', body: {} },
    ]);
  });
  it('explains the refusals Magnus documents for a decision', () => {
    expect(decisionErrorMessage(new MagnusApiError(409, 'Node already has a credential.', 'CONFLICT'))).toBe('Node already has a credential. The node has a key by now, or the server runs in enforce mode: enroll it with a token instead.');
    expect(decisionErrorMessage(new MagnusApiError(410, 'Binding expired', 'GONE'))).toContain('has not asked for seven days');
    expect(decisionErrorMessage(new MagnusApiError(500, 'boom'))).toBe('boom');
  });
});

describe('the downgrade check', () => {
  it('asks with the node and the trimmed version', async () => {
    const check = { nodeId: 'node-1', to: '2.9.1', targetKnowsNodeKeys: false, nodeHasCredentials: true, action: 'reset-credentials', resetPath: '/api/v1/nodes/node-1/credentials/reset', detail: 'Reset first' };
    const stub = serve(({ path }) => (path.startsWith('/node-credentials/downgrade-check') ? ok(check) : undefined));
    expect((await checkDowngrade('node-1', ' 2.9.1 ')).action).toBe('reset-credentials');
    expect(stub.requests[0]!.path).toBe('/node-credentials/downgrade-check?nodeId=node-1&to=2.9.1');
  });
  it('tells a missing route from a missing node', () => {
    expect(downgradeErrorMessage(new MagnusApiError(404, 'Not found'))).toContain('does not answer the downgrade check');
    expect(downgradeErrorMessage(new MagnusApiError(404, 'Node not found'))).toBe('Node not found');
    expect(downgradeErrorMessage(new MagnusApiError(400, 'to must be a version such as 2.9.1'))).toBe('to must be a version such as 2.9.1');
  });
});

describe('reasons', () => {
  it('sends a trimmed reason of at most 500 characters, and none when empty', () => {
    expect(reasonBody(undefined)).toEqual({});
    expect(reasonBody('   ')).toEqual({});
    expect(reasonBody('  rollback  ')).toEqual({ reason: 'rollback' });
    expect(reasonBody('x'.repeat(500))).toEqual({ reason: 'x'.repeat(500) });
    expect(reasonBody('y'.repeat(501)).reason).toHaveLength(500);
    // Cutting at the limit must not leave trailing space that Magnus would trim to another length.
    expect(reasonBody(`${'z'.repeat(499)} tail`).reason).toBe('z'.repeat(499));
  });
});

describe('node key administration', () => {
  it('lists every key of the node through the contract', async () => {
    const stub = serve(({ path }) => (path === '/nodes/node%201/credentials' ? ok([nodeKey(), nodeKey({ keyId: 'b'.repeat(64), status: 'REVOKED', revokedAt: '2026-11-01T00:00:00.000Z', revokedBy: 'alice' })]) : undefined));
    const keys = await listNodeKeys('node 1');
    expect(keys?.map((key) => key.status)).toEqual(['ACTIVE', 'REVOKED']);
    expect(stub.requests.map((request) => request.path)).toEqual(['/nodes/node%201/credentials']);
  });
  it('reads a 404 from an older Magnus or its ingress as no browser route, not as a failure', async () => {
    serve(() => undefined);
    await expect(listNodeKeys('node-1')).resolves.toBeNull();
  });
  it('still fails on a refused role', async () => {
    serve(() => fail(403, 'FORBIDDEN', 'Insufficient permissions'));
    await expect(listNodeKeys('node-1')).rejects.toBeInstanceOf(MagnusApiError);
  });
  it('revokes and resets with the reason in the body and the idempotency key as a header', async () => {
    const stub = serve(({ path }) => (path.endsWith('/revoke') ? ok(revokeResult()) : path.endsWith('/reset') ? ok(resetResult()) : undefined));
    const revoked = await revokeNodeKeys('node-1', { reason: '  lost laptop ', idempotencyKey: 'key-1' });
    expect(revoked).toMatchObject({ agentRefused: true, sharedSecretAccepted: false, resetAvailable: true });
    const reset = await resetNodeKeys('node-1', { idempotencyKey: 'key-2' });
    expect(reset).toMatchObject({ state: 'none', sharedSecretAccepted: true, legacyUpgradeOpen: true });
    expect(stub.mutations()).toEqual([
      { method: 'POST', path: '/nodes/node-1/credentials/revoke', body: { reason: 'lost laptop' } },
      { method: 'POST', path: '/nodes/node-1/credentials/reset', body: {} },
    ]);
    expect(stub.mutations().map((request) => stub.headersOf(request).get('x-idempotency-key'))).toEqual(['key-1', 'key-2']);
  });
  it('treats an answer outside the contract as applied but unreadable', async () => {
    serve(() => ok({ revoked: 1 }));
    const error = await revokeNodeKeys('node-1', { idempotencyKey: 'key-1' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MagnusContractError);
    expect(keyActionErrorMessage(error, 'revoke')).toContain('The change was applied');
  });
  it('turns the error codes Magnus documents into operator messages', () => {
    const message = (status: number, code: string | undefined, text: string, kind: 'revoke' | 'reset' = 'revoke') => keyActionErrorMessage(new MagnusApiError(status, text, code), kind);
    expect(message(404, 'NODE_CREDENTIAL_NOT_FOUND', 'No credential')).toContain('no valid key left to revoke');
    expect(message(404, 'NOT_FOUND', 'Node not found')).toContain('no such node');
    expect(message(409, 'NODE_AUTH_ENFORCED', 'Enforced', 'reset')).toContain('NODE_AUTH_MODE=enforce, which has no credential reset');
    expect(message(409, 'DUPLICATE_REQUEST', 'Duplicate')).toContain('already took this request');
    expect(message(400, 'VALIDATION_ERROR', 'reason: Too big.')).toBe('Magnus refused the request: reason: Too big. A reason is 1 to 500 characters.');
    expect(message(403, 'FORBIDDEN', 'Insufficient permissions', 'reset')).toBe("Only a Magnus administrator can reset a node's keys.");
    expect(message(404, undefined, 'Not found', 'reset')).toContain('does not offer resetting keys in the UI');
    expect(message(500, 'INTERNAL', 'boom')).toBe('boom');
    expect(keyActionErrorMessage(new Error('offline'), 'revoke')).toBe('offline');
  });
});
