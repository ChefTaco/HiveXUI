import { afterEach, describe, expect, it, vi } from 'vitest';
import { project, serveStudio } from '../test-fixtures';
import { probeStudio, StudioApiError, StudioContractError, studioPath } from './client';
import { createProject, listProjects, uploadFile, validateTeam } from './endpoints';

afterEach(() => vi.unstubAllGlobals());

describe('the Studio client', () => {
  it('builds paths under the contract prefix, dropping empty query values', () => {
    expect(studioPath('/projects', { status: 'all', q: '', other: undefined })).toBe('/api/ardentstudio/v1/projects?status=all');
    expect(() => studioPath('/api/ardentstudio/v1/projects')).toThrow();
  });

  it('sends an idempotency key with every mutation, and the caller’s key when given', async () => {
    const server = serveStudio((request) => (request.method === 'GET' ? { projects: [] } : project()));
    vi.stubGlobal('fetch', server.fetch);
    await createProject({ name: 'One' }, 'hivexui-fixed-key-1');
    await createProject({ name: 'Two' });
    await listProjects({ status: 'active' });
    const [first, second, read] = server.requests;
    expect(first!.headers.get('x-idempotency-key')).toBe('hivexui-fixed-key-1');
    expect(second!.headers.get('x-idempotency-key')).toMatch(/^hivexui-[a-f0-9]{32}$/);
    expect(read!.headers.get('x-idempotency-key')).toBeNull();
  });

  it('uploads the raw bytes with their type and the name in the query', async () => {
    const server = serveStudio(() => ({ ...project(), id: undefined }));
    vi.stubGlobal('fetch', server.fetch);
    const blob = new Blob(['# Notes'], { type: '' });
    await expect(uploadFile(project().id, blob, 'notes v2.md', 'text/markdown')).rejects.toBeInstanceOf(StudioContractError);
    const [request] = server.requests;
    expect(request!.path).toBe(`/projects/${project().id}/files?name=notes+v2.md&purpose=reference`);
    expect(request!.headers.get('content-type')).toBe('text/markdown');
    expect(request!.body).toBe(blob);
  });

  it('reads the service’s error message, code and details', async () => {
    const server = serveStudio(() => Response.json({ error: { code: 'ACTIVE_TASKS', message: 'Cancel running tasks first', details: { tasks: [{ id: 't1' }] } } }, { status: 409 }));
    vi.stubGlobal('fetch', server.fetch);
    const error = await createProject({ name: 'One' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StudioApiError);
    expect(error).toMatchObject({ status: 409, code: 'ACTIVE_TASKS', message: 'Cancel running tasks first', details: { tasks: [{ id: 't1' }] } });
  });

  it('refuses a success that does not match the contract, saying whether it was applied', async () => {
    vi.stubGlobal('fetch', serveStudio(() => ({ projects: [{ id: 'nope' }] })).fetch);
    await expect(listProjects({})).rejects.toMatchObject({ applied: false });
    vi.stubGlobal('fetch', serveStudio(() => ({ id: 'nope' })).fetch);
    await expect(createProject({ name: 'One' })).rejects.toMatchObject({ applied: true });
  });

  it('validates a body without side effects', async () => {
    const server = serveStudio(() => ({ issues: [], can_publish: true, can_start_room: false, agent_facts: 'complete' }));
    vi.stubGlobal('fetch', server.fetch);
    await validateTeam(project().id, { roles: [], relationships: [] }, undefined);
    expect(server.requests[0]).toMatchObject({ method: 'POST', path: `/projects/${project().id}/team/validate`, body: { body: { roles: [], relationships: [] } } });
  });
});

describe('the readiness probe', () => {
  const check = { status: 'ok', error: null };
  const down = { status: 'unavailable', error: 'timeout' };
  const answer = (body: unknown, status = 200) => async () => Response.json(body, { status });

  it('is ready, and names what is degraded while the database serves', async () => {
    expect(await probeStudio(undefined, answer({ status: 'ready', checks: { database: check, magnus: check, hivemem: check, agents: { status: 'ok', available: 2 } } }))).toEqual({ state: 'ready', degraded: [] });
    const degraded = await probeStudio(undefined, answer({ status: 'not_ready', checks: { database: check, magnus: check, hivemem: down, agents: { status: 'ok', available: 2 } } }, 503));
    expect(degraded).toEqual({ state: 'ready', degraded: ['HiveMem unavailable: references are stored but not searchable by agents.'] });
  });

  it('is unavailable without its database, or when something else answers', async () => {
    expect((await probeStudio(undefined, answer({ status: 'not_ready', checks: { database: down, magnus: check, hivemem: check, agents: { status: 'ok', available: 1 } } }, 503))).state).toBe('unavailable');
    expect((await probeStudio(undefined, async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }))).state).toBe('unavailable');
    expect((await probeStudio(undefined, async () => { throw new TypeError('offline'); })).state).toBe('unavailable');
    expect((await probeStudio(undefined, answer({}, 403))).state).toBe('denied');
  });
});
