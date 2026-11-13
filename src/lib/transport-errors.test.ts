import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configureEndpoint,
  createApiFetch,
  describeApiError,
  HiveApiError,
  HiveContractError,
  hiveApiError,
  productFor,
  resolveApiPath,
  REQUEST_ID_HEADER,
  setStepUpProvider,
} from './transport';
import { ApiError } from './api';
import { MagnusApiError, MagnusContractError } from '../modules/magnus/api/errors';
import { StudioApiError, StudioContractError } from '../modules/studio/api/client';

afterEach(() => setStepUpProvider(undefined));

/** A fetch that answers every request with `answer`, and records what was sent. */
function answering(answer: () => Response) {
  const sent: { url: string; headers: Headers }[] = [];
  const request = vi.fn<typeof fetch>(async (input, init) => {
    sent.push({ url: String(input), headers: new Headers(init?.headers) });
    return answer();
  });
  return { send: createApiFetch(request), sent };
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

async function failureOf(answer: () => Response, fallback = 'The fallback'): Promise<HiveApiError> {
  const { send } = answering(answer);
  return hiveApiError(await send('/api/hivemem/v1/things'), { fallback });
}

describe('every error shape in the suite through apiFetch', () => {
  it.each([
    ['the standard envelope', () => json({ error: { code: 'not_found', message: 'No such project', requestId: 'body-id', details: { id: 'p1' } } }, 404), 'envelope', 'not_found', 'No such project'],
    ['Magnus', () => json({ success: false, error: { code: 'NODE_OFFLINE', message: 'The node is offline' } }, 409), 'magnus', 'NODE_OFFLINE', 'The node is offline'],
    ['Ardent, ArdentStudio and the Registry', () => json({ error: { code: 'LINK_EXISTS', message: 'That link exists' } }, 409), 'envelope', 'LINK_EXISTS', 'That link exists'],
    ['Oathweave', () => json({ error: 'ACCOUNT_LOCKED', message: 'The account is locked' }, 403), 'oathweave', 'ACCOUNT_LOCKED', 'The account is locked'],
    ['Emberpath, HiveSkills and Cindertrace', () => json({ error: 'The provider name is taken' }, 400), 'string', undefined, 'The provider name is taken'],
    ['Embermend', () => json({ error: 'STALE_DECISION' }, 409), 'code', 'STALE_DECISION', 'The fallback'],
    ['HiveMem', () => json({ detail: 'Workspace is archived' }, 409), 'fastapi', undefined, 'Workspace is archived'],
    ['HiveMem validation', () => json({ detail: [{ loc: ['body', 'name'], msg: 'Field required', type: 'missing' }] }, 422), 'fastapi-validation', 'validation_failed', 'body.name: Field required'],
    ['ChatterMost', () => json({ id: 'api.user.create.exists', message: 'An account with that email exists', status_code: 400, request_id: 'mm-id' }, 400), 'mattermost', 'api.user.create.exists', 'An account with that email exists'],
    ['OAuth', () => json({ error: 'invalid_grant', error_description: 'The code has expired' }, 400), 'oauth', 'invalid_grant', 'The code has expired'],
    ['plain text', () => new Response('Upstream is restarting', { status: 503 }), 'text', undefined, 'Upstream is restarting'],
    ['an HTML error page', () => new Response('<!doctype html><title>502</title>', { status: 502 }), 'text', undefined, 'The fallback'],
    ['no body', () => new Response(null, { status: 500 }), 'empty', undefined, 'The fallback'],
  ] as const)('reads %s', async (_name, answer, shape, code, message) => {
    const error = await failureOf(answer);
    expect(error).toBeInstanceOf(HiveApiError);
    expect(error.shape).toBe(shape);
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
    expect(error.status).toBe(answer().status);
  });

  it('keeps the envelope details and the request ID from the body', async () => {
    const error = await failureOf(() => json({ error: { code: 'conflict', message: 'Busy', requestId: 'body-id', details: { tasks: [{ id: 't1' }] } } }, 409));
    expect(error.details).toEqual({ tasks: [{ id: 't1' }] });
    expect(error.requestId).toBe('body-id');
    expect(error.hiveCode).toBe('conflict');
    expect(HiveApiError.is(error, 'CONFLICT')).toBe(true);
  });

  it('keeps Retry-After', async () => {
    const error = await failureOf(() => json({ error: { code: 'rate_limited', message: 'Slow down' } }, 429, { 'retry-after': '7' }));
    expect(error.retryAfterMs).toBe(7000);
  });

  it('falls back to the status default when a client gives no message of its own', async () => {
    const { send } = answering(() => new Response(null, { status: 404 }));
    const error = await hiveApiError(await send('/api/hivemem/v1/things'));
    expect(error.message).toBe('The resource was not found');
    expect(error.hiveCode).toBe('not_found');
  });

  it('keeps the client message for a status when the product text is not trusted', async () => {
    const { send } = answering(() => json({ error: 'internal stack trace' }, 500));
    const error = await hiveApiError(await send('/api/hivemem/v1/things'), { trustMessage: false, fallback: 'Try again later' });
    expect(error.message).toBe('Try again later');
  });
});

describe('request IDs', () => {
  it('sends a fresh x-request-id with every request and keeps one the caller set', async () => {
    const { send, sent } = answering(() => json({}, 200));
    await send('/api/magnus/nodes');
    await send('/api/magnus/nodes');
    await send('/api/magnus/nodes', { headers: { [REQUEST_ID_HEADER]: 'caller-id' } });
    const ids = sent.map((request) => request.headers.get(REQUEST_ID_HEADER));
    expect(ids[0]).toMatch(/^[A-Za-z0-9._:@/+=-]{1,128}$/);
    expect(ids[1]).not.toBe(ids[0]);
    expect(ids[2]).toBe('caller-id');
  });

  it('surfaces the response x-request-id on the error', async () => {
    const error = await failureOf(() => json({ error: 'That is not allowed' }, 400, { 'x-request-id': 'echoed-id' }));
    expect(error.requestId).toBe('echoed-id');
    expect(describeApiError(error)).toBe('That is not allowed (request echoed-id)');
  });

  it('reads the older x-hive-request-id', async () => {
    const error = await failureOf(() => json({ error: 'Nope' }, 400, { 'x-hive-request-id': 'hive-id' }));
    expect(error.requestId).toBe('hive-id');
  });

  it('falls back to the ID it sent when the answer carries none', async () => {
    const { send, sent } = answering(() => json({ error: 'Nope' }, 400));
    const error = await hiveApiError(await send('/api/hivemem/v1/things'));
    expect(error.requestId).toBe(sent[0]!.headers.get(REQUEST_ID_HEADER));
  });

  it('prefers the ID in the body to the header', async () => {
    const error = await failureOf(() => json({ error: { code: 'x', message: 'y', requestId: 'body-id' } }, 400, { 'x-request-id': 'header-id' }));
    expect(error.requestId).toBe('body-id');
  });
});

describe('step-up', () => {
  it('recognises the step-up code in the suite envelope too', async () => {
    let verified = false;
    setStepUpProvider(async () => {
      verified = true;
    });
    const { send, sent } = answering(() => (verified ? json({ ok: true }, 200) : json({ error: { code: 'STEP_UP_REQUIRED', message: 'Verify first' } }, 403)));
    const response = await send('/api/magnus/settings');
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(2);
  });

  it('answers a mutation with RETRY_AFTER_STEP_UP that parses like any refusal', async () => {
    setStepUpProvider(async () => {});
    const { send } = answering(() => json({ error: 'STEP_UP_REQUIRED' }, 403));
    const error = await hiveApiError(await send('/api/magnus/settings', { method: 'POST', body: '{}' }));
    expect(error.code).toBe('RETRY_AFTER_STEP_UP');
    expect(error.message).toBe('Identity verified. Review and submit the operation again.');
    expect(error.requestId).toBeTruthy();
  });
});

describe('product routes', () => {
  it('sends legacy aliases and ingress names under the alias when runtime.json gives no prefix', () => {
    expect(resolveApiPath('/api/skills/v1/skills')).toBe('/api/skills/v1/skills');
    expect(resolveApiPath('/api/hiveskills/v1/skills')).toBe('/api/skills/v1/skills');
    expect(resolveApiPath('/api/providers')).toBe('/api/providers');
  });

  it('sends both names under the configured ingress prefix', () => {
    configureEndpoint('oathweave', '/api/oathweave');
    configureEndpoint('emberpath', '/api/emberpath');
    expect(productFor('/api/iam/users')).toBe('oathweave');
    expect(productFor('/api/oathweave/users')).toBe('oathweave');
    expect(resolveApiPath('/api/iam/users')).toBe('/api/oathweave/users');
    expect(resolveApiPath('/api/oathweave/users')).toBe('/api/oathweave/users');
    expect(resolveApiPath('/api/providers')).toBe('/api/emberpath/providers');
    expect(resolveApiPath('/api/emberpath/providers')).toBe('/api/emberpath/providers');
  });
});

describe('the error classes share one base', () => {
  it('keeps product classes distinct for instanceof and their constructors', () => {
    const magnus = new MagnusApiError(409, 'A run is active', 'RUN_ACTIVE', undefined, { requestId: 'r1' });
    const studio = new StudioApiError(409, 'Busy', 'PROPOSAL_IN_PROGRESS', { tasks: [] });
    const api = new ApiError('Unauthorized', 401);
    for (const error of [magnus, studio, api]) expect(error).toBeInstanceOf(HiveApiError);
    expect(magnus).not.toBeInstanceOf(StudioApiError);
    expect(api).not.toBeInstanceOf(MagnusApiError);
    expect(magnus.name).toBe('MagnusApiError');
    expect(magnus.requestId).toBe('r1');
    expect(studio.details).toEqual({ tasks: [] });
    expect(api.code).toBeUndefined();
  });

  it('keeps contract mismatches a distinct kind on the same base', () => {
    const magnus = new MagnusContractError('/nodes', true);
    const studio = new StudioContractError(false);
    for (const error of [magnus, studio]) {
      expect(error).toBeInstanceOf(HiveContractError);
      expect(error).toBeInstanceOf(HiveApiError);
      expect(error.code).toBe('contract_mismatch');
    }
    expect(magnus).not.toBeInstanceOf(MagnusApiError);
    expect(magnus.applied).toBe(true);
    expect(studio.message).toBe('The Studio service answered in an unexpected format.');
  });
});

describe('success answers that cannot be read', () => {
  it('turns a contract mismatch into an operator message, never the schema issue list', async () => {
    const { parseAnswer } = await import('./api-error');
    const { z } = await import('zod');
    const schema = z.object({ data: z.array(z.object({ id: z.string() })) });
    expect(parseAnswer(schema, { data: [{ id: 'a', extra: true }] }, 'Emberpath')).toEqual({ data: [{ id: 'a' }] });
    let caught: unknown;
    try {
      parseAnswer(schema, { data: [{ id: 1 }] }, 'Emberpath');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HiveContractError);
    expect((caught as HiveContractError).applied).toBe(false);
    expect((caught as Error).message).toBe('Emberpath answered in a format this version of HiveXUI cannot read.');
    expect((caught as Error).message).not.toContain('invalid_type');
    expect(() => parseAnswer(schema, null, 'Emberpath', true)).toThrow(/change was sent.*Refresh/);
  });

  it('reports a page served in place of JSON as a contract error with the request ID', async () => {
    const { readJsonAnswer } = await import('./api-error');
    const page = new Response('<!doctype html><title>HiveXUI</title>', { status: 200, headers: { 'content-type': 'text/html', 'x-request-id': 'req-html-1' } });
    const error = await readJsonAnswer(page, 'HiveMem').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HiveContractError);
    expect((error as HiveContractError).requestId).toBe('req-html-1');
    expect((error as Error).message).not.toMatch(/Unexpected token|JSON/);
    await expect(readJsonAnswer(Response.json({ ok: true }), 'HiveMem')).resolves.toEqual({ ok: true });
  });

  it('gives the shared clients that operator message for a mismatched answer', async () => {
    const { createIamApi } = await import('./iam-api');
    const { createEmberpathApi } = await import('./emberpath-api');
    const iam = createIamApi(vi.fn<typeof fetch>(async () => Response.json({ users: 'nope' })));
    await expect(iam.iamUsers()).rejects.toThrow('Oathweave answered in a format this version of HiveXUI cannot read.');
    await expect(createIamApi(vi.fn<typeof fetch>(async () => new Response('<html>', { status: 200 }))).iamUsers()).rejects.toBeInstanceOf(HiveContractError);
    const emberpath = createEmberpathApi(vi.fn().mockResolvedValue({ data: 'nope' }));
    await expect(emberpath.providers()).rejects.toThrow('Emberpath answered in a format this version of HiveXUI cannot read.');
    await expect(emberpath.deleteProvider('fixture')).rejects.toMatchObject({ applied: true });
  });
});
