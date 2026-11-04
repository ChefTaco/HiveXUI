import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createBrowserAuth } from './browser-auth';
import { clearAccess } from './transport';

vi.stubGlobal('location', { origin: 'https://console.example.com' });
vi.stubGlobal('crypto', webcrypto);
describe('browser authorization response binding', () => {
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  beforeAll(async () => {
    keys = await generateKeyPair('RS256');
  });
  async function scenario(
    change: 'none' | 'state' | 'issuer' | 'nonce' | 'access' = 'none',
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
  it('rejects state, issuer, nonce and access-token substitution', async () => {
    for (const change of ['state', 'issuer', 'nonce', 'access'] as const) {
      const auth = await scenario(change);
      await expect(auth.ensure('emberpath')).rejects.toThrow();
    }
    clearAccess();
  });
});
