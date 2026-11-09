import { expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { optionalRouterPrincipal } from './router-principal';
import { allowedRouterResource } from './router-access';

it.each([401, 403])('keeps a valid suite session without router access (%s)', async (status) => {
  const verify = vi.fn().mockResolvedValue({ user: { username: 'viewer' } });
  const principal = await optionalRouterPrincipal(async () => { throw new ApiError('Unauthorized', status); }, verify);
  expect(principal).toBeNull();
  expect(verify).toHaveBeenCalledOnce();
  for (const resource of ['providers', 'aliases', 'traces', 'runtimeSettings'])
    expect(allowedRouterResource(resource, principal, true)).toBe(false);
});
it('retains a linked router identity without another session request', async () => {
  const user = { id: 'fake-id', username: 'admin', roles: [], permissions: ['router:providers:read'] };
  const verify = vi.fn();
  expect(await optionalRouterPrincipal(async () => ({ user }), verify)).toBe(user);
  expect(verify).not.toHaveBeenCalled();
});
it('retains expired-session and service failures', async () => {
  const expired = new ApiError('Session expired', 401);
  await expect(optionalRouterPrincipal(async () => { throw new ApiError('Unauthorized', 401); }, async () => { throw expired; })).rejects.toBe(expired);
  const failure = new ApiError('Service unavailable', 503);
  const verify = vi.fn();
  await expect(optionalRouterPrincipal(async () => { throw failure; }, verify)).rejects.toBe(failure);
  expect(verify).not.toHaveBeenCalled();
});
