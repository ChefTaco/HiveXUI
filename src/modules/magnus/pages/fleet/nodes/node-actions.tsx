import { useEffect, useState, type FormEvent } from 'react';
import { assignRoleResponseSchema, registerNodeResponseSchema, roleListResponseSchema, unassignRoleResponseSchema, updateNodeResponseSchema } from '@contracts/magnus/browser';
import { Button, Drawer, Field, Select, TextInput, Toggle } from '@ui';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusSession } from '../../../session';
import { ActionConfirm } from '../../../ui/action-confirm';
import { parseTags, type NodeRow } from './nodes-api';

const splitTags = (value: string) => value.split(',').map((tag) => tag.trim()).filter(Boolean);
const NODE_STATUSES = ['ONLINE', 'OFFLINE', 'DEGRADED', 'PROVISIONING', 'DECOMMISSIONED'];
const OS_OPTIONS = [{ value: 'linux', label: 'Linux' }, { value: 'darwin', label: 'macOS' }, { value: 'windows', label: 'Windows' }];
const ARCH_OPTIONS = [{ value: 'x86_64', label: 'x86_64' }, { value: 'aarch64', label: 'aarch64' }, { value: 'arm', label: 'arm' }];

function FormError({ message }: { message: string }) {
  return message ? <p role="alert" className="m-0 rounded-control border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{message}</p> : null;
}

export function EditNodeDrawer({ node, onClose, onSaved }: { node: Omit<NodeRow, 'health'> | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!node) return;
    setName(node.name);
    setTags(parseTags(node.tags).join(', '));
    setStatus(node.status);
    setError('');
  }, [node]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!node || !name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await magnus.patch(`/nodes/${segment(node.id)}`, updateNodeResponseSchema, { body: { name: name.trim(), tags: splitTags(tags), status } });
      onSaved();
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, 'The node could not be updated'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Drawer open={!!node} title="Edit node" {...(node ? { eyebrow: node.hostname } : {})} onClose={onClose}>
      <form className="grid gap-4" onSubmit={(event) => void save(event)}>
        <Field label="Name"><TextInput value={name} onChange={setName} required /></Field>
        <Field label="Status"><Select value={status} onChange={setStatus} options={NODE_STATUSES.map((value) => ({ value, label: value }))} /></Field>
        <Field label="Tags" hint="A comma-separated list"><TextInput value={tags} onChange={setTags} placeholder="web, production, us-east" /></Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!name.trim()}>Save changes</Button>
        </div>
      </form>
    </Drawer>
  );
}

export function RegisterNodeDrawer({ open, onClose, onRegistered }: { open: boolean; onClose: () => void; onRegistered: () => void }) {
  const { session } = useMagnusSession();
  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState('4100');
  const [os, setOs] = useState('linux');
  const [arch, setArch] = useState('x86_64');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  function reset() {
    setName('');
    setHostname('');
    setPort('4100');
    setOs('linux');
    setArch('x86_64');
    setTags('');
    setError('');
  }
  async function register(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !hostname.trim()) return;
    setSaving(true);
    setError('');
    try {
      await magnus.post('/nodes/register', registerNodeResponseSchema, {
        body: {
          name: name.trim(),
          hostname: hostname.trim(),
          ipAddress: hostname.trim(),
          port: Number(port) || 4100,
          os,
          arch,
          tags: splitTags(tags),
          ...(session ? { agentVersion: session.capabilities.agentVersion } : {}),
        },
      });
      onRegistered();
      reset();
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, 'The node could not be registered'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Drawer open={open} title="Register node" eyebrow="A node already running the agent" onClose={onClose}>
      <form className="grid gap-4" onSubmit={(event) => void register(event)}>
        <Field label="Node name"><TextInput value={name} onChange={setName} placeholder="web-server-01" required /></Field>
        <Field label="FQDN or hostname"><TextInput value={hostname} onChange={setHostname} placeholder="node-1.example.com" required /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Port"><TextInput type="number" value={port} onChange={setPort} /></Field>
          <Field label="OS"><Select value={os} onChange={setOs} options={OS_OPTIONS} /></Field>
          <Field label="Architecture"><Select value={arch} onChange={setArch} options={ARCH_OPTIONS} /></Field>
        </div>
        <Field label="Tags" hint="A comma-separated list"><TextInput value={tags} onChange={setTags} placeholder="web, production, us-east" /></Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!name.trim() || !hostname.trim()}>Register node</Button>
        </div>
      </form>
    </Drawer>
  );
}

export function AssignRoleDrawer({ node, onClose, onSaved }: { node: Omit<NodeRow, 'health'> | null; onClose: () => void; onSaved: () => void }) {
  const [roles, setRoles] = useState<ReadonlyArray<{ id: string; name: string }>>([]);
  const [selected, setSelected] = useState('');
  const [applyNow, setApplyNow] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState<'unassign' | 'change' | null>(null);
  const current = node?.role?.id;
  useEffect(() => {
    if (!node) return;
    const controller = new AbortController();
    setError('');
    setSelected(node.role?.id ?? '');
    setApplyNow(true);
    setLoading(true);
    magnus
      .get('/roles', roleListResponseSchema, { signal: controller.signal })
      .then((result) => setRoles(result.data))
      .catch((caught) => {
        if (!controller.signal.aborted) setError(errorMessage(caught, 'Roles could not be loaded'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [node]);
  /** Each is one request, sent once: a failure leaves the choice to the operator. */
  async function run(steps: () => Promise<unknown>) {
    setSaving(true);
    setError('');
    try {
      await steps();
      onSaved();
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, 'The role could not be changed'));
    } finally {
      setSaving(false);
    }
  }
  const unassign = (roleId: string) => magnus.post(`/roles/${segment(roleId)}/unassign`, unassignRoleResponseSchema, { body: { nodeIds: [node!.id] } });
  const assign = () => magnus.post(`/roles/${segment(selected)}/assign`, assignRoleResponseSchema, { body: { nodeIds: [node!.id], defer: !applyNow } });
  function confirmed() {
    setConfirming(null);
    if (!current) return;
    void run(async () => {
      await unassign(current);
      if (confirming === 'change') await assign();
    });
  }
  return (
    <>
    <ActionConfirm
      open={!!confirming && !!node}
      title={confirming === 'change' ? 'Change this role?' : 'Unassign this role?'}
      message={`${confirming === 'change' ? 'Change the role of' : 'Unassign the role from'} ${node?.name ?? 'this node'}? This removes the current role's configuration from it.`}
      confirmLabel={confirming === 'change' ? 'Change role' : 'Unassign'}
      onConfirm={confirmed}
      onCancel={() => setConfirming(null)}
    />
    {/* The drawer steps aside: two dialogs would both trap the keyboard. */}
    <Drawer open={!!node && !confirming} title={node?.role ? 'Change role' : 'Assign role'} {...(node ? { eyebrow: node.name } : {})} onClose={onClose}>
      <div className="grid gap-4">
        {loading ? (
          <p role="status" className="text-sm text-text-muted">Loading roles…</p>
        ) : roles.length === 0 ? (
          <p className="text-sm text-text-muted">No roles exist yet.</p>
        ) : (
          <>
            <Field label="Role"><Select value={selected} onChange={setSelected} options={[{ value: '', label: 'No role' }, ...roles.map((role) => ({ value: role.id, label: role.name }))]} /></Field>
            {selected ? <Toggle checked={applyNow} onChange={setApplyNow} label="Apply the role now" /> : null}
          </>
        )}
        <FormError message={error} />
        <div className="flex flex-wrap justify-between gap-2">
          <div>{current ? <Button variant="ghost" disabled={saving} onClick={() => setConfirming('unassign')}>Unassign role</Button> : null}</div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              loading={saving}
              disabled={!selected || roles.length === 0}
              onClick={() => {
                if (current && current !== selected) setConfirming('change');
                else void run(assign);
              }}
            >
              {node?.role ? 'Change role' : 'Assign role'}
            </Button>
          </div>
        </div>
      </div>
    </Drawer>
    </>
  );
}
