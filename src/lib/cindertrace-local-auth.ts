import { z } from 'zod';
import { localBrowserLoginSchema, localBrowserProfileSchema } from '../../contracts/cindertrace/browser-auth';
import { readApiFailure, failureMeta, HiveApiError } from './api-error';
import { apiFetch, clearAccess } from './transport';
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

async function send(path: string, init: RequestInit, fallback: string): Promise<unknown> {
  const response = await apiFetch('/api/cindertrace/auth/local/' + path, { ...init, credentials: 'include' });
  if (!response.ok) {
    const failure = await readApiFailure(response, { trustMessage: response.status !== 503, fallback: () => fallback });
    throw new HiveApiError(response.status, failure.message, { ...failureMeta(failure), code: failure.code });
  }
  return response.json();
}

export const cindertraceLocalAuth = {
  async login(username: string, password: string): Promise<{ user: AdminUser }> {
    const body = localBrowserLoginSchema.parse({ username, password });
    const answer = loginAnswer.parse(
      await send('login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, 'Sign-in failed'),
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
