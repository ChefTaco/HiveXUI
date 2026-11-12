import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { clearAccess, refreshResourceAccess, rememberAccess, type Product } from './transport';
import { apiFailureFromBody, createRequestId, failureMeta, HiveApiError, rememberSentRequestId, REQUEST_ID_HEADER } from './api-error';
import type { AdminUser } from './types';
import { z } from 'zod';
import { authorizationRedirect, validatePortalAuthorization, type PortalAuthorizationRequest } from './authorization-portal';
import {
  cancelIdentityPrompts,
  requestConsent,
  requestStepUp,
} from './identity-prompts';
import { authenticatePasskey } from './passkeys';
import {
  LoginRequestSchema,
  MfaChallengeRequestSchema,
  ForgotPasswordRequestSchema,
  ResetPasswordRequestSchema,
  StepUpRequestSchema,
  PasskeyAuthenticationOptionsRequestSchema,
  PasskeyAuthenticationRequestSchema,
  PasskeyOptionsResponseSchema,
  AuthorizeConsentRequestSchema,
  TokenExchangeRequestSchema,
  IamSuccessResponseSchema, BrowserMessageResponseSchema, BrowserOkResponseSchema, BrowserConsentDetailsSchema, BrowserAuthorizationResponseSchema, BrowserTokenResponseSchema, BrowserSessionResponseSchema, BrowserLoginResponseSchema,
} from '../../contracts/oathweave-browser.generated';

/** A refusal from Oathweave's browser API. `data` is its body, which consent prompts read. */
class IdentityApiError extends HiveApiError {
  override name = 'IdentityApiError';
  constructor(
    status: number,
    readonly data: Record<string, unknown>,
    response?: Response,
  ) {
    const failure = apiFailureFromBody(status, data, { fallback: 'Sign in to continue', response });
    super(status, failure.message, { ...failureMeta(failure), code: failure.code });
  }
}
const consentDetails = BrowserConsentDetailsSchema;

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
  const issuerUrl = new URL(config.issuer);
  if (
    !/^\/api\/[a-z][a-z0-9-]*$/.test(config.apiPrefix) ||
    issuerUrl.protocol !== 'https:' ||
    issuerUrl.username ||
    issuerUrl.password ||
    issuerUrl.search ||
    issuerUrl.hash
  )
    throw new Error('Invalid identity configuration');
  const pending = new Map<Product, Promise<void>>();
  const expiry = new Map<Product, number>();
  const declined = new Set<Product>();
  let generation = 0;
  let credentialEpoch = 0;
  let pendingStepUp: Promise<void> | undefined;
  // Retain settled results, including declines, until session invalidation. React
  // effect replay and concurrent callers must never mint a second code.
  const portalApprovals = new Map<string, Promise<{ redirect: (navigate: (url: string) => void) => void }>>();
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
    const schema = (
      {
        '/auth/login': LoginRequestSchema,
        '/auth/mfa/challenge': MfaChallengeRequestSchema,
        '/auth/forgot-password': ForgotPasswordRequestSchema,
        '/auth/reset-password': ResetPasswordRequestSchema,
        '/auth/step-up': StepUpRequestSchema,
        '/mfa/webauthn/authenticate-options':
          PasskeyAuthenticationOptionsRequestSchema,
        '/mfa/webauthn/authenticate': PasskeyAuthenticationRequestSchema,
        '/oauth/authorize': AuthorizeConsentRequestSchema,
        '/oauth/token': TokenExchangeRequestSchema,
      } as Record<string, z.ZodType>
    )[path];
    if (body && schema) body = schema.parse(body) as object;
    const requestId = createRequestId();
    const response = await request(config.apiPrefix + path, {
      method: body ? 'POST' : 'GET',
      credentials: 'include',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'X-Oathweave-Browser': 'true',
        [REQUEST_ID_HEADER]: requestId,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    rememberSentRequestId(response, requestId);
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || Array.isArray(result))
      throw new Error('Invalid identity response');
    if (
      response.status === 403 &&
      'passwordExpired' in result &&
      result.passwordExpired === true
    )
      throw new Error(
        'Your Oathweave password has expired. Complete password recovery with your identity administrator, then sign in again.',
      );
    if (!response.ok)
      throw new IdentityApiError(
        response.status,
        result as Record<string, unknown>,
        response,
      );
    return result as Record<string, unknown>;
  }
  async function waitForVerification(started: number): Promise<void> {
    // Verification upgrades this session; it must not cancel unrelated consent.
    // A failed verification leaves ordinary product authorization unchanged.
    const verification = pendingStepUp;
    if (verification) await verification.catch(() => {});
    if (started !== generation) throw new Error('Sign-in session ended');
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
    const parameters = {
      clientId: client,
      redirectUri,
      responseType: 'code',
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      state,
      nonce,
      scope: 'openid profile',
    };
    let authorization: Record<string, unknown>;
    try {
      authorization = BrowserAuthorizationResponseSchema.parse(await json('/oauth/authorize', parameters));
    } catch (error) {
      if (
        !(error instanceof IdentityApiError) ||
        error.data.error !== 'CONSENT_REQUIRED'
      )
        throw error;
      const approved = await requestConsent(consentDetails.parse(error.data));
      if (started !== generation) throw new Error('Sign-in session ended');
      if (!approved) {
        declined.add(product);
        throw new Error('Access was not approved');
      }
      authorization = BrowserAuthorizationResponseSchema.parse(await json('/oauth/authorize', {
        ...parameters,
        consent: 'approve',
      }));
    }
    if (
      authorization.state !== state ||
      authorization.iss !== config.issuer ||
      typeof authorization.code !== 'string'
    )
      throw new Error('Invalid authorization response');
    await waitForVerification(started);
    const exchangedAt = credentialEpoch;
    const token = BrowserTokenResponseSchema.parse(await json('/oauth/token', {
      grant_type: 'authorization_code',
      client_id: client,
      code: authorization.code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }));
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
    // An exchange that crossed verification may carry the previous auth_time.
    // Discard it rather than overwriting a newly refreshed resource credential.
    if (exchangedAt !== credentialEpoch) return false;
    const expiresAt = Date.now() + token.expires_in * 1000;
    rememberAccess(product, token.access_token, expiresAt);
    expiry.set(product, expiresAt);
    return true;
  }
  function approveAuthorization(input: PortalAuthorizationRequest) {
    const parameters = validatePortalAuthorization(input);
    const key = JSON.stringify(parameters);
    const existing = portalApprovals.get(key);
    if (existing) return existing;
    const started = generation;
    const current = () => {
      if (started !== generation) throw new Error('Sign-in session ended; start authorization again');
    };
    const approval = (async () => {
      let response: unknown;
      try {
        response = await json('/oauth/authorize', parameters);
      } catch (error) {
        current();
        if (!(error instanceof IdentityApiError) || error.data.error !== 'CONSENT_REQUIRED') throw error;
        const accepted = await requestConsent(consentDetails.parse(error.data));
        current();
        if (!accepted) throw new Error('Access was not approved. Return to the application to start again.');
        response = await json('/oauth/authorize', { ...parameters, consent: 'approve' });
      }
      current();
      const url = authorizationRedirect(parameters, response, config.issuer);
      let redirected = false;
      return { redirect(navigate: (value: string) => void) {
        current();
        if (redirected) return;
        redirected = true;
        navigate(url);
      } };
    })();
    portalApprovals.set(key, approval);
    return approval;
  }
  async function ensure(product: Product) {
    if (declined.has(product))
      throw new Error(
        'Product access was declined. Select Retry to review access again.',
      );
    if ((expiry.get(product) ?? 0) > Date.now() + 30000) return;
    let operation = pending.get(product);
    if (!operation) {
      const started = generation;
      const created = (async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          await waitForVerification(started);
          if (await authorize(product)) return;
        }
        throw new Error('Identity verification changed again; retry this read');
      })();
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
    const result = BrowserSessionResponseSchema.parse(await json('/browser/session'));
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
    const result = BrowserLoginResponseSchema.parse(await json('/auth/login', { username, password }));
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
    BrowserLoginResponseSchema.parse(await json('/auth/mfa/challenge', { mfaToken: token, code }));
    return { ...(await me()), ok: true };
  }
  async function completePasskey(token: string) {
    const options = await json('/mfa/webauthn/authenticate-options', {
      mfaToken: token,
    });
    const response = await authenticatePasskey(
      PasskeyOptionsResponseSchema.parse(options).data,
    );
    BrowserLoginResponseSchema.parse(await json('/mfa/webauthn/authenticate', { mfaToken: token, response }));
    return { ...(await me()), ok: true };
  }
  async function recover(email: string): Promise<string> {
    const response = BrowserMessageResponseSchema.parse(await json('/auth/forgot-password', { email }));
    return typeof response.message === 'string'
      ? response.message
      : 'Check your recovery channel for instructions';
  }
  async function resetPassword(
    token: string,
    newPassword: string,
  ): Promise<void> {
    BrowserMessageResponseSchema.parse(await json('/auth/reset-password', { token, newPassword }));
    invalidate();
  }
  function stepUp(): Promise<void> {
    if (pendingStepUp) return pendingStepUp;
    const started = generation;
    const current = () => {
      if (started !== generation) throw new Error('Sign-in session ended; verify your identity again');
    };
    const operation = (async () => {
      const input = await requestStepUp();
      current();
      if (!input) throw new Error('Identity verification cancelled');
      let assertion: Record<string, unknown> | undefined;
      if (input.passkey) {
        const options = await json('/auth/step-up/options', {});
        current();
        assertion = await authenticatePasskey(
          PasskeyOptionsResponseSchema.parse(options).data,
        );
        current();
      }
      IamSuccessResponseSchema.parse(await json('/auth/step-up', {
        password: input.password,
        ...(input.totpCode ? { totpCode: input.totpCode } : {}),
        ...(assertion ? { assertion } : {}),
      }));
      current();
      // This is still the same user/session. Preserve in-flight authorizations,
      // consent decisions and portal continuations; expire only resource claims.
      credentialEpoch++;
      refreshResourceAccess();
      expiry.clear();
    })();
    pendingStepUp = operation;
    void operation.finally(() => {
      if (pendingStepUp === operation) pendingStepUp = undefined;
    }).catch(() => {});
    return operation;
  }
  function invalidate() {
    generation++;
    portalApprovals.clear();
    pendingStepUp = undefined;
    clearAccess();
    expiry.clear();
    pending.clear();
    declined.clear();
    cancelIdentityPrompts();
  }
  async function logout() {
    invalidate();
    try {
      BrowserOkResponseSchema.parse(await json('/browser/logout', {}));
    } finally {
      invalidate();
    }
  }
  return {
    ensure,
    approveAuthorization,
    retryConsent: () => declined.clear(),
    me,
    login,
    completeMfa,
    completePasskey,
    recover,
    resetPassword,
    stepUp,
    logout,
    invalidate,
  };
}
