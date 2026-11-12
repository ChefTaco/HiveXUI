import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearAccess,
  setStepUpProvider,
  setAccessProvider,
  configureEndpoint,
  createApiFetch,
  onAccessCleared,
  productFor,
  refreshResourceAccess,
  rememberAccess,
} from './transport';

afterEach(() => {
  clearAccess();
  setAccessProvider(undefined);
  setStepUpProvider(undefined);
});
describe('product API transport', () => {
  it('omits identity cookies on bearer-authorized product requests', async () => {
    configureEndpoint('emberpath', '/api/emberpath');
    setAccessProvider(async () => {});
    rememberAccess(
      'emberpath',
      'obviously-fake-resource-token',
      Date.now() + 60000,
    );
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true }));
    await createApiFetch(request)('/api/providers', { credentials: 'include' });
    expect(request.mock.calls[0]![1]!.credentials).toBe('omit');
  });
  it('rejects arbitrary and credential-bearing endpoint URLs', () => {
    for (const endpoint of [
      'https://external.example.com/api',
      '//external.example.com/api',
      '/api/../redirect',
      '/api/test?token=example',
      '/api/test\\escape',
    ]) {
      expect(() => configureEndpoint('oathweave', endpoint)).toThrow();
    }
  });
  it('sends only the selected resource token and refuses redirects', async () => {
    configureEndpoint('oathweave', '/api/oathweave');
    rememberAccess(
      'oathweave',
      'obviously-fake-identity-token',
      Date.now() + 60000,
    );
    rememberAccess(
      'emberpath',
      'obviously-fake-routing-token',
      Date.now() + 60000,
    );
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true }));
    await createApiFetch(request)('/api/iam/users');
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe('/api/oathweave/users');
    expect(new Headers(init!.headers).get('authorization')).toBe(
      'Bearer obviously-fake-identity-token',
    );
    expect(init!.redirect).toBe('error');
  });
  it('clears all resource credentials on logout', async () => {
    rememberAccess('emberpath', 'obviously-fake-token', Date.now() + 60000);
    clearAccess();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true }));
    await createApiFetch(request)('/api/providers');
    expect(
      new Headers(request.mock.calls[0]![1]!.headers).has('authorization'),
    ).toBe(false);
  });
  it('never sends a bearer to an arbitrary request URL', async () => {
    const request = vi.fn<typeof fetch>();
    await expect(
      createApiFetch(request)('https://external.example.com/api'),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    expect(() =>
      rememberAccess('emberpath', 'obviously-fake-token', Date.now() - 100),
    ).toThrow();
  });
  it('uses the resource bearer only for chat exchange, then uses the native cookie', async () => {
    configureEndpoint('chattermost', '/api/chat');
    rememberAccess(
      'chattermost',
      'obviously-fake-chat-resource',
      Date.now() + 60000,
    );
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        String(input).endsWith('/session')
          ? Response.json({ expires_at: Date.now() + 60000 })
          : Response.json({ id: 'fake-user' }),
      );
    const send = createApiFetch(request);
    await send('/api/chat/api/v4/users/me');
    await send('/api/chat/api/v4/users/me');
    expect(request.mock.calls).toHaveLength(3);
    expect(request.mock.calls[0]![0]).toBe(
      '/api/chat/api/v4/auth/oathweave/session',
    );
    expect(
      new Headers(request.mock.calls[0]![1]!.headers).get('authorization'),
    ).toBe('Bearer obviously-fake-chat-resource');
    expect(
      new Headers(request.mock.calls[1]![1]!.headers).has('authorization'),
    ).toBe(false);
    expect(request.mock.calls[1]![1]!.credentials).toBe('include');
  });
});

it('rejects encoded route traversal before acquiring or forwarding credentials', async () => {
  const request = vi.fn<typeof fetch>();
  for (const path of [
    '/api/iam/%2e%2e/providers',
    '/api/iam/users%2f..%2fproviders',
    '/api/iam/%252e%252e/providers',
    '/api/iam/%5cusers',
    '/api/iam/%zz',
  ]) {
    await expect(createApiFetch(request)(path)).rejects.toThrow(
      'Invalid API path',
    );
  }
  expect(request).not.toHaveBeenCalled();
});

it('step-up never replays a durable operation or consumes an approval twice', async () => {
  const verify = vi.fn(async () => {});
  setStepUpProvider(verify);
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json({ error: 'STEP_UP_REQUIRED' }, { status: 403 }),
    );
  try {
    const response = await createApiFetch(request)('/api/providers', {
      method: 'POST',
      body: '{}',
    });
    expect(request).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledOnce();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: 'RETRY_AFTER_STEP_UP',
    });
  } finally {
    setStepUpProvider(undefined);
  }
});


describe('step-up read recovery',()=>{
 it('retries GET and HEAD once using newly authorized resource credentials',async()=>{
  for(const method of ['GET','HEAD']){
   clearAccess();let verified=false;
   configureEndpoint('emberpath','/api/emberpath');
   const access=vi.fn(async()=>{rememberAccess('emberpath',verified?'obviously-fake-new-token':'obviously-fake-old-token',Date.now()+60000)});
   setAccessProvider(access);const verify=vi.fn(async()=>{verified=true;clearAccess();});setStepUpProvider(verify);
   const request=vi.fn<typeof fetch>().mockImplementation(async(_url,init)=>new Headers(init?.headers).get('authorization')==='Bearer obviously-fake-new-token'?new Response(null,{status:200}):Response.json({error:'STEP_UP_REQUIRED'},{status:403}));
   expect((await createApiFetch(request)('/api/client-keys',{method})).status).toBe(200);
   expect(request).toHaveBeenCalledTimes(2);expect(access).toHaveBeenCalledTimes(2);expect(verify).toHaveBeenCalledOnce();
   expect(request.mock.calls.map(call=>new Headers(call[1]?.headers).get('authorization'))).toEqual(['Bearer obviously-fake-old-token','Bearer obviously-fake-new-token']);
  }
 });
 it('does not loop or prompt again when the verified read is denied',async()=>{
  const verify=vi.fn(async()=>{});setStepUpProvider(verify);
  const request=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({error:'STEP_UP_REQUIRED'},{status:403}));
  const response=await createApiFetch(request)('/api/client-keys');expect(response.status).toBe(403);expect(await response.json()).toEqual({error:'STEP_UP_REQUIRED'});expect(request).toHaveBeenCalledTimes(2);expect(verify).toHaveBeenCalledOnce();
 });
 it('never opens verification for a quiet read: the refusal comes back as it is',async()=>{
  const verify=vi.fn(async()=>{});setStepUpProvider(verify);
  const request=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({error:'STEP_UP_REQUIRED'},{status:403}));
  const response=await createApiFetch(request,{stepUp:false})('/api/client-keys');expect(response.status).toBe(403);expect(request).toHaveBeenCalledOnce();expect(verify).not.toHaveBeenCalled();
 });
 it('does not repeat mutations, approval calls or failed/cancelled verification',async()=>{
  const request=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({error:'STEP_UP_REQUIRED'},{status:403}));
  setStepUpProvider(async()=>{});
  for(const method of ['POST','PUT','PATCH','DELETE']){request.mockClear();const response=await createApiFetch(request)('/api/skills/admin/deployments/jobs/fixture/approve',{method,body:'{}'});expect(response.status).toBe(403);expect(await response.json()).toMatchObject({error:'RETRY_AFTER_STEP_UP'});expect(request).toHaveBeenCalledOnce();}
  setStepUpProvider(async()=>{throw new Error('Verification cancelled')});request.mockClear();await expect(createApiFetch(request)('/api/client-keys')).rejects.toThrow('cancelled');expect(request).toHaveBeenCalledOnce();
 });
 it('does not reacquire access or repeat a read aborted during verification',async()=>{
  configureEndpoint('emberpath','/api/emberpath');
  const controller=new AbortController();const access=vi.fn(async()=>{});setAccessProvider(access);setStepUpProvider(async()=>{controller.abort()});
  const request=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({error:'STEP_UP_REQUIRED'},{status:403}));
  await expect(createApiFetch(request)('/api/client-keys',{signal:controller.signal})).rejects.toThrow();expect(request).toHaveBeenCalledOnce();expect(access).toHaveBeenCalledOnce();
 });
});

describe('Magnus requests', () => {
  it('are their own product, so they never carry the Emberpath default', () => {
    expect(productFor('/api/magnus/console/session')).toBe('magnus');
    expect(productFor('/api/magnus/health/ready')).toBe('magnus');
    expect(productFor('/api/providers')).toBe('emberpath');
  });
  it('use the Magnus prefix and token', async () => {
    configureEndpoint('magnus', '/api/magnus');
    setAccessProvider(async () => {});
    rememberAccess('magnus', 'obviously-fake-magnus', Date.now() + 60000);
    rememberAccess('emberpath', 'obviously-fake-emberpath', Date.now() + 60000);
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    await createApiFetch(request)('/api/magnus/nodes?page=2');
    expect(request.mock.calls[0]![0]).toBe('/api/magnus/nodes?page=2');
    expect(new Headers(request.mock.calls[0]![1]!.headers).get('authorization')).toBe('Bearer obviously-fake-magnus');
    expect(request.mock.calls[0]![1]!.credentials).toBe('omit');
  });
});

describe('Ardent Project Studio requests', () => {
  it('are their own product under /api/ardentstudio', () => {
    expect(productFor('/api/ardentstudio/v1/projects')).toBe('ardentstudio');
    expect(productFor('/api/ardentstudio/health/ready')).toBe('ardentstudio');
    expect(productFor('/api/ardentstudiox/v1')).toBe('emberpath');
  });
  it('use the Studio prefix and token', async () => {
    configureEndpoint('ardentstudio', '/api/ardentstudio');
    setAccessProvider(async () => {});
    rememberAccess('ardentstudio', 'obviously-fake-studio', Date.now() + 60000);
    rememberAccess('magnus', 'obviously-fake-magnus', Date.now() + 60000);
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    await createApiFetch(request)('/api/ardentstudio/v1/projects');
    expect(request.mock.calls[0]![0]).toBe('/api/ardentstudio/v1/projects');
    expect(new Headers(request.mock.calls[0]![1]!.headers).get('authorization')).toBe('Bearer obviously-fake-studio');
    expect(request.mock.calls[0]![1]!.credentials).toBe('omit');
  });
});

describe('the end of a session', () => {
  it('tells long-lived readers on logout, but not on a same-session token refresh', () => {
    const listener = vi.fn();
    const stop = onAccessCleared(listener);
    refreshResourceAccess();
    expect(listener).not.toHaveBeenCalled();
    clearAccess();
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    clearAccess();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
