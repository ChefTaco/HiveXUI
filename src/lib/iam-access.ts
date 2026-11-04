import { can } from './permissions';
import type { AdminUser } from './types';
export function identityResourceAllowed(
  resource: string,
  section: string,
  user: AdminUser | null,
): boolean {
  const rules: Record<string, { permission?: string; sections: string[] }> = {
    health: { sections: ['overview'] },
    stats: { permission: 'iam:audit:read', sections: ['overview', 'audit'] },
    sessions: {
      permission: 'iam:sessions:revoke',
      sections: ['overview', 'sessions'],
    },
    roles: {
      permission: 'iam:roles:read',
      sections: ['overview', 'users', 'roles', 'service-accounts'],
    },
    users: {
      permission: 'iam:users:read',
      sections: ['overview', 'users', 'roles', 'system-users'],
    },
    services: {
      permission: 'iam:sa:read',
      sections: ['overview', 'service-accounts'],
    },
    clients: {
      permission: 'iam:clients:read',
      sections: ['overview', 'clients', 'service-accounts'],
    },
    system: {
      permission: 'iam:system:login',
      sections: ['overview', 'system-users'],
    },
    audit: { permission: 'iam:audit:read', sections: ['overview', 'audit'] },
    policy: { sections: ['security'] },
  };
  const rule = rules[resource];
  return (
    !!rule &&
    rule.sections.includes(section) &&
    (!rule.permission || can(user, rule.permission))
  );
}
