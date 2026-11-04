import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { clearAccess, rememberAccess, type Product } from './transport';
import type { AdminUser } from './types';

export interface BrowserIdentityConfig {
  issuer: string;
  apiPrefix: string;
  clients: Partial<Record<Product, string>>;
}
export class MfaRequired extends Error {
  constructor(
    readonly token: string,
    readonly methods: string[],
  ) {
    super('Complete the second authentication step');
  }
}
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));

export function createBrowserAuth(
  config: BrowserIdentityConfig,
  request: typeof fetch = fetch,
) {
  if (
    !/^\/api\/[a-z][a-z0-9-]*$/.test(config.apiPrefix) ||
    new URL(config.issuer).protocol !== 'https:'
  )
    throw new Error('Invalid identity configuration');
  const pending = new Map<Product, Promise<void>>();
  const expiry = new Map<Product, number>();
  let generation = 0;
  const keys = createRemoteJWKSet(
    new URL(config.apiPrefix + '/oauth/jwks', location.origin),
    {
      [customFetch]: (url, init) =>
        request(url, { ...init, redirect: 'error' }),
    },
  );
  async function json(
    path: string,
    body?: object,
  ): Promise<Record<string, unknown>> {
    const response = await request(config.apiPrefix + path, {
      method: body ? 'POST' : 'GET',
      credentials: 'include',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'X-Oathweave-Browser': 'true',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || Array.isArray(result))
      throw new Error('Invalid identity response');
    if (!response.ok) throw new Error('Sign in to continue');
    return result as Record<string, unknown>;
  }
  async function authorize(product: Product) {
    const started = generation;
    const client = config.clients[product];
    if (!client) throw new Error('Sign-in is not configured for this product');
    const verifier = random(),
      state = random(),
      nonce = random();
    const challenge = encode(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(verifier),
        ),
      ),
    );
    const redirectUri = location.origin + '/auth/callback';
    const authorization = await json('/oauth/authorize', {
      clientId: client,
      redirectUri,
      responseType: 'code',
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      state,
      nonce,
      scope: 'openid profile',
    });
    if (
      authorization.state !== state ||
      authorization.iss !== config.issuer ||
      typeof authorization.code !== 'string'
    )
      throw new Error('Invalid authorization response');
    const token = await json('/oauth/token', {
      grant_type: 'authorization_code',
      client_id: client,
      code: authorization.code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });
    if (
      typeof token.id_token !== 'string' ||
      typeof token.access_token !== 'string' ||
      token.token_type !== 'Bearer' ||
      typeof token.expires_in !== 'number' ||
      token.expires_in < 1 ||
      token.expires_in > 900
    )
      throw new Error('Invalid token response');
    const identity = await jwtVerify(token.id_token, keys, {
      algorithms: ['RS256'],
      issuer: config.issuer,
      audience: client,
      requiredClaims: ['sub', 'iat', 'exp'],
      maxTokenAge: '5m',
    });
    if (identity.payload.nonce !== nonce)
      throw new Error('Invalid identity nonce');
    const hash = new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(token.access_token),
      ),
    );
    if (identity.payload.at_hash !== encode(hash.slice(0, hash.length / 2)))
      throw new Error('Identity token does not bind this access token');
    if (started !== generation) throw new Error('Sign-in session ended');
    const expiresAt = Date.now() + token.expires_in * 1000;
    rememberAccess(product, token.access_token, expiresAt);
    expiry.set(product, expiresAt);
  }
  async function ensure(product: Product) {
    if ((expiry.get(product) ?? 0) > Date.now() + 30000) return;
    let operation = pending.get(product);
    if (!operation) {
      const created = authorize(product);
      operation = created;
      pending.set(product, created);
      void created
        .finally(() => {
          if (pending.get(product) === created) pending.delete(product);
        })
        .catch(() => {});
    }
    await operation;
  }
  async function me(): Promise<{ user: AdminUser }> {
    const result = await json('/browser/session');
    const principal = result.principal;
    if (
      !principal ||
      typeof principal !== 'object' ||
      !('sub' in principal) ||
      typeof principal.sub !== 'string'
    )
      throw new Error('Sign in to continue');
    const username =
      'username' in principal && typeof principal.username === 'string'
        ? principal.username
        : principal.sub;
    const permissions =
      'permissions' in principal && Array.isArray(principal.permissions)
        ? principal.permissions.filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
    const roles =
      'roles' in principal && Array.isArray(principal.roles)
        ? principal.roles.filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
    return { user: { id: principal.sub, username, permissions, roles } };
  }
  async function login(username: string, password: string) {
    const result = await json('/auth/login', { username, password });
    if (result.requiresMfa === true && typeof result.mfaToken === 'string')
      throw new MfaRequired(
        result.mfaToken,
        Array.isArray(result.methods)
          ? result.methods.filter(
              (value): value is string => typeof value === 'string',
            )
          : [],
      );
    return { ...(await me()), ok: true };
  }
  async function completeMfa(token: string, code: string) {
    await json('/auth/mfa/challenge', { mfaToken: token, code });
    return { ...(await me()), ok: true };
  }
  function invalidate() {
    generation++;
    clearAccess();
    expiry.clear();
    pending.clear();
  }
  async function logout() {
    invalidate();
    try {
      await json('/browser/logout', {});
    } finally {
      invalidate();
    }
  }
  return { ensure, me, login, completeMfa, logout, invalidate };
}
