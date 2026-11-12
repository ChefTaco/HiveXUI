import { adminApi } from '../../lib/api';
import { Badge, Button, Field, Panel, Select, TextArea, TextInput, Toggle } from '../../components/ui';
import { Icon } from '../../components/icons';
import { splitList, EntityTable } from './shared';
import type { IamOps } from './use-iam-operations';

export function SystemUsersSection({ ops }: { ops: IamOps }) {
  const {
    users,
    confirmAction,
    systemUsers,
    busy,
    systemForm,
    setSystemForm,
    userOptions,
    canWriteUsers,
    canDeleteUsers,
    run,
  } = ops;
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
