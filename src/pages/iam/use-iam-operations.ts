import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi, ApiError } from '../../lib/api';
import { identityResourceAllowed } from '../../lib/iam-access';
import { can } from '../../lib/permissions';
import type { AdminUser, IamAuditEvent, IamAuditStats, IamClient, IamPasswordPolicy, IamRole, IamServiceAccount, IamSession, IamSystemUser, IamUser } from '../../lib/types';
import { useConfirm } from '../../components/ui';
import { type IamSection, firstRoleId } from './shared';

/**
 * The IAM page's records, forms and actions. Every section reads from one instance, so a form
 * keeps what was typed while the operator moves between sections, as it always has.
 */
export function useIamOperations(section: IamSection, currentUser: AdminUser | null) {
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

  return {
    section,
    currentUser,
    users,
    setUsers,
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
