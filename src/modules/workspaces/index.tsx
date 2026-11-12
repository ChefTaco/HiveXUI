import { MemoryAccess } from '../../components/memory-access';
import { useEffect, useRef, useState } from 'react';
import {
  WorkspacePolicySchema,
  type MemoryProfile,
  type Workspace,
  type WorkspaceMemberUpdate,
} from '../../../contracts/hivemem.generated';
import { memoryApi } from '../../lib/memory-api';
import { memoryCan, workspaceCan } from '../../lib/memory-access';
import {
  Button,
  ConfirmDialog,
  Field,
  JsonBlock,
  Panel,
  TextArea,
  TextInput,
  Toggle,
  PageHeader,
  EmptyState,
  LoadingRows,
} from '../../components/ui';

/** The Workspaces screen, once this identity's HiveMem profile is known. */
export function WorkspacesScreen() {
  return <MemoryAccess>{(profile) => <WorkspacesModule profile={profile} />}</MemoryAccess>;
}

export default function WorkspacesModule({
  profile,
}: {
  profile: MemoryProfile;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [selected, setSelected] = useState<Workspace | null>(null);
  const [offset, setOffset] = useState(0),
    [includeArchived, setIncludeArchived] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [newId, setNewId] = useState(''),
    [newTitle, setNewTitle] = useState('');
  const [title, setTitle] = useState(''),
    [description, setDescription] = useState(''),
    [policy, setPolicy] = useState(''),
    [metadata, setMetadata] = useState('');
  const [agentId, setAgentId] = useState(''),
    [role, setRole] = useState<WorkspaceMemberUpdate['role']>('member'),
    [scopes, setScopes] = useState('');
  const [settingsAgent, setSettingsAgent] = useState(''),
    [settingsSession, setSettingsSession] = useState(''),
    [settings, setSettings] = useState<unknown>(null);
  const [confirmation, setConfirmation] = useState<{
    workspace: Workspace;
    member?: string;
  } | null>(null);
  const generation = useRef(0),
    listGeneration = useRef(0);
  const canRead = memoryCan(profile, 'workspaces:read'),
    canCreate = memoryCan(profile, 'workspaces:write');
  function show(workspace: Workspace) {
    setSelected(workspace);
    setTitle(workspace.title ?? '');
    setDescription(workspace.description ?? '');
    setPolicy(JSON.stringify(workspace.policy, null, 2));
    setMetadata(JSON.stringify(workspace.metadata, null, 2));
    setSettings(null);
  }
  async function refresh() {
    if (!canRead) return;
    const current = ++listGeneration.current;
    const list = await memoryApi.workspaces(offset, includeArchived);
    if (current === listGeneration.current) setWorkspaces(list);
  }
  async function open(id: string) {
    const current = ++generation.current;
    setSelected(null);
    setError('');
    setSettings(null);
    try {
      const workspace = await memoryApi.workspace(id);
      if (current !== generation.current) return;
      show(workspace);
      const url = new URL(location.href);
      url.searchParams.set('workspace', id);
      history.replaceState(null, '', url);
    } catch (error) {
      if (current === generation.current)
        setError(
          error instanceof Error ? error.message : 'Workspace unavailable',
        );
    }
  }
  async function action(operation: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
      await refresh();
      setNotice(message);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Workspace operation failed',
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh()
      .catch((error) =>
        setError(
          error instanceof Error ? error.message : 'Workspace list unavailable',
        ),
      )
      .finally(() => setLoaded(true));
    return () => {
      listGeneration.current++;
    };
  }, [offset, includeArchived]);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('workspace');
    if (id && id !== '*' && canRead) void open(id);
    return () => {
      generation.current++;
    };
  }, []);
  if (!canRead)
    return (
      <Panel title="Workspace access unavailable">
        <p>Your product token does not permit workspace reads.</p>
      </Panel>
    );
  const canEdit =
    selected &&
    !selected.deleted_at &&
    workspaceCan(profile, selected, 'admin');
  const canOwn = selected && workspaceCan(profile, selected, 'owner');
  return (
    <section className="workspaces-module">
      <PageHeader
        title="Workspaces"
        description="Manage memory boundaries, membership and policy in HiveMem."
        actions={<Button
          disabled={busy}
          onClick={() => void action(refresh, 'Workspace list refreshed.')}
        >
          Refresh
        </Button>}
      />
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="page-grid page-grid--2">
        <Panel title="Workspace directory">
          <Toggle
            label="Include archived workspaces"
            checked={includeArchived}
            disabled={busy}
            onChange={(value) => {
              setOffset(0);
              setIncludeArchived(value);
            }}
          />
          {workspaces.length ? (
            <div className="stack-list">
              {workspaces.map((workspace) => (
                <button
                  className="stack-item stack-item--button"
                  key={workspace.workspace_id}
                  disabled={busy}
                  onClick={() => void open(workspace.workspace_id)}
                >
                  <span>
                    <strong>{workspace.title ?? workspace.workspace_id}</strong>
                    <span className="muted-line">
                      {workspace.workspace_id} ·{' '}
                      {workspace.deleted_at ? 'Archived' : 'Active'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : loaded ? (
            <EmptyState
              compact
              title="No workspaces"
              message={
                includeArchived
                  ? 'No permitted workspaces returned.'
                  : 'No permitted workspaces returned. Archived workspaces are hidden.'
              }
            />
          ) : (
            <LoadingRows rows={3} />
          )}
          <div className="inline-actions">
            <Button
              disabled={busy || !offset}
              onClick={() => setOffset((value) => Math.max(0, value - 25))}
            >
              Previous
            </Button>
            <span>Page {Math.floor(offset / 25) + 1}</span>
            <Button
              disabled={busy || workspaces.length < 25}
              onClick={() => setOffset((value) => value + 25)}
            >
              Next
            </Button>
          </div>
        </Panel>
        <Panel title="Create workspace">
          <Field
            label="Workspace ID"
            hint="IDs remain reserved after archival."
          >
            <TextInput value={newId} onChange={setNewId} />
          </Field>
          <Field label="Title">
            <TextInput value={newTitle} onChange={setNewTitle} />
          </Field>
          <Button
            variant="primary"
            disabled={busy || !canCreate || !newId.trim()}
            onClick={() =>
              void action(async () => {
                show(
                  await memoryApi.create({
                    workspace_id: newId.trim(),
                    title: newTitle.trim() || null,
                  }),
                );
                setNewId('');
                setNewTitle('');
              }, 'Workspace created. Your linked account owns it.')
            }
          >
            Create workspace
          </Button>
        </Panel>
      </div>
      {selected && (
        <>
          <Panel
            title={selected.title ?? selected.workspace_id}
            eyebrow={
              selected.deleted_at ? 'Archived workspace' : selected.workspace_id
            }
          >
            <p>
              Owner: {selected.owner_agent_id}. Archiving preserves memories,
              policy and membership.
            </p>
            <div className="inline-actions">
              <a
                href={
                  '/?page=memories&workspace=' +
                  encodeURIComponent(selected.workspace_id)
                }
              >
                Browse workspace memories
              </a>
              {selected.deleted_at ? (
                <Button
                  disabled={busy || !canOwn}
                  onClick={() =>
                    void action(
                      async () =>
                        show(await memoryApi.restore(selected.workspace_id)),
                      'Workspace restored with its existing owner and membership.',
                    )
                  }
                >
                  Restore workspace
                </Button>
              ) : (
                <Button
                  variant="danger"
                  disabled={busy || !canOwn}
                  onClick={() => setConfirmation({ workspace: selected })}
                >
                  Archive workspace
                </Button>
              )}
            </div>
            <Field label="Title">
              <TextInput value={title} onChange={setTitle} />
            </Field>
            <Field label="Description">
              <TextArea
                value={description}
                onChange={setDescription}
                rows={3}
              />
            </Field>
            <Field label="Metadata (JSON object)">
              <TextArea value={metadata} onChange={setMetadata} rows={5} />
            </Field>
            <Field
              label="Policy (JSON)"
              hint="The complete policy is retained, including agent/session overrides and sanitization. Saving replaces this policy."
            >
              <TextArea value={policy} onChange={setPolicy} rows={15} />
            </Field>
            <Button
              variant="primary"
              disabled={busy || !canEdit}
              onClick={() =>
                void action(async () => {
                  const parsed: unknown = JSON.parse(metadata);
                  if (
                    !parsed ||
                    typeof parsed !== 'object' ||
                    Array.isArray(parsed)
                  )
                    throw Error('Metadata must be a JSON object');
                  show(
                    await memoryApi.update(selected.workspace_id, {
                      title: title.trim() || null,
                      description: description.trim() || null,
                      metadata: parsed as Record<string, unknown>,
                      policy: WorkspacePolicySchema.parse(JSON.parse(policy)),
                    }),
                  );
                }, 'Workspace details and policy saved.')
              }
            >
              Save workspace
            </Button>
          </Panel>
          <div className="page-grid page-grid--2">
            <Panel title="Members">
              <div className="stack-list">
                {selected.members.map((member) => (
                  <div className="stack-item" key={member.agent_id}>
                    <div>
                      <strong>{member.agent_id}</strong>
                      <span className="muted-line">
                        {member.role} ·{' '}
                        {member.scopes.join(', ') || 'Role permissions'}
                      </span>
                    </div>
                    <div className="inline-actions">
                      <Button
                        disabled={
                          busy ||
                          !canEdit ||
                          (member.role === 'owner' && !canOwn) ||
                          member.agent_id === selected.owner_agent_id
                        }
                        onClick={() => {
                          setAgentId(member.agent_id);
                          setRole(member.role);
                          setScopes(member.scopes.join(', '));
                        }}
                      >
                        Edit member
                      </Button>
                      <Button
                        variant="danger"
                        disabled={
                          busy ||
                          !canEdit ||
                          (member.role === 'owner' && !canOwn) ||
                          member.agent_id === selected.owner_agent_id
                        }
                        onClick={() =>
                          setConfirmation({
                            workspace: selected,
                            member: member.agent_id,
                          })
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <Field label="Agent ID">
                <TextInput value={agentId} onChange={setAgentId} />
              </Field>
              <Field label="Role">
                <select
                  value={role}
                  onChange={(event) =>
                    setRole(event.target.value as WorkspaceMemberUpdate['role'])
                  }
                >
                  <option value="viewer">Viewer</option>
                  <option value="member">Member</option>
                  <option value="admin">Administrator</option>
                  {canOwn && <option value="owner">Owner</option>}
                </select>
              </Field>
              <Field label="Scopes (comma separated)">
                <TextInput value={scopes} onChange={setScopes} />
              </Field>
              <Button
                disabled={
                  busy ||
                  !canEdit ||
                  !agentId.trim() ||
                  agentId.trim() === selected.owner_agent_id
                }
                onClick={() =>
                  void action(async () => {
                    show(
                      await memoryApi.member(
                        selected.workspace_id,
                        agentId.trim(),
                        {
                          role,
                          scopes: scopes
                            .split(',')
                            .map((value) => value.trim())
                            .filter(Boolean),
                        },
                      ),
                    );
                    setAgentId('');
                    setScopes('');
                  }, 'Membership saved.')
                }
              >
                Save member
              </Button>
            </Panel>
            <Panel title="Resolved policy and consolidation">
              <Field label="Agent ID (optional)">
                <TextInput value={settingsAgent} onChange={setSettingsAgent} />
              </Field>
              <Field label="Session ID (optional)">
                <TextInput
                  value={settingsSession}
                  onChange={setSettingsSession}
                />
              </Field>
              <Button
                disabled={busy || Boolean(selected.deleted_at)}
                onClick={() =>
                  void action(
                    async () =>
                      setSettings(
                        await memoryApi.settings(
                          selected.workspace_id,
                          settingsAgent,
                          settingsSession,
                        ),
                      ),
                    'Policy resolved.',
                  )
                }
              >
                Resolve policy
              </Button>
              {settings !== null && <JsonBlock value={settings} />}
              <p>
                Schedule a dream job using the existing consolidation worker.
              </p>
              <Button
                disabled={busy || Boolean(selected.deleted_at) || !canCreate}
                onClick={() =>
                  void action(
                    async () =>
                      setSettings(
                        await memoryApi.scheduleDream(selected.workspace_id),
                      ),
                    'Consolidation job scheduled. Check the memory queue for progress.',
                  )
                }
              >
                Schedule consolidation
              </Button>
            </Panel>
          </div>
        </>
      )}
      {confirmation && (
        <ConfirmDialog
          open
          confirmLabel={
            confirmation.member ? 'Remove member' : 'Archive workspace'
          }
          title={
            confirmation.member
              ? 'Remove workspace member?'
              : 'Archive workspace?'
          }
          message={
            confirmation.member
              ? 'The selected account will lose its workspace membership.'
              : 'Memories and memberships remain stored. Only the owner or a product administrator can restore this workspace.'
          }
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            const pending = confirmation;
            setConfirmation(null);
            void action(
              async () => {
                if (pending.member)
                  show(
                    await memoryApi.removeMember(
                      pending.workspace.workspace_id,
                      pending.member,
                    ),
                  );
                else {
                  await memoryApi.archive(pending.workspace.workspace_id);
                  show(
                    await memoryApi.workspace(pending.workspace.workspace_id),
                  );
                }
              },
              pending.member ? 'Member removed.' : 'Workspace archived.',
            );
          }}
        />
      )}
    </section>
  );
}
