import type { AdminUser } from './types';

export function can(user: AdminUser | null, permission: string): boolean {
  const granted = user?.permissions ?? [];
  if (granted.includes('*') || granted.includes(permission)) return true;
  const [domain] = permission.split(':');
  return granted.includes(`${domain}:*`) || granted.some((entry) => entry.endsWith(':*') && permission.startsWith(entry.slice(0, -1)));
}

export function canAny(user: AdminUser | null, permissions: string[]): boolean {
  return permissions.some((permission) => can(user, permission));
}

/** Role names that make a person an administrator of the installation, compared case-insensitively. */
const ADMINISTRATOR_ROLES = new Set(['admin', 'super_admin', 'suite_admin']);

/**
 * An administrator of the installation: a wildcard grant, or an administrator role (the legacy
 * `admin`, or Oathweave's `SUPER_ADMIN` and `SUITE_ADMIN`). Installation-level pages such as the
 * setup checklist are shown only to them.
 */
export function isAdministrator(user: AdminUser | null): boolean {
  if (!user) return false;
  return (user.permissions ?? []).includes('*') || (user.roles ?? []).some((role) => ADMINISTRATOR_ROLES.has(role.toLowerCase()));
}
