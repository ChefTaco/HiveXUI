import { expect, it } from 'vitest';
import { allowedRouterResource, allowedStoreResource } from './router-access';
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
  expect(allowedRouterResource('incidents', { ...user, permissions: ['router:admin:read'] }, true)).toBe(true);
});
it('reads no Emberpath resource when Emberpath is not installed, leaving only incidents', () => {
  const user = { id: 'fake-local-id', username: 'admin', roles: [], permissions: ['*'] };
  const identity = (product: string) => product === 'oathweave';
  for (const key of ['providers', 'aliases', 'routeRules', 'heuristics', 'clientKeys', 'telemetry', 'traces', 'audit', 'runtimeSettings', 'docs', 'actors', 'hiveStatus'])
    expect(allowedStoreResource(key, user, true, identity)).toBe(false);
  expect(allowedStoreResource('incidents', null, true, identity)).toBe(true);
  expect(allowedStoreResource('incidents', null, true, (product) => product === 'chattermost')).toBe(false);
});
it('keeps product permissions when Emberpath is installed and all resources in legacy mode', () => {
  const user = { id: 'fake-local-id', username: 'admin', roles: [], permissions: ['router:providers:read'] };
  const core = (product: string) => ['oathweave', 'emberpath'].includes(product);
  expect(allowedStoreResource('providers', user, true, core)).toBe(true);
  expect(allowedStoreResource('incidents', user, true, core)).toBe(false);
  expect(allowedStoreResource('actors', null, false, () => false)).toBe(true);
});
