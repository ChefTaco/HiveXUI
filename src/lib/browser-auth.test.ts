import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createBrowserAuth } from './browser-auth';
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
  const request = vi.fn<typeof fetch>().mockResolvedValue(
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
  expect(request).toHaveBeenCalledTimes(1);
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
 const send=vi.fn<typeof fetch>().mockImplementation(input=>String(input).endsWith('/browser/logout')?Promise.resolve(Response.json({ok:true})):new Promise(resolve=>{finish=resolve}));
 const auth=createBrowserAuth({issuer:'https://identity.example.com',apiPrefix:'/api/identity',clients:{}},send);
 try{
  const first=auth.stepUp(),second=auth.stepUp();expect(second).toBe(first);
  const observed=expect(first).rejects.toThrow('session ended');await Promise.resolve();expect(prompts).toBe(1);
  await auth.logout();finish!(Response.json({success:true}));await observed;
  expect(send.mock.calls.filter(call=>String(call[0]).endsWith('/auth/step-up'))).toHaveLength(1);
 }finally{unsubscribe();auth.invalidate()}
});
