import { adminApi } from '../../lib/api';
import { Badge, Button, Field, Panel, Select, TextArea, TextInput } from '../../components/ui';
import { Icon } from '../../components/icons';
import { splitList, roleNames, roleIds, EntityTable } from './shared';
import type { IamOps } from './use-iam-operations';

export function ServiceAccountsSection({ ops }: { ops: IamOps }) {
  const {
    confirmAction,
    serviceAccounts,
    busy,
    serviceForm,
    setServiceForm,
    roleOptions,
    clientOptions,
    canWriteServiceAccounts,
    canDeleteServiceAccounts,
    run,
  } = ops;
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
