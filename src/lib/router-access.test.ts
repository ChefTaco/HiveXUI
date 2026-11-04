import { expect, it } from 'vitest';
import { allowedRouterResource } from './router-access';
it('limits browser panels to product permissions and excludes retired proxy coordinators', () => {
  const user = {
    id: 'fake-local-id',
    username: 'admin',
    roles: [],
    permissions: ['router:providers:read'],
  };
  expect(allowedRouterResource('providers', user, true)).toBe(true);
  for (const key of [
    'aliases',
    'clientKeys',
    'actors',
    'incidents',
    'hiveStatus',
  ])
    expect(allowedRouterResource(key, user, true)).toBe(false);
  expect(
    allowedRouterResource('actors', { ...user, permissions: ['*'] }, true),
  ).toBe(false);
  expect(allowedRouterResource('actors', null, false)).toBe(true);
});
