import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { adminApi, ApiError } from '../lib/api';
import { browserIdentity } from '../lib/runtime';
import { identityResourceAllowed } from '../lib/iam-access';
import { can } from '../lib/permissions';
import type {
  AdminUser,
  CreateIamClientRequest,
  IamAuditEvent,
  IamAuditStats,
  IamClient,
  IamPasswordPolicy,
  IamRole,
  IamServiceAccount,
  IamSession,
  IamSystemUser,
  IamUser,
} from '../lib/types';
import {
  Badge,
  Button,
  CopyField,
  EmptyState,
  Field,
  Panel,
  Select,
  StatCard,
  TextArea,
  TextInput,
  Toggle,
  PageHeader,
  TableFrame,
  useConfirm,
} from '../components/ui';
import { Icon } from '../components/icons';
import { formatTime, relativeTime } from '../lib/format';

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

const SECTION_LABELS: Record<IamSection, string> = {
  overview: 'IAM Overview',
  users: 'Users',
  roles: 'Roles',
  'service-accounts': 'Service Accounts',
  clients: 'Clients',
  sessions: 'Sessions',
  'system-users': 'System Users',
  security: 'Security',
  audit: 'Audit',
};

const DEFAULT_PERMISSIONS = [
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

function splitList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const VALID_CLIENT_GRANTS = [
  'authorization_code',
  'refresh_token',
  'client_credentials',
] as const;
type ClientGrantType = NonNullable<
  CreateIamClientRequest['grantTypes']
>[number];

function splitGrantTypes(value: string): ClientGrantType[] {
  const valid = new Set<string>(VALID_CLIENT_GRANTS);
  return splitList(value).filter((grant): grant is ClientGrantType =>
    valid.has(grant),
  );
}

function roleNames(
  assignments: IamUser['roles'] | IamServiceAccount['roles'],
): string {
  return (
    assignments
      .map((entry) => entry.role.label || entry.role.name)
      .join(', ') || 'No roles'
  );
}

function roleIds(
  assignments: IamUser['roles'] | IamServiceAccount['roles'],
  roles: IamRole[],
): string[] {
  const byName = new Map(roles.map((role) => [role.name, role.id]));
  return assignments
    .map((entry) => entry.roleId ?? byName.get(entry.role.name))
    .filter((entry): entry is string => Boolean(entry));
}

function firstRoleId(roles: IamRole[], preferred: string): string {
  return (
    roles.find((role) => role.name === preferred)?.id ?? roles[0]?.id ?? ''
  );
}

function safeDetail(value: IamAuditEvent['detail']): string {
  if (!value || Object.keys(value).length === 0) return 'No detail';
  return JSON.stringify(value);
}

export function IamOperationsPage({
  section = 'overview',
  onNavigate,
  currentUser,
}: {
  section?: IamSection;
  onNavigate?: (view: string) => void;
  currentUser: AdminUser | null;
}) {
  const [users, setUsers] = useState<IamUser[]>([]);
  const [confirmAction, confirmDialog] = useConfirm();
  const [roles, setRoles] = useState<IamRole[]>([]);
  const [serviceAccounts, setServiceAccounts] = useState<IamServiceAccount[]>(
    [],
  );
  const [clients, setClients] = useState<IamClient[]>([]);
  const [systemUsers, setSystemUsers] = useState<IamSystemUser[]>([]);
  const [sessions, setSessions] = useState<IamSession[]>([]);
  const [auditStats, setAuditStats] = useState<IamAuditStats | null>(null);
  const [auditEvents, setAuditEvents] = useState<IamAuditEvent[]>([]);
  const [passwordPolicy, setPasswordPolicy] =
    useState<IamPasswordPolicy | null>(null);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  const [userForm, setUserForm] = useState({
    email: '',
    username: '',
    displayName: '',
    password: '',
    active: true,
    roleId: '',
  });
  const [roleAction, setRoleAction] = useState({ userId: '', roleId: '' });
  const [passwordAction, setPasswordAction] = useState({
    userId: '',
    password: '',
  });
  const [serviceForm, setServiceForm] = useState({
    name: '',
    description: '',
    clientId: '',
    roleId: '',
    allowedIps: '',
  });
  const [clientForm, setClientForm] = useState({
    name: '',
    description: '',
    secret: '',
    grantTypes: 'client_credentials',
    redirectUris: '',
    firstParty: true,
  });
  const [roleForm, setRoleForm] = useState({
    id: '',
    name: '',
    label: '',
    description: '',
    permissions: 'iam:tokens:introspect',
  });
  const [systemForm, setSystemForm] = useState({
    userId: '',
    linuxUsername: '',
    authorizedHosts: '',
    sshPublicKey: '',
    sudoEnabled: false,
  });

  const roleOptions = useMemo(
    () =>
      roles.map((role) => ({
        value: role.id,
        label: `${role.label} (${role.name})`,
      })),
    [roles],
  );
  const clientOptions = useMemo(
    () =>
      clients.map((client) => ({
        value: client.id,
        label: `${client.name} (${client.clientType})`,
      })),
    [clients],
  );
  const userOptions = useMemo(
    () =>
      users.map((user) => ({
        value: user.id,
        label: `${user.displayName ?? user.username} (${user.email})`,
      })),
    [users],
  );
  const canWriteUsers = can(currentUser, 'iam:users:write');
  const canDeleteUsers = can(currentUser, 'iam:users:delete');
  const canWriteRoles = can(currentUser, 'iam:roles:write');
  const canWriteServiceAccounts = can(currentUser, 'iam:sa:write');
  const canDeleteServiceAccounts = can(currentUser, 'iam:sa:delete');
  const canWriteClients = can(currentUser, 'iam:clients:write');
  const canRevokeSessions = can(currentUser, 'iam:sessions:revoke');
  const canWritePolicy = can(currentUser, 'iam:policy:write');

  const loadIam = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        healthRes,
        statsRes,
        sessionRes,
        roleRes,
        userRes,
        serviceRes,
        clientRes,
        systemRes,
        auditRes,
        policyRes,
      ] = await Promise.all([
        identityResourceAllowed('health', section, currentUser)
          ? adminApi.iamHealth().catch(() => null)
          : Promise.resolve(null),
        identityResourceAllowed('stats', section, currentUser)
          ? adminApi.iamAuditStats()
          : Promise.resolve(null),
        identityResourceAllowed('sessions', section, currentUser)
          ? adminApi.iamSessions()
          : Promise.resolve({ sessions: [] as IamSession[] }),
        identityResourceAllowed('roles', section, currentUser)
          ? adminApi.iamRoles()
          : Promise.resolve({ roles: [] as IamRole[] }),
        identityResourceAllowed('users', section, currentUser)
          ? adminApi.iamUsers()
          : Promise.resolve({ users: [] as IamUser[] }),
        identityResourceAllowed('services', section, currentUser)
          ? adminApi.iamServiceAccounts()
          : Promise.resolve({ serviceAccounts: [] as IamServiceAccount[] }),
        identityResourceAllowed('clients', section, currentUser)
          ? adminApi.iamClients()
          : Promise.resolve({ clients: [] as IamClient[] }),
        identityResourceAllowed('system', section, currentUser)
          ? adminApi.iamSystemUsers()
          : Promise.resolve({ systemUsers: [] as IamSystemUser[] }),
        identityResourceAllowed('audit', section, currentUser)
          ? adminApi.iamAudit()
          : Promise.resolve({
              events: [] as IamAuditEvent[],
              total: 0,
              page: 1,
              limit: 50,
            }),
        identityResourceAllowed('policy', section, currentUser)
          ? adminApi.iamPasswordPolicy()
          : Promise.resolve(null),
      ]);
      setHealth(healthRes);
      setAuditStats(statsRes);
      setSessions(sessionRes.sessions);
      setRoles(roleRes.roles);
      setUsers(userRes.users);
      setServiceAccounts(serviceRes.serviceAccounts);
      setClients(clientRes.clients);
      setSystemUsers(systemRes.systemUsers);
      setAuditEvents(auditRes.events);
      setPasswordPolicy(policyRes?.policy ?? null);
      setUserForm((current) => ({
        ...current,
        roleId: current.roleId || firstRoleId(roleRes.roles, 'VIEWER'),
      }));
      setRoleAction((current) => ({
        ...current,
        userId: current.userId || userRes.users[0]?.id || '',
        roleId: current.roleId || firstRoleId(roleRes.roles, 'VIEWER'),
      }));
      setPasswordAction((current) => ({
        ...current,
        userId: current.userId || userRes.users[0]?.id || '',
      }));
      setServiceForm((current) => ({
        ...current,
        clientId: current.clientId || clientRes.clients[0]?.id || '',
        roleId: current.roleId || firstRoleId(roleRes.roles, 'SERVICE'),
      }));
      setSystemForm((current) => ({
        ...current,
        userId: current.userId || userRes.users[0]?.id || '',
      }));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setError('Hive session expired. Sign in again.');
      } else {
        setError(
          caught instanceof Error ? caught.message : 'Failed to load IAM data',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [section, currentUser]);

  useEffect(() => {
    void loadIam();
  }, [loadIam]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    setRevealedSecret(null);
    try {
      const result = await action();
      if (
        result &&
        typeof result === 'object' &&
        'apiKey' in result &&
        typeof result.apiKey === 'string'
      ) {
        setRevealedSecret(result.apiKey);
      }
      setNotice(success);
      await loadIam();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Operation failed');
    } finally {
      setBusy(false);
    }
  }

  function patchPasswordPolicy(patch: Partial<IamPasswordPolicy>) {
    setPasswordPolicy((current) =>
      current ? { ...current, ...patch } : current,
    );
  }

  async function savePasswordPolicy() {
    if (!passwordPolicy) return;
    await run(
      () => adminApi.updateIamPasswordPolicy(passwordPolicy),
      'Password policy updated',
    );
  }

  const activeUsers = users.filter((user) => user.active).length;
  const activeTechnical = serviceAccounts.filter(
    (account) => account.active,
  ).length;
  const activeBots = clients.filter((client) => client.active).length;
  const activeSessions = sessions.length;

  return (
    <>
      {confirmDialog}
      <PageHeader
        title={SECTION_LABELS[section]}
        description="Identity, access, service credentials, sessions, and audit controls."
        actions={<Badge tone="success" dot>
          {browserIdentity() ? 'Oathweave sign-in' : 'Console sign-in'}
        </Badge>}
      />

      <div className="ops-toolbar">
        <div
          className="segmented-tabs"
          role="tablist"
          aria-label="IAM sections"
        >
          {Object.entries(SECTION_LABELS).map(([key, label]) => (
            <button
              key={key}
              className={
                section === key ? 'tab-button tab-button--active' : 'tab-button'
              }
              onClick={() => onNavigate?.(`iam-${key}`)}
            >
              {label.replace('IAM ', '')}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void loadIam()}
          loading={loading}
          icon={<Icon.Refresh className="btn-ico" />}
        >
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="error-banner">
          <Icon.Alert />
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="success-banner">
          <Icon.Check />
          {notice}
        </div>
      ) : null}
      {revealedSecret ? (
        <Panel title="Secret shown once" eyebrow="Store now">
          <CopyField value={revealedSecret} />
        </Panel>
      ) : null}

      {renderSection()}
    </>
  );

  function renderSection() {
    const permission = (
      {
        users: 'iam:users:read',
        roles: 'iam:roles:read',
        'service-accounts': 'iam:sa:read',
        clients: 'iam:clients:read',
        sessions: 'iam:sessions:revoke',
        'system-users': 'iam:system:login',
        audit: 'iam:audit:read',
      } as Record<string, string>
    )[section];
    if (permission && !can(currentUser, permission))
      return (
        <Panel title="Access unavailable">
          <p>Your identity does not have permission to inspect this section.</p>
        </Panel>
      );
    if (section === 'overview') return renderOverview();
    if (section === 'users') return renderUsers();
    if (section === 'roles') return renderRoles();
    if (section === 'service-accounts') return renderServiceAccounts();
    if (section === 'clients') return renderClients();
    if (section === 'sessions') return renderSessions();
    if (section === 'system-users') return renderSystemUsers();
    if (section === 'security') return renderSecurity();
    return renderAudit();
  }

  function renderOverview() {
    const status = String(health?.status ?? 'unknown');
    return (
      <>
        <div className="stats-grid">
          <StatCard
            label="Login Users"
            value={
              can(currentUser, 'iam:users:read') ? users.length : 'Unavailable'
            }
            sub={
              can(currentUser, 'iam:users:read')
                ? `${activeUsers} active`
                : 'Permission required'
            }
            tone="accent"
          />
          <StatCard
            label="Service Accounts"
            value={
              can(currentUser, 'iam:sa:read')
                ? serviceAccounts.length
                : 'Unavailable'
            }
            sub={
              can(currentUser, 'iam:sa:read')
                ? `${activeTechnical} active`
                : 'Permission required'
            }
            tone="accent"
          />
          <StatCard
            label="Clients"
            value={
              can(currentUser, 'iam:clients:read')
                ? clients.length
                : 'Unavailable'
            }
            sub={
              can(currentUser, 'iam:clients:read')
                ? `${activeBots} active`
                : 'Permission required'
            }
            tone="accent"
          />
          <StatCard
            label="Active Sessions"
            value={canRevokeSessions ? activeSessions : 'Unavailable'}
            sub={
              auditStats
                ? `${auditStats.totalEvents} audit events / 30d`
                : 'Audit summary unavailable'
            }
            tone="accent"
          />
        </div>
        <div className="page-grid page-grid--2">
          <Panel title="IAM Core" eyebrow="Health">
            <Badge
              tone={
                status === 'healthy'
                  ? 'success'
                  : status === 'unknown'
                    ? 'neutral'
                    : 'danger'
              }
              dot
            >
              {status}
            </Badge>
          </Panel>
          <Panel title="Recent sessions" eyebrow="Access">
            <EntityTable
              label="Active sessions"
              empty="No active sessions."
              headers={['User', 'IP', 'Created', 'Expires']}
            >
              {sessions.slice(0, 5).map((session) => (
                <tr key={session.id}>
                  <td>{session.user?.email ?? session.userId}</td>
                  <td className="cell-mono">{session.ipAddress ?? '-'}</td>
                  <td>{relativeTime(session.createdAt)}</td>
                  <td>{relativeTime(session.expiresAt)}</td>
                </tr>
              ))}
            </EntityTable>
          </Panel>
        </div>
      </>
    );
  }

  function renderUsers() {
    return (
      <div className="iam-ops-grid">
        <Panel title="Create user" eyebrow="Human account">
          <div className="field-grid">
            <Field label="Email">
              <TextInput
                value={userForm.email}
                onChange={(email) =>
                  setUserForm((current) => ({ ...current, email }))
                }
              />
            </Field>
            <Field label="Username">
              <TextInput
                value={userForm.username}
                onChange={(username) =>
                  setUserForm((current) => ({ ...current, username }))
                }
              />
            </Field>
            <Field label="Display name">
              <TextInput
                value={userForm.displayName}
                onChange={(displayName) =>
                  setUserForm((current) => ({ ...current, displayName }))
                }
              />
            </Field>
            <Field label="Password">
              <TextInput
                type="password"
                value={userForm.password}
                onChange={(password) =>
                  setUserForm((current) => ({ ...current, password }))
                }
              />
            </Field>
            <Field label="Initial role">
              <Select
                value={userForm.roleId}
                onChange={(roleId) =>
                  setUserForm((current) => ({ ...current, roleId }))
                }
                options={roleOptions}
              />
            </Field>
            <Toggle
              checked={userForm.active}
              onChange={(active) =>
                setUserForm((current) => ({ ...current, active }))
              }
              label="Active"
            />
          </div>
          <Button
            variant="primary"
            loading={busy}
            disabled={!canWriteUsers}
            icon={<Icon.Plus className="btn-ico" />}
            onClick={() =>
              void run(
                () =>
                  adminApi.createIamUser({
                    ...userForm,
                    roleIds: userForm.roleId ? [userForm.roleId] : [],
                  }),
                'User created',
              )
            }
          >
            Create user
          </Button>
        </Panel>
        <Panel title="Role and password" eyebrow="Update">
          <div className="field-grid">
            <Field label="User">
              <Select
                value={roleAction.userId}
                onChange={(userId) => {
                  setRoleAction((current) => ({ ...current, userId }));
                  setPasswordAction((current) => ({ ...current, userId }));
                }}
                options={userOptions}
              />
            </Field>
            <Field label="Role">
              <Select
                value={roleAction.roleId}
                onChange={(roleId) =>
                  setRoleAction((current) => ({ ...current, roleId }))
                }
                options={roleOptions}
              />
            </Field>
            <Field label="New password">
              <TextInput
                type="password"
                value={passwordAction.password}
                onChange={(password) =>
                  setPasswordAction((current) => ({ ...current, password }))
                }
              />
            </Field>
          </div>
          <div className="form-actions">
            <Button
              variant="ghost"
              loading={busy}
              disabled={!canWriteRoles}
              icon={<Icon.Key className="btn-ico" />}
              onClick={() =>
                void run(
                  () =>
                    adminApi.assignIamUserRoles(roleAction.userId, [
                      roleAction.roleId,
                    ]),
                  'Role assigned',
                )
              }
            >
              Assign role
            </Button>
            <Button
              variant="ghost"
              loading={busy}
              disabled={!canWriteUsers}
              icon={<Icon.Refresh className="btn-ico" />}
              onClick={() =>
                void run(
                  () =>
                    adminApi.rotateIamUserPassword(
                      passwordAction.userId,
                      passwordAction.password,
                    ),
                  'Password rotated',
                )
              }
            >
              Rotate password
            </Button>
          </div>
        </Panel>
        <Panel
          title="Users"
          eyebrow="Directory"
          className="col-span-full"
        >
          <EntityTable
            label="IAM users"
            empty="No IAM users found."
            headers={['User', 'Roles', 'Status', 'Last login', 'Actions']}
          >
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.displayName ?? user.username}</strong>
                  <span className="row-sub">
                    {user.email} / {user.username}
                  </span>
                </td>
                <td>
                  <span className="role-chip-list">
                    {user.roles.map((entry) => {
                      const assignmentRoleId = entry.roleId;
                      return (
                        <button
                          className="role-chip role-chip--button"
                          disabled={!canWriteRoles || !assignmentRoleId}
                          key={entry.role.name}
                          onClick={() =>
                            assignmentRoleId
                              ? void run(
                                  () =>
                                    adminApi.removeIamUserRole(
                                      user.id,
                                      assignmentRoleId,
                                    ),
                                  'Role removed',
                                )
                              : undefined
                          }
                        >
                          {entry.role.label}
                        </button>
                      );
                    })}
                  </span>
                </td>
                <td>
                  <Badge tone={user.active ? 'success' : 'neutral'} dot>
                    {user.active ? 'active' : 'disabled'}
                  </Badge>
                </td>
                <td className="cell-mono">
                  {user.lastLoginAt ? relativeTime(user.lastLoginAt) : 'never'}
                </td>
                <td>
                  <div className="row-actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canWriteUsers}
                      onClick={() =>
                        void run(
                          () =>
                            adminApi.updateIamUser(user.id, {
                              active: !user.active,
                            }),
                          user.active ? 'User disabled' : 'User enabled',
                        )
                      }
                    >
                      {user.active ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canWriteUsers}
                      onClick={() =>
                        void run(
                          () => adminApi.lockIamUser(user.id),
                          'User locked',
                        )
                      }
                    >
                      Lock
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canWriteUsers}
                      onClick={() =>
                        void run(
                          () => adminApi.unlockIamUser(user.id),
                          'User unlocked',
                        )
                      }
                    >
                      Unlock
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={!canDeleteUsers}
                      onClick={async () => {
                        if (
                          await confirmAction({ title: 'Delete user', message: `Delete ${user.username}?`, confirmLabel: 'Delete' })
                        )
                          void run(
                            () => adminApi.deleteIamUser(user.id),
                            'User deleted',
                          );
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                  <span className="row-sub">
                    {roleIds(user.roles, roles).length} role ids assigned
                  </span>
                </td>
              </tr>
            ))}
          </EntityTable>
        </Panel>
      </div>
    );
  }

  function renderRoles() {
    return (
      <div className="iam-ops-grid">
        <Panel
          title={roleForm.id ? 'Update role' : 'Create role'}
          eyebrow="Permissions"
        >
          <div className="field-grid">
            <Field label="Role name">
              <TextInput
                value={roleForm.name}
                disabled={Boolean(roleForm.id)}
                onChange={(name) =>
                  setRoleForm((current) => ({ ...current, name }))
                }
                placeholder="BOT_OPERATOR"
              />
            </Field>
            <Field label="Label">
              <TextInput
                value={roleForm.label}
                onChange={(label) =>
                  setRoleForm((current) => ({ ...current, label }))
                }
              />
            </Field>
            <Field label="Description">
              <TextInput
                value={roleForm.description}
                onChange={(description) =>
                  setRoleForm((current) => ({ ...current, description }))
                }
              />
            </Field>
            <Field label="Permissions" hint="Comma or newline separated">
              <TextArea
                value={roleForm.permissions}
                onChange={(permissions) =>
                  setRoleForm((current) => ({ ...current, permissions }))
                }
              />
            </Field>
          </div>
          <div className="permission-bank">
            {DEFAULT_PERMISSIONS.map((permission) => (
              <button
                key={permission}
                className="role-chip role-chip--button"
                disabled={!canWriteRoles}
                onClick={() =>
                  setRoleForm((current) => ({
                    ...current,
                    permissions: Array.from(
                      new Set([...splitList(current.permissions), permission]),
                    ).join('\n'),
                  }))
                }
              >
                {permission}
              </button>
            ))}
          </div>
          <div className="form-actions">
            <Button
              variant="primary"
              loading={busy}
              disabled={!canWriteRoles}
              icon={<Icon.Check className="btn-ico" />}
              onClick={() =>
                void run(
                  () =>
                    roleForm.id
                      ? adminApi.updateIamRole(roleForm.id, {
                          label: roleForm.label,
                          description: roleForm.description,
                          permissions: splitList(roleForm.permissions),
                        })
                      : adminApi.createIamRole({
                          name: roleForm.name,
                          label: roleForm.label,
                          description: roleForm.description,
                          permissions: splitList(roleForm.permissions),
                        }),
                  roleForm.id ? 'Role updated' : 'Role created',
                )
              }
            >
              {roleForm.id ? 'Save role' : 'Create role'}
            </Button>
            {roleForm.id ? (
              <Button
                variant="ghost"
                onClick={() =>
                  setRoleForm({
                    id: '',
                    name: '',
                    label: '',
                    description: '',
                    permissions: 'iam:tokens:introspect',
                  })
                }
              >
                New role
              </Button>
            ) : null}
          </div>
        </Panel>
        <Panel title="Roles" eyebrow="RBAC" className="col-span-full">
          <div className="pulse-grid">
            {roles.map((role) => (
              <article className="pulse-card" key={role.id}>
                <div className="pulse-top">
                  <span className="pulse-name">{role.label}</span>
                  <Badge tone={role.isSystem ? 'accent' : 'neutral'}>
                    {role.isSystem ? 'system' : 'custom'}
                  </Badge>
                </div>
                <p className="pulse-meta">
                  {role.description ?? 'No description'}
                </p>
                <p className="cell-mono mt-2">
                  {role.name}
                </p>
                <div className="role-chip-list mt-3">
                  {role.permissions.slice(0, 6).map((permission) => (
                    <span className="role-chip" key={permission}>
                      {permission}
                    </span>
                  ))}
                </div>
                <div className="row-actions mt-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setRoleForm({
                        id: role.id,
                        name: role.name,
                        label: role.label,
                        description: role.description ?? '',
                        permissions: role.permissions.join('\n'),
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={role.isSystem || !canWriteRoles}
                    onClick={async () => {
                      if (
                        await confirmAction({ title: 'Delete role', message: `Delete ${role.name}?`, confirmLabel: 'Delete' })
                      )
                        void run(
                          () => adminApi.deleteIamRole(role.id),
                          'Role deleted',
                        );
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </Panel>
      </div>
    );
  }

  function renderServiceAccounts() {
    return (
      <div className="iam-ops-grid">
        <Panel title="Create service account" eyebrow="Technical identity">
          <div className="field-grid">
            <Field label="Name">
              <TextInput
                value={serviceForm.name}
                onChange={(name) =>
                  setServiceForm((current) => ({ ...current, name }))
                }
              />
            </Field>
            <Field label="Client">
              <Select
                value={serviceForm.clientId}
                onChange={(clientId) =>
                  setServiceForm((current) => ({ ...current, clientId }))
                }
                options={clientOptions}
              />
            </Field>
            <Field label="Role">
              <Select
                value={serviceForm.roleId}
                onChange={(roleId) =>
                  setServiceForm((current) => ({ ...current, roleId }))
                }
                options={roleOptions}
              />
            </Field>
            <Field
              label="Allowed IPs"
              hint="Comma or newline separated IPv4 addresses"
            >
              <TextArea
                value={serviceForm.allowedIps}
                onChange={(allowedIps) =>
                  setServiceForm((current) => ({ ...current, allowedIps }))
                }
              />
            </Field>
            <Field label="Description">
              <TextInput
                value={serviceForm.description}
                onChange={(description) =>
                  setServiceForm((current) => ({ ...current, description }))
                }
              />
            </Field>
          </div>
          <Button
            variant="primary"
            loading={busy}
            disabled={!canWriteServiceAccounts}
            icon={<Icon.Plus className="btn-ico" />}
            onClick={() =>
              void run(
                () =>
                  adminApi.createIamServiceAccount({
                    ...serviceForm,
                    roleIds: serviceForm.roleId ? [serviceForm.roleId] : [],
                    allowedIps: splitList(serviceForm.allowedIps),
                  }),
                'Service account created',
              )
            }
          >
            Create service account
          </Button>
        </Panel>
        <Panel
          title="Service accounts"
          eyebrow="Keys"
          className="col-span-full"
        >
          <EntityTable
            label="Service accounts"
            empty="No service accounts found."
            headers={['Account', 'Client', 'Roles', 'Status', 'Actions']}
          >
            {serviceAccounts.map((account) => (
              <tr key={account.id}>
                <td>
                  <strong>{account.name}</strong>
                  <span className="row-sub">
                    {account.description ?? 'No description'} /{' '}
                    {account.apiKeyPrefix ?? account.keyPrefix ?? 'no prefix'}
                  </span>
                </td>
                <td>{account.client?.name ?? 'unlinked'}</td>
                <td>{roleNames(account.roles)}</td>
                <td>
                  <Badge tone={account.active ? 'success' : 'neutral'} dot>
                    {account.active ? 'active' : 'disabled'}
                  </Badge>
                </td>
                <td>
                  <div className="row-actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canWriteServiceAccounts}
                      onClick={() =>
                        void run(
                          () =>
                            adminApi.updateIamServiceAccount(account.id, {
                              active: !account.active,
                            }),
                          account.active
                            ? 'Service account disabled'
                            : 'Service account enabled',
                        )
                      }
                    >
                      {account.active ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canWriteServiceAccounts}
                      onClick={() =>
                        void run(
                          () => adminApi.rotateIamServiceAccount(account.id),
                          'API key rotated',
                        )
                      }
                    >
                      Rotate key
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={!canDeleteServiceAccounts}
                      onClick={async () => {
                        if (
                          await confirmAction({ title: 'Delete service account', message: `Delete ${account.name}?`, confirmLabel: 'Delete' })
                        )
                          void run(
                            () => adminApi.deleteIamServiceAccount(account.id),
                            'Service account deleted',
                          );
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </EntityTable>
        </Panel>
      </div>
    );
  }

  function renderClients() {
    return (
      <div className="iam-ops-grid">
        <Panel title="Create client" eyebrow="Bot registration">
          <div className="field-grid">
            <Field label="Client name">
              <TextInput
                value={clientForm.name}
                onChange={(name) =>
                  setClientForm((current) => ({ ...current, name }))
                }
                placeholder="bot-scout"
              />
            </Field>
            <Field label="Client secret">
              <TextInput
                type="password"
                value={clientForm.secret}
                onChange={(secret) =>
                  setClientForm((current) => ({ ...current, secret }))
                }
              />
            </Field>
            <Field label="Grant types">
              <TextInput
                value={clientForm.grantTypes}
                onChange={(grantTypes) =>
                  setClientForm((current) => ({ ...current, grantTypes }))
                }
              />
            </Field>
            <Field label="Redirect URIs">
              <TextArea
                value={clientForm.redirectUris}
                onChange={(redirectUris) =>
                  setClientForm((current) => ({ ...current, redirectUris }))
                }
              />
            </Field>
            <Field label="Description">
              <TextInput
                value={clientForm.description}
                onChange={(description) =>
                  setClientForm((current) => ({ ...current, description }))
                }
              />
            </Field>
            <Toggle
              checked={clientForm.firstParty}
              onChange={(firstParty) =>
                setClientForm((current) => ({ ...current, firstParty }))
              }
              label="First-party bot"
            />
          </div>
          <Button
            variant="primary"
            loading={busy}
            disabled={!canWriteClients}
            icon={<Icon.Plus className="btn-ico" />}
            onClick={() =>
              void run(
                () =>
                  adminApi.createIamClient({
                    name: clientForm.name,
                    description: clientForm.description,
                    secret: clientForm.secret,
                    clientType: 'confidential',
                    grantTypes: splitGrantTypes(clientForm.grantTypes),
                    redirectUris: splitList(clientForm.redirectUris),
                    firstParty: clientForm.firstParty,
                    allowedIps: [],
                  }),
                'Client created',
              )
            }
          >
            Create client
          </Button>
        </Panel>
        <Panel title="Clients" eyebrow="OAuth" className="col-span-full">
          <EntityTable
            label="OAuth clients"
            empty="No clients found."
            headers={['Client', 'Type', 'Grants', 'Status', 'Actions']}
          >
            {clients.map((client) => (
              <tr key={client.id}>
                <td>
                  <strong>{client.name}</strong>
                  <span className="row-sub">
                    {client.description ?? 'No description'}
                  </span>
                </td>
                <td>{client.clientType}</td>
                <td>{client.grantTypes.join(', ') || 'none'}</td>
                <td>
                  <Badge tone={client.active ? 'success' : 'neutral'} dot>
                    {client.active ? 'active' : 'disabled'}
                  </Badge>
                </td>
                <td>
                  <div className="row-actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canWriteClients}
                      onClick={() =>
                        void run(
                          () =>
                            adminApi.updateIamClient(client.id, {
                              active: !client.active,
                            }),
                          client.active ? 'Client disabled' : 'Client enabled',
                        )
                      }
                    >
                      {client.active ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canWriteClients}
                      onClick={() =>
                        void run(
                          () =>
                            adminApi.updateIamClient(client.id, {
                              firstParty: !client.firstParty,
                            }),
                          'Client trust flag updated',
                        )
                      }
                    >
                      {client.firstParty
                        ? 'Unmark first-party'
                        : 'Mark first-party'}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={!canWriteClients}
                      onClick={async () => {
                        if (
                          await confirmAction({ title: 'Delete client', message: `Delete ${client.name}?`, confirmLabel: 'Delete' })
                        )
                          void run(
                            () => adminApi.deleteIamClient(client.id),
                            'Client deleted',
                          );
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </EntityTable>
        </Panel>
      </div>
    );
  }

  function renderSessions() {
    return (
      <Panel title="Sessions" eyebrow="Active access">
        <p>Review each session before revoking it. A shared IP address or browser
          does not mean two sessions are duplicates.</p>
        <EntityTable
          label="Sessions"
          empty="No active sessions."
          headers={['User', 'IP', 'Created', 'Expires', 'Actions']}
        >
          {sessions.map((session) => (
            <tr key={session.id}>
              <td>
                <strong>{session.user?.email ?? session.userId}</strong>
                <span className="row-sub">
                  {session.userAgent ?? 'No user agent'}
                </span>
              </td>
              <td className="cell-mono">{session.ipAddress ?? '-'}</td>
              <td>{formatTime(session.createdAt)}</td>
              <td>{formatTime(session.expiresAt)}</td>
              <td>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={!canRevokeSessions}
                  onClick={async () => {
                    if (
                      await confirmAction({ title: 'Revoke session', message: 'Revoke this session?', confirmLabel: 'Revoke' })
                    )
                      void run(
                        () => adminApi.revokeIamSession(session.id),
                        'Session revoked',
                      );
                  }}
                >
                  Revoke
                </Button>
              </td>
            </tr>
          ))}
        </EntityTable>
      </Panel>
    );
  }

  function renderSystemUsers() {
    return (
      <div className="iam-ops-grid">
        <Panel title="Create system user" eyebrow="Linux mapping">
          <div className="field-grid">
            <Field label="IAM user">
              <Select
                value={systemForm.userId}
                onChange={(userId) =>
                  setSystemForm((current) => ({ ...current, userId }))
                }
                options={userOptions}
              />
            </Field>
            <Field label="Linux username">
              <TextInput
                value={systemForm.linuxUsername}
                onChange={(linuxUsername) =>
                  setSystemForm((current) => ({ ...current, linuxUsername }))
                }
              />
            </Field>
            <Field label="Authorized hosts">
              <TextArea
                value={systemForm.authorizedHosts}
                onChange={(authorizedHosts) =>
                  setSystemForm((current) => ({ ...current, authorizedHosts }))
                }
              />
            </Field>
            <Field label="SSH public key">
              <TextArea
                value={systemForm.sshPublicKey}
                onChange={(sshPublicKey) =>
                  setSystemForm((current) => ({ ...current, sshPublicKey }))
                }
              />
            </Field>
            <Toggle
              checked={systemForm.sudoEnabled}
              onChange={(sudoEnabled) =>
                setSystemForm((current) => ({ ...current, sudoEnabled }))
              }
              label="Sudo enabled"
            />
          </div>
          <Button
            variant="primary"
            loading={busy}
            disabled={!canWriteUsers}
            icon={<Icon.Plus className="btn-ico" />}
            onClick={() =>
              void run(
                () =>
                  adminApi.createIamSystemUser({
                    ...systemForm,
                    authorizedHosts: splitList(systemForm.authorizedHosts),
                  }),
                'System user mapped',
              )
            }
          >
            Create system user
          </Button>
        </Panel>
        <Panel
          title="System users"
          eyebrow="Host access"
          className="col-span-full"
        >
          <EntityTable
            label="System users"
            empty="No system users mapped."
            headers={['Linux user', 'IAM user', 'Hosts', 'Sudo', 'Actions']}
          >
            {systemUsers.map((entry) => (
              <tr key={entry.id}>
                <td>
                  <strong>{entry.linuxUsername}</strong>
                </td>
                <td>{entry.user?.email ?? entry.userId}</td>
                <td>
                  {entry.authorizedHosts.join(', ') || 'all governed hosts'}
                </td>
                <td>
                  <Badge tone={entry.sudoEnabled ? 'warning' : 'neutral'}>
                    {entry.sudoEnabled ? 'sudo' : 'standard'}
                  </Badge>
                </td>
                <td>
                  <div className="row-actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canWriteUsers}
                      onClick={() =>
                        void run(
                          () =>
                            adminApi.updateIamSystemUser(entry.id, {
                              sudoEnabled: !entry.sudoEnabled,
                            }),
                          'System user updated',
                        )
                      }
                    >
                      {entry.sudoEnabled ? 'Disable sudo' : 'Enable sudo'}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={!canDeleteUsers}
                      onClick={async () => {
                        if (
                          await confirmAction({ title: 'Delete system user', message: `Delete ${entry.linuxUsername}?`, confirmLabel: 'Delete' })
                        )
                          void run(
                            () => adminApi.deleteIamSystemUser(entry.id),
                            'System user deleted',
                          );
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </EntityTable>
        </Panel>
      </div>
    );
  }

  function renderSecurity() {
    const mfaEnabled = users.filter((user) => user.mfaEnabled).length;
    const passkeyTotal = users.reduce(
      (sum, user) => sum + (user.passkeyCount ?? 0),
      0,
    );
    const trustedDeviceTotal = users.reduce(
      (sum, user) => sum + (user.trustedDeviceCount ?? 0),
      0,
    );
    const riskySessions = sessions.filter(
      (session) =>
        typeof session.riskScore === 'number' && session.riskScore >= 0.5,
    );

    return (
      <>
        <div className="stats-grid">
          <StatCard
            label="MFA Enabled"
            value={mfaEnabled}
            sub={`${users.length - mfaEnabled} without MFA`}
            tone={users.length - mfaEnabled > 0 ? 'warning' : 'success'}
          />
          <StatCard
            label="Passkeys"
            value={passkeyTotal}
            sub="registered WebAuthn credentials"
            tone="accent"
          />
          <StatCard
            label="Trusted Devices"
            value={trustedDeviceTotal}
            sub="registered device fingerprints"
            tone="accent"
          />
          <StatCard
            label="Risky Sessions"
            value={riskySessions.length}
            sub="step-up candidates"
            tone={riskySessions.length ? 'danger' : 'success'}
          />
        </div>

        <div className="page-grid page-grid--2">
          <Panel title="MFA And Passkeys" eyebrow="Users">
            <EntityTable
              label="User sign-in security"
              empty="No IAM users found."
              headers={['User', 'MFA', 'Passkeys', 'Devices', 'Password']}
            >
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.displayName ?? user.username}</strong>
                    <span className="row-sub">{user.email}</span>
                  </td>
                  <td>
                    <Badge tone={user.mfaEnabled ? 'success' : 'warning'} dot>
                      {user.mfaEnabled ? 'enabled' : 'off'}
                    </Badge>
                  </td>
                  <td className="cell-mono">{user.passkeyCount ?? 0}</td>
                  <td className="cell-mono">{user.trustedDeviceCount ?? 0}</td>
                  <td className="cell-mono">
                    {user.passwordChangedAt
                      ? relativeTime(user.passwordChangedAt)
                      : 'unknown'}
                  </td>
                </tr>
              ))}
            </EntityTable>
          </Panel>

          <Panel title="Step-Up And Risk" eyebrow="Sessions">
            <EntityTable
              label="High-risk sessions"
              empty="No high-risk sessions."
              headers={['User', 'Risk', 'Step-Up', 'Factors', 'Actions']}
            >
              {riskySessions.map((session) => (
                <tr key={session.id}>
                  <td>
                    <strong>{session.user?.email ?? session.userId}</strong>
                    <span className="row-sub">
                      {session.ipAddress ?? 'no ip'}
                    </span>
                  </td>
                  <td>
                    <Badge
                      tone={
                        (session.riskScore ?? 0) >= 0.75 ? 'danger' : 'warning'
                      }
                    >
                      {Math.round((session.riskScore ?? 0) * 100)}%
                    </Badge>
                  </td>
                  <td className="cell-mono">
                    {session.stepUpVerifiedAt
                      ? relativeTime(session.stepUpVerifiedAt)
                      : 'required'}
                  </td>
                  <td className="cell-mono">
                    {Array.isArray(session.riskFactors)
                      ? session.riskFactors.join(', ')
                      : (session.riskFactors ?? '-')}
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={!canRevokeSessions}
                      onClick={async () => {
                        if (
                          await confirmAction({ title: 'Revoke risky session', message: 'Revoke this risky session?', confirmLabel: 'Revoke' })
                        )
                          void run(
                            () => adminApi.revokeIamSession(session.id),
                            'Session revoked',
                          );
                      }}
                    >
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </EntityTable>
          </Panel>

          <Panel
            title="Password Policy"
            eyebrow="Step-up foundation"
            className="col-span-full"
          >
            {passwordPolicy ? (
              <>
                <div className="field-grid">
                  <Field label="Name">
                    <TextInput
                      value={passwordPolicy.name}
                      onChange={(name) => patchPasswordPolicy({ name })}
                    />
                  </Field>
                  <Field label="Min length">
                    <TextInput
                      inputMode="numeric"
                      value={String(passwordPolicy.minLength)}
                      onChange={(value) =>
                        patchPasswordPolicy({ minLength: Number(value) || 0 })
                      }
                    />
                  </Field>
                  <Field label="Max length">
                    <TextInput
                      inputMode="numeric"
                      value={String(passwordPolicy.maxLength)}
                      onChange={(value) =>
                        patchPasswordPolicy({ maxLength: Number(value) || 0 })
                      }
                    />
                  </Field>
                  <Field label="Max age days">
                    <TextInput
                      inputMode="numeric"
                      value={String(passwordPolicy.maxAgeDays)}
                      onChange={(value) =>
                        patchPasswordPolicy({ maxAgeDays: Number(value) || 0 })
                      }
                    />
                  </Field>
                  <Field label="History count">
                    <TextInput
                      inputMode="numeric"
                      value={String(passwordPolicy.historyCount)}
                      onChange={(value) =>
                        patchPasswordPolicy({
                          historyCount: Number(value) || 0,
                        })
                      }
                    />
                  </Field>
                  <Field label="Lockout attempts">
                    <TextInput
                      inputMode="numeric"
                      value={String(passwordPolicy.lockoutAttempts)}
                      onChange={(value) =>
                        patchPasswordPolicy({
                          lockoutAttempts: Number(value) || 0,
                        })
                      }
                    />
                  </Field>
                  <Field label="Lockout minutes">
                    <TextInput
                      inputMode="numeric"
                      value={String(passwordPolicy.lockoutDurationMin)}
                      onChange={(value) =>
                        patchPasswordPolicy({
                          lockoutDurationMin: Number(value) || 0,
                        })
                      }
                    />
                  </Field>
                  <div className="toggle-stack">
                    <Toggle
                      checked={passwordPolicy.requireUppercase}
                      onChange={(requireUppercase) =>
                        patchPasswordPolicy({ requireUppercase })
                      }
                      label="Uppercase"
                    />
                    <Toggle
                      checked={passwordPolicy.requireLowercase}
                      onChange={(requireLowercase) =>
                        patchPasswordPolicy({ requireLowercase })
                      }
                      label="Lowercase"
                    />
                    <Toggle
                      checked={passwordPolicy.requireNumbers}
                      onChange={(requireNumbers) =>
                        patchPasswordPolicy({ requireNumbers })
                      }
                      label="Numbers"
                    />
                    <Toggle
                      checked={passwordPolicy.requireSpecial}
                      onChange={(requireSpecial) =>
                        patchPasswordPolicy({ requireSpecial })
                      }
                      label="Special characters"
                    />
                  </div>
                </div>
                <div className="form-actions">
                  <Button
                    variant="primary"
                    loading={busy}
                    disabled={!canWritePolicy}
                    icon={<Icon.Check className="btn-ico" />}
                    onClick={() => void savePasswordPolicy()}
                  >
                    Save policy
                  </Button>
                </div>
              </>
            ) : (
              <EmptyState
                icon={<Icon.Alert width={34} height={34} />}
                message="Password policy could not be loaded from IAM."
              />
            )}
          </Panel>
        </div>
      </>
    );
  }

  function renderAudit() {
    return (
      <>
        <div className="stats-grid">
          <StatCard
            label="Total Events"
            value={auditStats?.totalEvents ?? 0}
            sub="last 30 days"
            tone="accent"
          />
          <StatCard
            label="Successful"
            value={auditStats?.successCount ?? 0}
            sub="authorized actions"
            tone="accent"
          />
          <StatCard
            label="Failures"
            value={auditStats?.failureCount ?? 0}
            sub="failed auth"
            tone="danger"
          />
          <StatCard
            label="Denied"
            value={auditStats?.deniedCount ?? 0}
            sub="policy blocks"
            tone="accent"
          />
        </div>
        <Panel title="Audit events" eyebrow="Recent">
          <EntityTable
            label="Identity audit events"
            empty="No audit events found."
            headers={['Time', 'Event', 'Actor', 'Outcome', 'Detail']}
          >
            {auditEvents.map((event) => (
              <tr key={event.id}>
                <td className="cell-mono">{formatTime(event.timestamp)}</td>
                <td>
                  <strong>{event.eventType}</strong>
                  <span className="row-sub">
                    {event.category} / {event.action}
                  </span>
                </td>
                <td>{event.actorEmail ?? event.actorId ?? event.actorType}</td>
                <td>
                  <Badge
                    tone={
                      event.outcome === 'SUCCESS'
                        ? 'success'
                        : event.outcome === 'DENIED'
                          ? 'warning'
                          : 'danger'
                    }
                  >
                    {event.outcome}
                  </Badge>
                </td>
                <td className="cell-mono cell-long">{safeDetail(event.detail)}</td>
              </tr>
            ))}
          </EntityTable>
        </Panel>
      </>
    );
  }
}

function EntityTable({
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
