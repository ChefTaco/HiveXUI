// @vitest-environment jsdom
// "Sign in with a passkey" on the Oathweave sign-in form, and "Verify with a passkey" in the
// re-authentication dialog: a passkey-only account signs in and re-authenticates without a password.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, settle, stubBrowser, type Mounted } from './modules/magnus/test-dom';
import { requestStepUp } from './lib/identity-prompts';
import { IdentityPrompts } from './components/identity-prompts';

const runtime = {
  schema: 1,
  products: { oathweave: '/api/iam' },
  identity: { issuer: 'https://identity.example.com', apiPrefix: '/api/oathweave', clients: { oathweave: 'hivexui-oathweave' } },
};
const bytes = (text: string) => new TextEncoder().encode(text).buffer;

let view: Mounted | undefined;
let requests: { path: string; body: string }[] = [];
let passwordless = true;
let signedIn = false;
let activeRuntime: object = runtime;
beforeEach(() => {
  stubBrowser();
  requests = [];
  passwordless = true;
  signedIn = false;
  activeRuntime = runtime;
  vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: {
      get: vi.fn(async () => ({
        id: 'credential-1', type: 'public-key', rawId: bytes('credential-1'), authenticatorAttachment: 'platform',
        getClientExtensionResults: () => ({}),
        response: { clientDataJSON: bytes('{}'), authenticatorData: bytes('auth'), signature: bytes('sig'), userHandle: bytes('user-1') },
      })),
    },
  });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), 'https://console.example.com').pathname;
    requests.push({ path, body: String(init?.body ?? '') });
    if (path === '/runtime.json') return Response.json(activeRuntime);
    if (path === '/api/cindertrace/auth/local/session') return Response.json({ error: 'Authentication required' }, { status: 401 });
    if (path === '/api/oathweave/browser/session')
      return signedIn
        ? Response.json({ principal: { sub: 'usr_paula', username: 'paula', roles: [], permissions: [] } })
        : Response.json({ error: 'UNAUTHORIZED', message: 'Sign in to continue' }, { status: 401 });
    if (path === '/api/oathweave/mfa/webauthn/passwordless/options')
      return passwordless
        ? Response.json({ success: true, data: { challenge: 'Y2hhbGxlbmdl', allowCredentials: [], userVerification: 'required' }, ceremonyId: 'c'.repeat(43) })
        : Response.json({ error: 'NOT_FOUND', message: 'Passwordless sign-in is turned off' }, { status: 404 });
    if (path === '/api/oathweave/mfa/webauthn/passwordless/authenticate') {
      signedIn = true;
      return Response.json({ success: true, verified: true, user: { id: 'usr_paula', email: 'paula@example.com', username: 'paula', displayName: null, roles: [], permissions: [] } });
    }
    return Response.json({ error: 'NOT_FOUND', message: 'Not found' }, { status: 404 });
  }));
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.unstubAllGlobals();
});

async function until(found: () => unknown) {
  const deadline = Date.now() + 3_000;
  while (!found() && Date.now() < deadline) await settle(10);
  expect(found()).toBeTruthy();
}

async function signInForm() {
  vi.resetModules();
  const { initializeRuntime } = await import('./lib/runtime');
  await initializeRuntime();
  const { App } = await import('./app');
  // The same module instances as the app, so the shell finds its toast provider after sign-in.
  const fresh = await import('./modules/magnus/test-dom');
  view = await fresh.mount(<App />);
  await until(() => document.querySelector('input[autocomplete="username"]'));
}

describe('Sign in with a passkey', () => {
  it('is offered beside the password, described for assistive technology, and signs in with no password', async () => {
    await signInForm();
    const passkey = button('Sign in with a passkey');
    expect(passkey).toBeDefined();
    expect(passkey?.type).toBe('button');
    const hint = document.getElementById(passkey!.getAttribute('aria-describedby')!);
    expect(hint?.textContent).toContain('No password needed');
    await click(passkey);
    await until(() => !document.querySelector('input[autocomplete="username"]'));
    const paths = requests.map((request) => request.path);
    expect(paths).toContain('/api/oathweave/mfa/webauthn/passwordless/options');
    expect(paths).toContain('/api/oathweave/mfa/webauthn/passwordless/authenticate');
    expect(requests.some((request) => request.body.includes('password'))).toBe(false);
    expect(paths.some((path) => path.endsWith('/auth/login'))).toBe(false);
  });

  it('disappears with a clear message when Oathweave has passwordless sign-in turned off', async () => {
    passwordless = false;
    await signInForm();
    await click(button('Sign in with a passkey'));
    await until(() => !button('Sign in with a passkey'));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Passkey sign-in is turned off for this Oathweave');
    // The password form stays.
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
    expect(button('Sign in')).toBeDefined();
  });

  it("is not offered on Cindertrace's local sign-in", async () => {
    activeRuntime = { schema: 1, mode: 'local', products: { cindertrace: '/api/cindertrace' } };
    await signInForm();
    expect(document.querySelector('h1')?.textContent).toBe('Cindertrace sign-in');
    expect(button('Sign in with a passkey')).toBeUndefined();
    expect(requests.some((request) => request.path.includes('passwordless'))).toBe(false);
  });

  it('is not offered in a browser without WebAuthn', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined);
    await signInForm();
    expect(button('Sign in with a passkey')).toBeUndefined();
    expect(button('Sign in')).toBeDefined();
  });
});

describe('Verify with a passkey', () => {
  beforeEach(() => {
    // jsdom has no modal dialogs.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
  });

  it('resolves the re-authentication with the passkey alone when Oathweave accepts it', async () => {
    view = await mount(<IdentityPrompts />);
    const answer = requestStepUp({ passkeyOnly: true });
    await until(() => button('Verify with a passkey'));
    const passkey = button('Verify with a passkey')!;
    expect(document.getElementById(passkey.getAttribute('aria-describedby')!)?.textContent).toContain('Your passkey alone');
    // The password route stays: password with a code, or password and passkey.
    expect(button('Password and passkey')).toBeDefined();
    await click(passkey);
    expect(await answer).toEqual({ passkey: true });
  });

  it('asks for the password when a passkey alone is not accepted', async () => {
    view = await mount(<IdentityPrompts />);
    void requestStepUp({ passkeyOnly: false });
    await until(() => button('Verify'));
    expect(button('Verify with a passkey')).toBeUndefined();
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
  });
});
