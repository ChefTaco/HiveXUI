import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { clearAccess, createApiFetch, refreshResourceAccess, rememberAccess, type Product } from './transport';
import { apiFailureFromBody, createRequestId, failureMeta, HiveApiError, rememberSentRequestId, REQUEST_ID_HEADER, responseRequestId } from './api-error';
import type { AdminUser } from './types';
import { z } from 'zod';
import { authorizationErrorRedirect, authorizationRedirect, validatePortalAuthorization, type PortalAuthorizationRequest } from './authorization-portal';
import {
  cancelIdentityPrompts,
  requestConsent,
  requestStepUp,
} from './identity-prompts';
import { authenticatePasskey } from './passkeys';
import { sessionEnded } from './session-events';
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
  AuthorizeCancelRequestSchema,
  BrowserLoginRequiredResponseSchema,
  TokenExchangeRequestSchema,
  IamSuccessResponseSchema, BrowserMessageResponseSchema, BrowserOkResponseSchema, BrowserConsentDetailsSchema, BrowserAuthorizationResponseSchema, BrowserTokenResponseSchema, BrowserSessionResponseSchema, BrowserLoginResponseSchema,
} from '../../contracts/oathweave-browser.generated';

/**
 * Oathweave refused a sign-in because the password is older than the policy allows. Oathweave has
 * no signed-out password change, so the way on is password recovery: a code sent to the account's
 * email, then a new password set with it.
 */
export class PasswordExpired extends Error {
  override name = 'PasswordExpired';
  constructor() {
    super('Your Oathweave password has expired. Request a recovery code below, then set a new password with it.');
  }
}

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

/**
 * Oathweave needs a new sign-in before it answers this authorization (`prompt=login`, `max_age`,
 * or no session). The same request is repeated with `ticket` after the person signs in.
 */
export class LoginRequired extends Error {
  override name = 'LoginRequired';
  constructor(
    readonly ticket: string,
    readonly reason: 'no_session' | 'prompt_login' | 'max_age',
  ) {
    super('Sign in again to continue');
  }
}

/** The person closed the identity check: no password was sent and nothing changed. */
export class ReauthenticationCancelled extends Error {
  override name = 'ReauthenticationCancelled';
  constructor() {
    super('Identity verification was cancelled, so nothing was changed. Start the action again when you are ready.');
  }
}

/** Emberpath's step-up answers (Emberpath docs/OATHWEAVE.md, "Step-up with an ID token"). */
const StepUpChallengeSchema = z.object({ nonce: z.string().regex(/^[A-Za-z0-9_-]{16,256}$/), startedAt: z.iso.datetime({ offset: true }) });
const StepUpResultSchema = z.object({ ok: z.literal(true), authTime: z.string(), recentUntil: z.string() });
/**
 * Products whose server records a step-up from the ID token itself, and where (browser paths: the
 * ingress maps /api/emberpath/* to Emberpath's /api/*).
 */
const PRODUCT_STEP_UP: Partial<Record<Product, { challenge: string; proof: string }>> = {
  emberpath: { challenge: '/api/emberpath/auth/step-up/challenge', proof: '/api/emberpath/auth/step-up' },
};
/** Seconds of clock difference between this browser and the identity provider that are tolerated. */
const AUTH_TIME_TOLERANCE_SEC = 30;

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
  // The part of a step-up that changes the session's sign-in time: new authorizations wait for it.
  let verifying: Promise<void> | undefined;
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
        '/oauth/authorize/cancel': AuthorizeCancelRequestSchema,
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
    // A gateway error page or an empty answer is not JSON. Report the status, not a parser error.
    const result: unknown = await response.json().catch(() => undefined);
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      if (!response.ok)
        throw new HiveApiError(
          response.status,
          response.status >= 500
            ? `Oathweave could not be reached (HTTP ${response.status}). Try again in a moment.`
            : `Oathweave refused the request (HTTP ${response.status})`,
          { requestId: responseRequestId(response) },
        );
      throw new Error('Invalid identity response');
    }
    if (
      response.status === 403 &&
      'passwordExpired' in result &&
      result.passwordExpired === true
    )
      throw new PasswordExpired();
    // Oathweave no longer knows this browser session: every page returns to sign-in, not just this one.
    // A request for a new sign-in (prompt=login, max_age) is not the end of the session.
    const freshSignIn = 'error' in result && result.error === 'LOGIN_REQUIRED' && 'reason' in result && result.reason !== 'no_session';
    if (response.status === 401 && (path === '/browser/session' || (path === '/oauth/authorize' && !freshSignIn))) sessionEnded('expired');
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
    const verification = verifying;
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
      const capability = (url: string) => {
        let redirected = false;
        return { redirect(navigate: (value: string) => void) {
          current();
          if (redirected) return;
          redirected = true;
          navigate(url);
        } };
      };
      // An answer that must end at the application: prompt=none, declined consent, cancellation.
      const toApplication = (error: unknown) =>
        error instanceof IdentityApiError && typeof error.data.redirectTo === 'string'
          ? capability(authorizationErrorRedirect(parameters, error.data, config.issuer))
          : undefined;
      let response: unknown;
      try {
        response = await json('/oauth/authorize', parameters);
      } catch (error) {
        current();
        if (error instanceof IdentityApiError && error.data.error === 'LOGIN_REQUIRED') {
          const required = BrowserLoginRequiredResponseSchema.parse(error.data);
          throw new LoginRequired(required.loginTicket, required.reason);
        }
        const ended = toApplication(error);
        if (ended) return ended;
        if (!(error instanceof IdentityApiError) || error.data.error !== 'CONSENT_REQUIRED') throw error;
        const accepted = await requestConsent(consentDetails.parse(error.data));
        current();
        if (!accepted) {
          // Oathweave sends the refusal back to the application as access_denied.
          try {
            await json('/oauth/authorize', { ...parameters, consent: 'deny' });
          } catch (denied) {
            current();
            const back = toApplication(denied);
            if (back) return back;
          }
          throw new Error('Access was not approved. Return to the application to start again.');
        }
        response = await json('/oauth/authorize', { ...parameters, consent: 'approve' });
      }
      current();
      return capability(authorizationRedirect(parameters, response, config.issuer));
    })();
    portalApprovals.set(key, approval);
    return approval;
  }
  /** The person cancelled sign-in on the portal: Oathweave returns access_denied to the application. */
  async function cancelAuthorization(input: PortalAuthorizationRequest): Promise<string> {
    const parameters = validatePortalAuthorization(input);
    const { prompt: _prompt, maxAge: _maxAge, loginTicket: _ticket, ...fields } = parameters;
    const answer = await json('/oauth/authorize/cancel', fields);
    return authorizationErrorRedirect(parameters, answer, config.issuer);
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
  /**
   * Re-authentication before a sensitive action, as an OpenID Connect round trip in this page:
   *
   * 1. The product that asked (Emberpath) issues a single-use nonce, or the browser makes one.
   * 2. Oathweave is asked to authorize the product's client with `prompt=login`, PKCE and that
   *    nonce. It answers LOGIN_REQUIRED with a login ticket.
   * 3. The person verifies their identity with Oathweave itself (password and code, or passkey).
   *    The password goes only to Oathweave, never to a product.
   * 4. The same request is repeated with the ticket; the code is exchanged with PKCE and the ID
   *    token checked here (signature, issuer, client, nonce, the same person, a new auth_time).
   * 5. The product's server checks the ID token again and records the step-up; every product's
   *    credential is then renewed, so each carries the new auth_time.
   *
   * The pending action never leaves memory: the caller awaits this and then continues. Cancelling
   * leaves the action undone.
   */
  async function duringVerification<T>(work: () => Promise<T>): Promise<T> {
    let done!: () => void;
    const phase = new Promise<void>(resolve => { done = resolve; });
    verifying = phase;
    try {
      return await work();
    } finally {
      done();
      if (verifying === phase) verifying = undefined;
    }
  }
  function stepUp(product?: Product): Promise<void> {
    if (pendingStepUp) return pendingStepUp;
    const started = generation;
    const current = () => {
      if (started !== generation) throw new Error('Sign-in session ended; verify your identity again');
    };
    const operation = (async () => {
      const target = (product && config.clients[product] ? product : (Object.keys(config.clients) as Product[]).find(name => config.clients[name])) as Product | undefined;
      const client = target && config.clients[target];
      if (!target || !client) throw new Error('Sign-in is not configured for this product');
      const person = (await me()).user.id;
      current();
      let server = PRODUCT_STEP_UP[target];
      const productApi = createApiFetch(request, { stepUp: false });
      let nonce = random();
      let startedAt = Math.floor(Date.now() / 1000);
      if (server) {
        const answer = await productApi(server.challenge, { method: 'POST' });
        // A release without the endpoint checks only its access token's auth_time, which the
        // renewal below makes new: verify with Oathweave and skip the proof.
        if (answer.status === 404) server = undefined;
        else if (!answer.ok) throw new HiveApiError(answer.status, 'The product could not start identity verification', { requestId: responseRequestId(answer) });
        else {
          const challenge = StepUpChallengeSchema.parse(await answer.json());
          nonce = challenge.nonce;
          startedAt = Math.floor(Date.parse(challenge.startedAt) / 1000);
        }
      }
      current();
      // From here until the credentials are renewed, new authorizations wait: one that crossed the
      // new sign-in could carry the old auth_time.
      const idToken = await duringVerification(async () => {
        const verifier = random(), state = random();
        const codeChallenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
        const redirectUri = location.origin + '/auth/callback';
        const parameters = { clientId: client, redirectUri, responseType: 'code', codeChallenge, codeChallengeMethod: 'S256', state, nonce, scope: 'openid profile', prompt: 'login' };
        const authorizeWith = async (loginTicket?: string): Promise<Record<string, unknown> | LoginRequired> => {
          try {
            return BrowserAuthorizationResponseSchema.parse(await json('/oauth/authorize', loginTicket ? { ...parameters, loginTicket } : parameters));
          } catch (error) {
            if (error instanceof IdentityApiError && error.data.error === 'LOGIN_REQUIRED') {
              const required = BrowserLoginRequiredResponseSchema.parse(error.data);
              return new LoginRequired(required.loginTicket, required.reason);
            }
            throw error;
          }
        };
        let authorization = await authorizeWith();
        current();
        if (authorization instanceof LoginRequired) {
          const ticket = authorization.ticket;
          const input = await requestStepUp();
          current();
          if (!input) {
            // Best effort: tell Oathweave, which ends the ticket; the action stays undone either way.
            void json('/oauth/authorize/cancel', { clientId: client, redirectUri, responseType: 'code', codeChallenge, codeChallengeMethod: 'S256', scope: 'openid profile', state, nonce }).catch(() => {});
            throw new ReauthenticationCancelled();
          }
          let assertion: Record<string, unknown> | undefined;
          if (input.passkey) {
            const options = await json('/auth/step-up/options', {});
            current();
            assertion = await authenticatePasskey(PasskeyOptionsResponseSchema.parse(options).data);
            current();
          }
          IamSuccessResponseSchema.parse(await json('/auth/step-up', {
            password: input.password,
            ...(input.totpCode ? { totpCode: input.totpCode } : {}),
            ...(assertion ? { assertion } : {}),
          }));
          current();
          authorization = await authorizeWith(ticket);
          current();
          if (authorization instanceof LoginRequired) throw new Error('Oathweave did not accept the new sign-in. Try again.');
        }
        if (authorization.state !== state || authorization.iss !== config.issuer || typeof authorization.code !== 'string')
          throw new Error('Invalid authorization response');
        const token = BrowserTokenResponseSchema.parse(await json('/oauth/token', {
          grant_type: 'authorization_code', client_id: client, code: authorization.code, code_verifier: verifier, redirect_uri: redirectUri,
        }));
        current();
        if (typeof token.id_token !== 'string' || typeof token.access_token !== 'string' || token.token_type !== 'Bearer' ||
            typeof token.expires_in !== 'number' || token.expires_in < 1 || token.expires_in > 900)
          throw new Error('Invalid token response');
        const identity = await jwtVerify(token.id_token, keys, {
          algorithms: ['RS256'], issuer: config.issuer, audience: client, requiredClaims: ['sub', 'iat', 'exp', 'auth_time'], maxTokenAge: '5m',
        });
        const claims = identity.payload;
        if (claims.nonce !== nonce) throw new Error('Invalid identity nonce');
        // A different account can sign in during a forced login: it must be the same person.
        if (claims.sub !== person) throw new Error('A different account verified. Sign in again as yourself.');
        if (typeof claims.auth_time !== 'number' || claims.auth_time < startedAt - AUTH_TIME_TOLERANCE_SEC)
          throw new Error('Oathweave did not confirm a new sign-in. Try again.');
        const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token.access_token)));
        if (claims.at_hash !== encode(hash.slice(0, hash.length / 2))) throw new Error('Identity token does not bind this access token');
        current();
        // This is still the same person and session. Preserve in-flight authorizations, consent
        // decisions and portal continuations; renew only the resource credentials.
        credentialEpoch++;
        refreshResourceAccess();
        expiry.clear();
        const expiresAt = Date.now() + token.expires_in * 1000;
        rememberAccess(target, token.access_token, expiresAt);
        expiry.set(target, expiresAt);
        return token.id_token;
      });
      if (server) {
        const answer = await productApi(server.proof, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }) });
        const body: unknown = await answer.json().catch(() => null);
        if (!answer.ok) {
          const failure = apiFailureFromBody(answer.status, body && typeof body === 'object' ? body as Record<string, unknown> : {}, { fallback: 'The product refused the identity verification', response: answer });
          throw new HiveApiError(answer.status, failure.message, { ...failureMeta(failure), code: failure.code });
        }
        StepUpResultSchema.parse(body);
      }
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
    verifying = undefined;
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
    cancelAuthorization,
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
