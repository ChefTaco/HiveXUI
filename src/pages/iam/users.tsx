import { adminApi } from '../../lib/api';
import { Badge, Button, Field, Panel, Select, TextInput, Toggle } from '../../components/ui';
import { Icon } from '../../components/icons';
import { relativeTime } from '../../lib/format';
import { roleIds, EntityTable } from './shared';
import type { IamOps } from './use-iam-operations';

export function UsersSection({ ops }: { ops: IamOps }) {
  const {
    users,
    confirmAction,
    roles,
    busy,
    userForm,
    setUserForm,
    roleAction,
    setRoleAction,
    passwordAction,
    setPasswordAction,
    roleOptions,
    userOptions,
    canWriteUsers,
    canDeleteUsers,
    canWriteRoles,
    run,
  } = ops;
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
