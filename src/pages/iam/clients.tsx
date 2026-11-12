import { adminApi } from '../../lib/api';
import { Badge, Button, Field, Panel, TextArea, TextInput, Toggle } from '../../components/ui';
import { Icon } from '../../components/icons';
import { splitList, splitGrantTypes, EntityTable } from './shared';
import type { IamOps } from './use-iam-operations';

export function ClientsSection({ ops }: { ops: IamOps }) {
  const {
    confirmAction,
    clients,
    busy,
    clientForm,
    setClientForm,
    canWriteClients,
    run,
  } = ops;
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
