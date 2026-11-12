import { adminApi } from '../../lib/api';
import { Badge, Button, Field, Panel, TextArea, TextInput } from '../../components/ui';
import { Icon } from '../../components/icons';
import { DEFAULT_PERMISSIONS, splitList } from './shared';
import type { IamOps } from './use-iam-operations';

export function RolesSection({ ops }: { ops: IamOps }) {
  const {
    confirmAction,
    roles,
    busy,
    roleForm,
    setRoleForm,
    canWriteRoles,
    run,
  } = ops;
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
