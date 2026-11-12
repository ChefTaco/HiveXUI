import { describe, expect, it, vi } from 'vitest';
import { knownCheck, runProbe, type ProbeContext } from './probes';
import { client, iamUser, node, nodeList } from './test-fixtures';

const signal = new AbortController().signal;
function context(answers: Record<string, unknown>, overrides: Partial<ProbeContext> = {}) {
  const fetch = vi.fn(async (path: string) => {
    const answer = answers[path];
    if (answer instanceof Response) return answer;
    return answer === undefined ? Response.json({ error: 'not found' }, { status: 404 }) : Response.json(answer);
  });
  return { fetch, installed: () => true, clients: ['hivexui-emberpath', 'hivexui-magnus'], ...overrides } satisfies ProbeContext;
}
const NODES = '/api/magnus/nodes?page=1&pageSize=100';
const CLIENTS = '/api/iam/clients';
const USERS = '/api/iam/users?limit=100';

describe('the probes HiveXUI knows', () => {
  it('are the three the controller names; any other check is not run', () => {
    expect(['magnus.agent', 'oathweave.console-client', 'iam.first-admin'].every(knownCheck)).toBe(true);
    expect(knownCheck('future.probe')).toBe(false);
    expect(knownCheck('constructor')).toBe(false);
    expect(knownCheck(undefined)).toBe(false);
  });
});

describe('magnus.agent', () => {
  it('is done when an online node reports a running agent, and says it cannot tell which host', async () => {
    const result = await runProbe('magnus.agent', context({ [NODES]: nodeList(node('node-1', 'OFFLINE', 'RUNNING'), node('node-2', 'ONLINE', 'RUNNING')) }), signal);
    expect(result).toEqual({ state: 'done', detail: expect.stringContaining('node-2 reports a running agent') });
    expect(result.detail).toMatch(/cannot tell which node is the Magnus host/);
  });
  it('is not done with no node, or none online with a running agent', async () => {
    expect(await runProbe('magnus.agent', context({ [NODES]: nodeList() }), signal)).toEqual({ state: 'not-done', detail: 'Magnus has no enrolled node yet.' });
    const idle = context({ [NODES]: nodeList(node('node-1', 'ONLINE', 'STOPPED'), node('node-2', 'ONLINE', null), node('node-3', 'DEGRADED', 'RUNNING')) });
    expect((await runProbe('magnus.agent', idle, signal)).state).toBe('not-done');
  });
  it('cannot tell without Magnus, and never asks', async () => {
    const absent = context({}, { installed: (product) => product !== 'magnus' });
    expect((await runProbe('magnus.agent', absent, signal)).state).toBe('unknown');
    expect(absent.fetch).not.toHaveBeenCalled();
  });
});

describe('oathweave.console-client', () => {
  it('is done when every client HiveXUI signs in with is active in Oathweave', async () => {
    const result = await runProbe('oathweave.console-client', context({ [CLIENTS]: { clients: [client('hivexui-emberpath'), client('hivexui-magnus'), client('other')] } }), signal);
    expect(result).toEqual({ state: 'done', detail: 'Oathweave has every HiveXUI browser client: hivexui-emberpath, hivexui-magnus.' });
  });
  it('names the clients that are missing or inactive', async () => {
    const result = await runProbe('oathweave.console-client', context({ [CLIENTS]: { clients: [client('hivexui-emberpath'), client('hivexui-magnus', false)] } }), signal);
    expect(result).toEqual({ state: 'not-done', detail: 'Oathweave has no active client hivexui-magnus.' });
  });
  it('cannot tell without suite sign-in clients', async () => {
    const legacy = context({}, { clients: [] });
    expect((await runProbe('oathweave.console-client', legacy, signal)).state).toBe('unknown');
    expect(legacy.fetch).not.toHaveBeenCalled();
  });
});

describe('iam.first-admin', () => {
  const OLD = '2026-10-01T00:00:00.000Z';
  const NEW = '2026-11-01T00:00:00.000Z';
  it('is done when an administrator other than the oldest account exists', async () => {
    const users = [iamUser('u2', 'alice', NEW, ['SUITE_ADMIN']), iamUser('u1', 'admin', OLD, ['SUPER_ADMIN', 'SUITE_ADMIN'])];
    expect(await runProbe('iam.first-admin', context({ [USERS]: { users, total: 2, page: 1, limit: 100 } }), signal)).toEqual({
      state: 'done', detail: 'alice is an administrator besides the initial operator.',
    });
  });
  it('is not done while the initial operator is the only administrator', async () => {
    const users = [iamUser('u3', 'bob', NEW, ['OPERATOR']), iamUser('u4', 'carol', NEW, ['SUPER_ADMIN'], false), iamUser('u1', 'admin', OLD, ['SUPER_ADMIN'])];
    expect(await runProbe('iam.first-admin', context({ [USERS]: { users, total: 3, page: 1, limit: 100 } }), signal)).toEqual({
      state: 'not-done', detail: 'Only the initial operator, admin, is an administrator.',
    });
  });
  it('counts every administrator on a first page that cannot hold the initial operator', async () => {
    const users = [iamUser('u9', 'dana', NEW, ['admin'])];
    expect((await runProbe('iam.first-admin', context({ [USERS]: { users, total: 250, page: 1, limit: 100 } }), signal)).state).toBe('done');
  });
  it('cannot tell when Oathweave refuses or fails', async () => {
    const denied = context({ [USERS]: Response.json({ error: { code: 'forbidden', message: 'Forbidden' } }, { status: 403 }) });
    expect(await runProbe('iam.first-admin', denied, signal)).toEqual({ state: 'unknown', detail: 'Your account cannot read what this check needs.' });
    const broken = context({ [USERS]: { users: 'nope' } });
    expect(await runProbe('iam.first-admin', broken, signal)).toEqual({ state: 'unknown', detail: expect.stringMatching(/^The check could not be completed: /) });
  });
});
