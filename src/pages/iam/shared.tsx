// Labels, helpers and the table every IAM section shares.
import type { ReactNode } from 'react';
import type { CreateIamClientRequest, IamAuditEvent, IamRole, IamServiceAccount, IamUser } from '../../lib/types';
import { EmptyState, TableFrame } from '../../components/ui';
import { Icon } from '../../components/icons';

export type IamSection =
  | 'overview'
  | 'users'
  | 'roles'
  | 'service-accounts'
  | 'clients'
  | 'sessions'
  | 'system-users'
  | 'security'
  | 'audit';

export const SECTION_LABELS: Record<IamSection, string> = {
  overview: 'IAM Overview',
  users: 'Users',
  roles: 'Roles',
  'service-accounts': 'Service Accounts',
  clients: 'Clients',
  sessions: 'Sessions',
  'system-users': 'System Users',
  security: 'Security',
  audit: 'Identity audit',
};

export const DEFAULT_PERMISSIONS = [
  'iam:users:read',
  'iam:users:write',
  'iam:users:delete',
  'iam:roles:read',
  'iam:roles:write',
  'iam:sa:read',
  'iam:sa:write',
  'iam:sa:delete',
  'iam:clients:read',
  'iam:clients:write',
  'iam:audit:read',
  'iam:sessions:revoke',
  'iam:system:login',
  'iam:system:sudo',
  'iam:system:deploy',
  'iam:policy:write',
  'iam:tokens:introspect',
];

export function splitList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export const VALID_CLIENT_GRANTS = [
  'authorization_code',
  'refresh_token',
  'client_credentials',
] as const;
type ClientGrantType = NonNullable<
  CreateIamClientRequest['grantTypes']
>[number];

export function splitGrantTypes(value: string): ClientGrantType[] {
  const valid = new Set<string>(VALID_CLIENT_GRANTS);
  return splitList(value).filter((grant): grant is ClientGrantType =>
    valid.has(grant),
  );
}

export function roleNames(
  assignments: IamUser['roles'] | IamServiceAccount['roles'],
): string {
  return (
    assignments
      .map((entry) => entry.role.label || entry.role.name)
      .join(', ') || 'No roles'
  );
}

export function roleIds(
  assignments: IamUser['roles'] | IamServiceAccount['roles'],
  roles: IamRole[],
): string[] {
  const byName = new Map(roles.map((role) => [role.name, role.id]));
  return assignments
    .map((entry) => entry.roleId ?? byName.get(entry.role.name))
    .filter((entry): entry is string => Boolean(entry));
}

export function firstRoleId(roles: IamRole[], preferred: string): string {
  return (
    roles.find((role) => role.name === preferred)?.id ?? roles[0]?.id ?? ''
  );
}

export function safeDetail(value: IamAuditEvent['detail']): string {
  if (!value || Object.keys(value).length === 0) return 'No detail';
  return JSON.stringify(value);
}

const isSection = (value: string): value is IamSection => Object.hasOwn(SECTION_LABELS, value);
/** The section a view key names: `iam-users` is Users. Anything else is the overview. */
export const iamSection = (view: string): IamSection => {
  const section = view.replace(/^iam-/, '');
  return isSection(section) ? section : 'overview';
};

export function EntityTable({
  label,
  headers,
  empty,
  children,
}: {
  label: string;
  headers: string[];
  empty: string;
  children: ReactNode;
}) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children;
  if (Array.isArray(rows) && rows.length === 0) {
    return (
      <EmptyState icon={<Icon.Info width={34} height={34} />} message={empty} />
    );
  }
  return (
    <TableFrame label={label}>
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </TableFrame>
  );
}
