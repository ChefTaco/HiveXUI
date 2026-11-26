import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminApi, ApiError } from '../../lib/api';
import { identityResourceAllowed } from '../../lib/iam-access';
import { can } from '../../lib/permissions';
import type { AdminUser, IamAuditEvent, IamAuditStats, IamClient, IamPasswordPolicy, IamRole, IamServiceAccount, IamSession, IamSystemUser, IamUser } from '../../lib/types';
import { useConfirm } from '../../components/ui';
import { type IamSection, firstRoleId } from './shared';
import { describeApiError } from '@lib/api-error';

/**
 * The IAM page's records, forms and actions. Every section reads from one instance, so a form
 * keeps what was typed while the operator moves between sections, as it always has.
 */
/** The section each IAM read fills, in `loadIam`'s order, for its error message. */
const IAM_RESOURCE_LABELS = ['Health', 'Audit statistics', 'Sessions', 'Roles', 'Users', 'Service accounts', 'Clients', 'System users', 'Audit events', 'Password policy'] as const;

/** Users and audit events per page: Oathweave's largest user page, and its default audit page. */
export const USERS_PAGE_SIZE = 100;
export const AUDIT_PAGE_SIZE = 50;

export function useIamOperations(section: IamSection, currentUser: AdminUser | null, onAuthExpired?: () => void) {
  const [users, setUsers] = useState<IamUser[]>([]);
  // The users list is one page of a directory that may hold more: its total, page and filter.
  const [usersTotal, setUsersTotal] = useState(0);
  const [userQuery, setUserQuery] = useState({ page: 1, search: '' });
  const userQueryRef = useRef(userQuery);
  userQueryRef.current = userQuery;
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const auditPageRef = useRef(auditPage);
  auditPageRef.current = auditPage;
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
    // Each section loads on its own: one refusal or outage (audit stats, say) leaves the rest shown.
    const load = <T, E>(resource: Parameters<typeof identityResourceAllowed>[0], read: () => Promise<T>, empty: E): Promise<T | E> =>
      identityResourceAllowed(resource, section, currentUser) ? read() : Promise.resolve(empty);
    const results = await Promise.allSettled([
      load('health', () => adminApi.iamHealth().catch(() => null), null),
      load('stats', () => adminApi.iamAuditStats(), null),
      load('sessions', () => adminApi.iamSessions(), { sessions: [] as IamSession[] }),
      load('roles', () => adminApi.iamRoles(), { roles: [] as IamRole[] }),
      load('users', () => adminApi.iamUsers({ page: userQueryRef.current.page, limit: USERS_PAGE_SIZE, search: userQueryRef.current.search }), { users: [] as IamUser[], total: 0 }),
      load('services', () => adminApi.iamServiceAccounts(), { serviceAccounts: [] as IamServiceAccount[] }),
      load('clients', () => adminApi.iamClients(), { clients: [] as IamClient[] }),
      load('system', () => adminApi.iamSystemUsers(), { systemUsers: [] as IamSystemUser[] }),
      load('audit', () => adminApi.iamAudit({ page: auditPageRef.current, limit: AUDIT_PAGE_SIZE }), { events: [] as IamAuditEvent[], total: 0, page: 1, limit: AUDIT_PAGE_SIZE }),
      load('policy', () => adminApi.iamPasswordPolicy(), null),
    ] as const);
    const [healthRes, statsRes, sessionRes, roleRes, userRes, serviceRes, clientRes, systemRes, auditRes, policyRes] = results;
    const failures = results.flatMap((result, index) => (result.status === 'rejected' ? [{ section: IAM_RESOURCE_LABELS[index]!, reason: result.reason as unknown }] : []));
    if (failures.some(({ reason }) => reason instanceof ApiError && reason.status === 401)) {
      setLoading(false);
      setError('Your session has ended. Sign in again.');
      onAuthExpired?.();
      return;
    }
    if (healthRes.status === 'fulfilled') setHealth(healthRes.value);
    if (statsRes.status === 'fulfilled') setAuditStats(statsRes.value);
    if (sessionRes.status === 'fulfilled') setSessions(sessionRes.value.sessions);
    // A section that failed keeps what it showed; the form defaults then come from nothing new.
    const loadedRoles = roleRes.status === 'fulfilled' ? roleRes.value.roles : [];
    const loadedUsers = userRes.status === 'fulfilled' ? userRes.value.users : [];
    const loadedClients = clientRes.status === 'fulfilled' ? clientRes.value.clients : [];
    if (roleRes.status === 'fulfilled') setRoles(loadedRoles);
    if (userRes.status === 'fulfilled') {
      setUsers(loadedUsers);
      setUsersTotal(userRes.value.total);
    }
    if (serviceRes.status === 'fulfilled') setServiceAccounts(serviceRes.value.serviceAccounts);
    if (clientRes.status === 'fulfilled') setClients(loadedClients);
    if (systemRes.status === 'fulfilled') setSystemUsers(systemRes.value.systemUsers);
    if (auditRes.status === 'fulfilled') {
      setAuditEvents(auditRes.value.events);
      setAuditTotal(auditRes.value.total);
    }
    if (policyRes.status === 'fulfilled') setPasswordPolicy(policyRes.value?.policy ?? null);
    setUserForm((current) => ({
      ...current,
      roleId: current.roleId || firstRoleId(loadedRoles, 'VIEWER'),
    }));
    setRoleAction((current) => ({
      ...current,
      userId: current.userId || loadedUsers[0]?.id || '',
      roleId: current.roleId || firstRoleId(loadedRoles, 'VIEWER'),
    }));
    setPasswordAction((current) => ({
      ...current,
      userId: current.userId || loadedUsers[0]?.id || '',
    }));
    setServiceForm((current) => ({
      ...current,
      clientId: current.clientId || loadedClients[0]?.id || '',
      roleId: current.roleId || firstRoleId(loadedRoles, 'SERVICE'),
    }));
    setSystemForm((current) => ({
      ...current,
      userId: current.userId || loadedUsers[0]?.id || '',
    }));
    if (failures.length)
      setError(
        failures
          .map(({ section: label, reason }) => `${label}: ${describeApiError(reason, 'could not be loaded')}`)
          .join(' · '),
      );
    setLoading(false);
  }, [section, currentUser, onAuthExpired]);

  useEffect(() => {
    void loadIam();
  }, [loadIam]);

  // A new page or filter reads only its own list; the rest of the page stays as it is.
  const [pageLoading, setPageLoading] = useState(false);
  const readPage = useCallback(async (label: string, read: () => Promise<void>) => {
    setPageLoading(true);
    try {
      await read();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) onAuthExpired?.();
      else setError(`${label}: ${describeApiError(caught, 'could not be loaded')}`);
    } finally {
      setPageLoading(false);
    }
  }, [onAuthExpired]);
  const showUsers = useCallback((next: { page: number; search: string }) => {
    setUserQuery(next);
    userQueryRef.current = next;
    void readPage('Users', async () => {
      const result = await adminApi.iamUsers({ page: next.page, limit: USERS_PAGE_SIZE, search: next.search });
      // An answer for a filter or page the operator has since left is not shown.
      if (userQueryRef.current !== next) return;
      setUsers(result.users);
      setUsersTotal(result.total);
    });
  }, [readPage]);
  const showAuditPage = useCallback((page: number) => {
    setAuditPage(page);
    auditPageRef.current = page;
    void readPage('Audit events', async () => {
      const result = await adminApi.iamAudit({ page, limit: AUDIT_PAGE_SIZE });
      if (auditPageRef.current !== page) return;
      setAuditEvents(result.events);
      setAuditTotal(result.total);
    });
  }, [readPage]);

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
      setError(describeApiError(caught, 'Operation failed'));
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

  return {
    section,
    currentUser,
    users,
    setUsers,
    usersTotal,
    userQuery,
    showUsers,
    auditTotal,
    auditPage,
    showAuditPage,
    pageLoading,
    confirmAction,
    confirmDialog,
    roles,
    setRoles,
    serviceAccounts,
    setServiceAccounts,
    clients,
    setClients,
    systemUsers,
    setSystemUsers,
    sessions,
    setSessions,
    auditStats,
    setAuditStats,
    auditEvents,
    setAuditEvents,
    passwordPolicy,
    setPasswordPolicy,
    health,
    setHealth,
    loading,
    setLoading,
    busy,
    setBusy,
    error,
    setError,
    notice,
    setNotice,
    revealedSecret,
    setRevealedSecret,
    userForm,
    setUserForm,
    roleAction,
    setRoleAction,
    passwordAction,
    setPasswordAction,
    serviceForm,
    setServiceForm,
    clientForm,
    setClientForm,
    roleForm,
    setRoleForm,
    systemForm,
    setSystemForm,
    roleOptions,
    clientOptions,
    userOptions,
    canWriteUsers,
    canDeleteUsers,
    canWriteRoles,
    canWriteServiceAccounts,
    canDeleteServiceAccounts,
    canWriteClients,
    canRevokeSessions,
    canWritePolicy,
    loadIam,
    run,
    patchPasswordPolicy,
    savePasswordPolicy,
    activeUsers,
    activeTechnical,
    activeBots,
    activeSessions,
  };
}
export type IamOps = ReturnType<typeof useIamOperations>;
