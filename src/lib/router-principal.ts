import { ApiError } from './api';
import type { AdminUser } from './types';

/** A valid suite session can exist without an Emberpath identity link. */
export async function optionalRouterPrincipal(
  load: () => Promise<{ user: AdminUser }>,
  verifySession: () => Promise<unknown>,
): Promise<AdminUser | null> {
  try {
    return (await load()).user;
  } catch (error) {
    if (!(error instanceof ApiError) || ![401, 403].includes(error.status))
      throw error;
    await verifySession();
    return null;
  }
}
