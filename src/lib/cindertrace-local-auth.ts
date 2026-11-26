import { z } from 'zod';
import { localBrowserLoginSchema, localBrowserProfileSchema } from '../../contracts/cindertrace/browser-auth';
import { readApiFailure, failureMeta, HiveApiError } from './api-error';
import { apiFetch, clearAccess } from './transport';
import { SecondFactorRequired } from './second-factor';
import type { AdminUser } from './types';

/**
 * Cindertrace's own browser sign-in (`/api/v1/auth/local/*`), used instead of Oathweave by a local
 * installation and for recovery. Cindertrace sets and checks its HttpOnly `cindertrace_session`
 * cookie; nothing here sees or stores a credential after the password is sent.
 */
const loginAnswer = z.object({
  ok: z.literal(true),
  username: z.string(),
  userId: z.string(),
  role: localBrowserProfileSchema.shape.role,
});

export function localUser(profile: { username: string; userId: string; role: string }): AdminUser {
  return { id: profile.userId, username: profile.username, roles: [profile.role] };
}

/** Cindertrace's sign-in answers, in words an operator acts on. */
function loginRefusal(status: number, totp: boolean, retryAfterMs: number | undefined): string | null {
  if (status === 429) return `Too many sign-in attempts. Try again${retryAfterMs ? ` in ${Math.ceil(retryAfterMs / 1000)} seconds` : ' later'}.`;
  if (status === 401 && totp) return 'That authentication code is not valid or was already used. Sign in again with the current code.';
  return null;
}

async function send(path: string, init: RequestInit, fallback: string, totp?: string): Promise<unknown> {
  const response = await apiFetch('/api/cindertrace/auth/local/' + path, { ...init, credentials: 'include' });
  if (!response.ok) {
    const failure = await readApiFailure(response, { trustMessage: response.status !== 503, fallback: () => fallback });
    const totpRequired = Boolean(failure.body && typeof failure.body === 'object' && (failure.body as { totpRequired?: unknown }).totpRequired === true);
    // The password was right; this account also needs its authenticator code.
    if (path === 'login' && response.status === 401 && totpRequired && totp === undefined) throw new SecondFactorRequired('totp');
    const message = path === 'login' ? loginRefusal(response.status, totp !== undefined, failure.retryAfterMs) : null;
    throw new HiveApiError(response.status, message ?? failure.message, { ...failureMeta(failure), code: failure.code });
  }
  return response.json();
}

export const cindertraceLocalAuth = {
  /** `totp` is the six-digit code an account with TOTP needs (Cindertrace after 2.x: totpRequired). */
  async login(username: string, password: string, totp?: string): Promise<{ user: AdminUser }> {
    const code = totp?.replace(/\s+/g, '');
    if (code !== undefined && !/^\d{6}$/.test(code)) throw new Error('Enter the 6 digits your authenticator app shows.');
    const body = localBrowserLoginSchema.parse({ username, password, ...(code !== undefined ? { totp: code } : {}) });
    const answer = loginAnswer.parse(
      await send('login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, 'Sign-in failed', code),
    );
    return { user: localUser(answer) };
  },
  async me(): Promise<{ user: AdminUser }> {
    return { user: localUser(localBrowserProfileSchema.parse(await send('session', {}, 'Sign in to continue'))) };
  },
  async logout(): Promise<{ ok: boolean }> {
    try {
      await send('logout', { method: 'POST' }, 'Sign-out failed');
      return { ok: true };
    } finally {
      clearAccess();
    }
  },
};
