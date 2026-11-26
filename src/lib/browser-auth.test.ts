import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createBrowserAuth, PasswordExpired, ReauthenticationCancelled } from './browser-auth';
import { subscribeIdentityPrompts } from './identity-prompts';
import { clearAccess } from './transport';

vi.stubGlobal('location', { origin: 'https://console.example.com' });
vi.stubGlobal('crypto', webcrypto);
describe('browser authorization response binding', () => {
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  beforeAll(async () => {
    keys = await generateKeyPair('RS256');
  });
  async function scenario(
    change:
      | 'none'
      | 'state'
      | 'issuer'
      | 'nonce'
      | 'access'
      | 'consent' = 'none',
  ) {
    let nonce = '';
    const access = 'obviously-fake-resource-token';
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        const path = String(input);
        if (path.endsWith('/jwks'))
          return Response.json({
            keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'test' }],
          });
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<
          string,
          string
        >;
        if (path.endsWith('/authorize')) {
          if (change === 'consent' && body.consent !== 'approve')
            return Response.json(
              {
                error: 'CONSENT_REQUIRED',
                clientName: 'Example',
                clientDescription: null,
                audience: 'emberpath',
                scope: 'openid profile',
                permissions: ['router:providers:read'],
              },
              { status: 403 },
            );
          nonce = body.nonce!;
          expect(body.codeChallenge).toHaveLength(43);
          expect(body.codeChallengeMethod).toBe('S256');
          expect(body.clientId).toBe('hivexui-emberpath');
          return Response.json({
            code: 'fake-one-use-code',
            state: change === 'state' ? 'wrong' : body.state,
            iss:
              change === 'issuer'
                ? 'https://untrusted.example.com'
                : 'https://identity.example.com',
          });
        }
        const hash = createHash('sha256')
          .update(access)
          .digest()
          .subarray(0, 16)
          .toString('base64url');
        const identity = await new SignJWT({
          nonce: change === 'nonce' ? 'wrong' : nonce,
          at_hash: hash,
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'test' })
          .setSubject('fake-user')
          .setIssuer('https://identity.example.com')
          .setAudience('hivexui-emberpath')
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(keys.privateKey);
        return Response.json({
          access_token: change === 'access' ? 'substituted-fake-token' : access,
          id_token: identity,
          token_type: 'Bearer',
          expires_in: 300,
        });
      });
    return createBrowserAuth(
      {
        issuer: 'https://identity.example.com',
        apiPrefix: '/api/identity',
        clients: { emberpath: 'hivexui-emberpath' },
      },
      request,
    );
  }
  it('accepts a signed, nonce-bound and access-token-bound response', async () => {
    clearAccess();
    const auth = await scenario();
    await expect(auth.ensure('emberpath')).resolves.toBeUndefined();
    clearAccess();
  });
  it('requires explicit consent and never exchanges a code after a decline', async () => {
    const cancel = subscribeIdentityPrompts((prompt) => {
      if (prompt?.kind === 'consent') prompt.resolve(false);
    });
    await expect(
      (await scenario('consent')).ensure('emberpath'),
    ).rejects.toThrow('not approved');
    cancel();
    const approve = subscribeIdentityPrompts((prompt) => {
      if (prompt?.kind === 'consent') prompt.resolve(true);
    });
    await expect(
      (await scenario('consent')).ensure('emberpath'),
    ).resolves.toBeUndefined();
    approve();
    clearAccess();
  });
  it('rejects state, issuer, nonce and access-token substitution', async () => {
    for (const change of ['state', 'issuer', 'nonce', 'access'] as const) {
      const auth = await scenario(change);
      await expect(auth.ensure('emberpath')).rejects.toThrow();
    }
    clearAccess();
  });
});

it('reports password expiry without requesting tokens or treating it as a session', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(async () =>
    Response.json(
      {
        passwordExpired: true,
        message: 'Your password has expired and must be changed',
      },
      { status: 403 },
    ),
  );
  const auth = createBrowserAuth(
    {
      issuer: 'https://identity.example.com',
      apiPrefix: '/api/identity',
      clients: { emberpath: 'hivexui-emberpath' },
    },
    request,
  );
  await expect(auth.login('admin', 'obviously-fake-password')).rejects.toThrow(
    'password has expired',
  );
  // The sign-in form opens password recovery for this error.
  await expect(auth.login('admin', 'obviously-fake-password')).rejects.toBeInstanceOf(PasswordExpired);
  expect(request).toHaveBeenCalledTimes(2);
  expect(String(request.mock.calls[0]?.[0])).toBe('/api/identity/auth/login');
});


it('reports a gateway error page at sign-in by its status, not as a JSON parser error', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(async () =>
    new Response('<html><body>502 Bad Gateway</body></html>', { status: 502, headers: { 'content-type': 'text/html', 'x-request-id': 'req-gateway-1' } }),
  );
  const auth = createBrowserAuth({ issuer: 'https://identity.example.com', apiPrefix: '/api/identity', clients: {} }, request);
  const error = await auth.login('admin', 'obviously-fake-password').catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe('Oathweave could not be reached (HTTP 502). Try again in a moment.');
  expect(error).toMatchObject({ status: 502, requestId: 'req-gateway-1' });
  request.mockImplementation(async () => new Response('', { status: 200 }));
  await expect(auth.me()).rejects.toThrow('Invalid identity response');
});

it('shares one pending step-up across concurrent readers and refuses completion after logout',async()=>{
 let finish:((value:Response)=>void)|undefined;let prompts=0;
 const unsubscribe=subscribeIdentityPrompts(prompt=>{if(prompt?.kind==='step-up'){prompts++;prompt.resolve({password:'obviously-fake-password'})}});
 const send=vi.fn<typeof fetch>().mockImplementation(input=>{
  const path=String(input);
  if(path.endsWith('/browser/logout'))return Promise.resolve(Response.json({ok:true}));
  if(path.endsWith('/browser/session'))return Promise.resolve(Response.json({principal:{sub:'fixture-user',username:'admin',roles:[],permissions:[]}}));
  if(path.endsWith('/oauth/authorize'))return Promise.resolve(Response.json({error:'LOGIN_REQUIRED',message:'Sign in again',reason:'prompt_login',loginTicket:'fixture-ticket',loginTicketExpiresIn:600},{status:401}));
  return new Promise(resolve=>{finish=resolve});
 });
 const auth=createBrowserAuth({issuer:'https://identity.example.com',apiPrefix:'/api/identity',clients:{oathweave:'hivexui-oathweave'}},send);
 try{
  const first=auth.stepUp(),second=auth.stepUp();expect(second).toBe(first);
  const observed=expect(first).rejects.toThrow('session ended');await vi.waitFor(()=>expect(finish).toBeDefined());expect(prompts).toBe(1);
  await auth.logout();finish!(Response.json({success:true}));await observed;
  expect(send.mock.calls.filter(call=>String(call[0]).endsWith('/auth/step-up'))).toHaveLength(1);
 }finally{unsubscribe();auth.invalidate()}
});

it('does not end the session when Oathweave asks for a new sign-in, only when the session is gone', async () => {
 const { onSessionEnded, resetSessionEvents } = await import('./session-events');
 const ended = vi.fn();
 onSessionEnded(ended);
 const unsubscribe=subscribeIdentityPrompts(prompt=>{if(prompt?.kind==='step-up')prompt.resolve(null)});
 let reason='prompt_login';
 const send=vi.fn<typeof fetch>().mockImplementation(async input=>{
  const path=String(input);
  if(path.endsWith('/browser/session'))return Response.json({principal:{sub:'fixture-user',username:'admin',roles:[],permissions:[]}});
  if(path.endsWith('/oauth/authorize/cancel'))return Response.json({error:'access_denied',error_description:'cancelled',iss:'https://identity.example.com',redirectTo:'https://console.example.com/auth/callback?error=access_denied'});
  if(path.endsWith('/oauth/authorize'))return Response.json({error:'LOGIN_REQUIRED',message:'Sign in again',reason,loginTicket:'fixture-ticket',loginTicketExpiresIn:600},{status:401});
  throw new Error('unexpected '+path);
 });
 const auth=createBrowserAuth({issuer:'https://identity.example.com',apiPrefix:'/api/identity',clients:{oathweave:'hivexui-oathweave'}},send);
 try{
  const cancelled=await auth.stepUp('oathweave').catch((error:unknown)=>error);
  expect(cancelled).toBeInstanceOf(ReauthenticationCancelled);
  expect((cancelled as Error).message).toMatch(/cancelled, so nothing was changed/);
  expect(ended).not.toHaveBeenCalled();
  reason='no_session';
  await expect(auth.stepUp('oathweave')).rejects.toBeInstanceOf(ReauthenticationCancelled);
  expect(ended).toHaveBeenCalledWith('expired');
 }finally{unsubscribe();auth.invalidate();resetSessionEvents()}
});

it('ends the session for every page when Oathweave refuses the browser session or a new authorization', async () => {
  const { onSessionEnded, resetSessionEvents } = await import('./session-events');
  const ended = vi.fn();
  onSessionEnded(ended);
  const request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ error: 'LOGIN_REQUIRED' }, { status: 401 }));
  const auth = createBrowserAuth({ issuer: 'https://identity.example.com', apiPrefix: '/api/identity', clients: { hivemem: 'hivexui-hivemem' } }, request);
  await expect(auth.me()).rejects.toMatchObject({ status: 401 });
  expect(ended).toHaveBeenCalledTimes(1);
  await expect(auth.ensure('hivemem')).rejects.toMatchObject({ status: 401 });
  expect(ended).toHaveBeenCalledTimes(2);
  // A wrong password at sign-in is not the end of a session.
  await expect(auth.login('operator', 'obviously-fake-password')).rejects.toMatchObject({ status: 401 });
  expect(ended).toHaveBeenCalledTimes(2);
  resetSessionEvents();
});
