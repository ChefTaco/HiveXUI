import { expect, it } from 'vitest';
import { identityResourceAllowed } from './iam-access';
it('an identity reader loads its selected workflow without requesting unrelated privileged data', () => {
  const user = {
    id: 'fake-user',
    username: 'reader',
    roles: [],
    permissions: ['iam:users:read'],
  };
  expect(identityResourceAllowed('users', 'users', user)).toBe(true);
  for (const resource of ['services', 'clients', 'roles', 'sessions', 'audit'])
    expect(identityResourceAllowed(resource, 'users', user)).toBe(false);
  expect(identityResourceAllowed('users', 'clients', user)).toBe(false);
  expect(
    identityResourceAllowed('clients', 'clients', {
      ...user,
      permissions: ['iam:clients:read'],
    }),
  ).toBe(true);
});
