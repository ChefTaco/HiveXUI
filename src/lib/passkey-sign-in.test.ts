// Passkey-only accounts: a passwordless sign-in with a discoverable passkey, and a re-authentication
// (prompt=login) that a passkey alone completes on the same session. No password is ever sent.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createBrowserAuth, PasskeySignInUnavailable } from './browser-auth';
import { subscribeIdentityPrompts, type IdentityPrompt } from './identity-prompts';
import { PasskeyCancelled } from './passkeys';
import { clearAccess } from './transport';

vi.stubGlobal('crypto', webcrypto);
vi.stubGlobal('location', { origin: 'https://console.example.com' });
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => { keys = await generateKeyPair('RS256'); });

const bytes = (text: string) => new TextEncoder().encode(text).buffer;
const b64 = (text: string) => Buffer.from(text).toString('base64url');
/** A WebAuthn assertion as the browser returns it; `get` records the options it was asked with. */
function stubWebAuthn(get = vi.fn(async (_options: CredentialRequestOptions) => ({
  id: 'credential-1', type: 'public-key', rawId: bytes('credential-1'), authenticatorAttachment: 'platform',
  getClientExtensionResults: () => ({}),
  response: { clientDataJSON: bytes('{}'), authenticatorData: bytes('auth'), signature: bytes('sig'), userHandle: bytes('user-1') },
}) as unknown as Credential)) {
  vi.stubGlobal('window', { PublicKeyCredential: function PublicKeyCredential() {} });
  vi.stubGlobal('navigator', { credentials: { get } });
  return get;
}

let unsubscribe: (() => void) | undefined;
afterEach(() => {
  unsubscribe?.();
  unsubscribe = undefined;
  clearAccess();
  vi.unstubAllGlobals();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('location', { origin: 'https://console.example.com' });
});

const SUB = 'fixture-user';
function fixture(options: { passwordless?: boolean; sub?: string } = {}) {
  const codes = new Map<string, { clientId: string; nonce: string }>();
  let verified = false, count = 0;
  const send = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const path = String(input), body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (path.endsWith('/oauth/jwks')) return Response.json({ keys: [{ ...await exportJWK(keys.publicKey), kid: 'fixture' }] });
    if (path.endsWith('/browser/session')) return Response.json({ principal: { sub: SUB, username: 'paula', roles: [], permissions: [] } });
    if (path.endsWith('/mfa/webauthn/passwordless/options'))
      return options.passwordless === false
        ? Response.json({ error: 'NOT_FOUND', message: 'Passwordless sign-in is turned off' }, { status: 404 })
        : Response.json({ success: true, data: { challenge: b64('passwordless-challenge'), allowCredentials: [], userVerification: 'required', rpId: 'console.example.com' }, ceremonyId: 'c'.repeat(43) });
    if (path.endsWith('/mfa/webauthn/passwordless/authenticate')) return Response.json({ success: true, verified: true, sessionId: 'session-2', user: { id: SUB, email: 'paula@example.com', username: 'paula', displayName: null, roles: [], permissions: [] } });
    if (path.endsWith('/auth/step-up/options')) return Response.json({ data: { challenge: b64('step-up-challenge'), allowCredentials: [{ id: b64('credential-1'), type: 'public-key' }], userVerification: 'required' } });
    if (path.endsWith('/auth/step-up')) {
      if (body.password === undefined && options.passwordless === false) return Response.json({ error: 'PASSWORD_REQUIRED', message: 'Password is required for step-up verification' }, { status: 400 });
      verified = true;
      return Response.json({ success: true, message: 'Step-up authentication verified' });
    }
    if (path.endsWith('/oauth/authorize/cancel')) return Response.json({ error: 'access_denied', error_description: 'Sign-in cancelled', state: body.state, iss: 'https://identity.example.com', redirectTo: `${String(body.redirectUri)}?error=access_denied` });
    if (path.endsWith('/oauth/authorize') && body.prompt === 'login' && (!body.loginTicket || !verified))
      return Response.json({ error: 'LOGIN_REQUIRED', message: 'Sign in again', reason: 'prompt_login', loginTicket: 'fixture-ticket', loginTicketExpiresIn: 600 }, { status: 401 });
    if (path.endsWith('/oauth/authorize')) {
      const code = 'fixture-code-' + (++count);
      codes.set(code, { clientId: String(body.clientId), nonce: String(body.nonce) });
      return Response.json({ code, state: body.state, iss: 'https://identity.example.com' });
    }
    if (path.endsWith('/oauth/token')) {
      const issued = codes.get(String(body.code))!;
      const access = 'obviously-fake-' + issued.clientId;
      const at_hash = createHash('sha256').update(access).digest().subarray(0, 16).toString('base64url');
      const id = await new SignJWT({ nonce: issued.nonce, at_hash, auth_time: Math.floor(Date.now() / 1000) }).setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
        .setSubject(options.sub ?? SUB).setIssuer('https://identity.example.com').setAudience(issued.clientId).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
      return Response.json({ access_token: access, id_token: id, token_type: 'Bearer', expires_in: 300 });
    }
    throw Error('Unexpected fixture endpoint ' + path);
  });
  const auth = createBrowserAuth({ issuer: 'https://identity.example.com', apiPrefix: '/api/identity', clients: { oathweave: 'hivexui-oathweave' } }, send);
  const calls = () => send.mock.calls.map(([input, init]) => ({ path: String(input), body: String(init?.body ?? '') }));
  return { auth, send, calls };
}

describe('passwordless passkey sign-in', () => {
  it('asks for a discoverable passkey with user verification and signs in without a password', async () => {
    const get = stubWebAuthn();
    const run = fixture();
    expect(run.auth.passkeySignInOffered()).toBe(true);
    const result = await run.auth.signInWithPasskey();
    expect(result.user).toMatchObject({ id: SUB, username: 'paula' });
    const publicKey = get.mock.calls[0]![0].publicKey!;
    expect(publicKey.allowCredentials).toEqual([]);
    expect(publicKey.userVerification).toBe('required');
    const calls = run.calls();
    expect(calls.map((call) => call.path)).toEqual(['/api/identity/mfa/webauthn/passwordless/options', '/api/identity/mfa/webauthn/passwordless/authenticate', '/api/identity/browser/session']);
    expect(JSON.parse(calls[1]!.body)).toMatchObject({ ceremonyId: 'c'.repeat(43), response: { id: 'credential-1', type: 'public-key' } });
    expect(calls.some((call) => call.body.includes('password'))).toBe(false);
    for (const [, init] of run.send.mock.calls) expect(new Headers(init?.headers).get('X-Oathweave-Browser')).toBe('true');
  });

  it('stops offering it when Oathweave answers 404 (passwordless sign-in turned off)', async () => {
    const get = stubWebAuthn();
    const run = fixture({ passwordless: false });
    await expect(run.auth.signInWithPasskey()).rejects.toBeInstanceOf(PasskeySignInUnavailable);
    expect(get).not.toHaveBeenCalled();
    expect(run.auth.passkeySignInOffered()).toBe(false);
  });

  it('is not offered without WebAuthn in the browser', () => {
    vi.stubGlobal('window', {});
    expect(fixture().auth.passkeySignInOffered()).toBe(false);
  });

  it('reports a cancelled passkey prompt and sends nothing to authenticate', async () => {
    stubWebAuthn(vi.fn(async () => { throw new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'); }));
    const run = fixture();
    await expect(run.auth.signInWithPasskey()).rejects.toBeInstanceOf(PasskeyCancelled);
    expect(run.calls().some((call) => call.path.endsWith('/passwordless/authenticate'))).toBe(false);
  });
});

describe('re-authentication with a passkey alone', () => {
  it('verifies the same session with the passkey, no password, then completes prompt=login with the ticket', async () => {
    const get = stubWebAuthn();
    const prompts: IdentityPrompt[] = [];
    unsubscribe = subscribeIdentityPrompts((prompt) => {
      if (prompt?.kind !== 'step-up') return;
      prompts.push(prompt);
      prompt.resolve({ passkey: true });
    });
    const run = fixture();
    await run.auth.stepUp('oathweave');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ kind: 'step-up', passkeyOnly: true });
    expect(get.mock.calls[0]![0].publicKey!.userVerification).toBe('required');
    const calls = run.calls();
    const stepUp = calls.filter((call) => call.path === '/api/identity/auth/step-up');
    expect(stepUp).toHaveLength(1);
    const body = JSON.parse(stepUp[0]!.body) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['assertion']);
    expect(calls.some((call) => call.body.includes('password'))).toBe(false);
    // A same-session step-up: no new sign-in, so the SSO session stays the person's own.
    expect(calls.some((call) => call.path.includes('/passwordless/'))).toBe(false);
    const forced = calls.filter((call) => call.path.endsWith('/oauth/authorize')).map((call) => JSON.parse(call.body) as Record<string, unknown>);
    expect(forced).toHaveLength(2);
    expect(forced[0]).toMatchObject({ prompt: 'login' });
    expect(forced[0]).not.toHaveProperty('loginTicket');
    expect(forced[1]).toMatchObject({ prompt: 'login', loginTicket: 'fixture-ticket' });
  });

  it('refuses an ID token for another person after a passkey re-authentication', async () => {
    stubWebAuthn();
    unsubscribe = subscribeIdentityPrompts((prompt) => { if (prompt?.kind === 'step-up') prompt.resolve({ passkey: true }); });
    await expect(fixture({ sub: 'someone-else' }).auth.stepUp('oathweave')).rejects.toThrow('different account');
  });

  it('asks for the password next time when Oathweave needs it (passwordless turned off)', async () => {
    stubWebAuthn();
    const prompts: IdentityPrompt[] = [];
    unsubscribe = subscribeIdentityPrompts((prompt) => {
      if (prompt?.kind !== 'step-up') return;
      prompts.push(prompt);
      prompt.resolve(prompts.length === 1 ? { passkey: true } : null);
    });
    const run = fixture({ passwordless: false });
    await expect(run.auth.stepUp('oathweave')).rejects.toThrow('needs your password');
    await expect(run.auth.stepUp('oathweave')).rejects.toThrow('cancelled');
    expect(prompts.map((prompt) => prompt.kind === 'step-up' && prompt.passkeyOnly)).toEqual([true, false]);
  });

  it('keeps password and authenticator code re-authentication (MFA) unchanged', async () => {
    unsubscribe = subscribeIdentityPrompts((prompt) => { if (prompt?.kind === 'step-up') prompt.resolve({ password: 'obviously-fake-password', totpCode: '123456' }); });
    const run = fixture();
    await run.auth.stepUp('oathweave');
    const stepUp = run.calls().filter((call) => call.path === '/api/identity/auth/step-up');
    expect(JSON.parse(stepUp[0]!.body)).toEqual({ password: 'obviously-fake-password', totpCode: '123456' });
  });
});
