import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccess, configureEndpoint } from '../../../../../lib/transport';
import { MagnusApiError } from '../../../api/errors';
import { stubApi, type RecordedRequest } from '../../../test-dom';
import { approvePendingBinding, checkDowngrade, decisionErrorMessage, downgradeErrorMessage, listPendingBindings, readCredentialSummary, rejectPendingBinding } from './api';
import { binding, summary } from './fixtures';

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
