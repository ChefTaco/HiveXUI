import { useEffect, useState } from 'react';
import { libraryFilesListResponseSchema } from '@contracts/magnus/browser';
import { Eye, EyeOff, Lock, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { Button, Drawer, Field, IconButton, Select, TextArea, TextInput, Toggle } from '@ui';
import { cn } from '@lib/cn';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { ADMIN_ONLY, useMagnusSession } from '../../../session';
import { CRONJOB_MIME, SKILL_MIME } from '../library/logic';
import { envEntriesFor, envPayload, isWritableFirewallMode, parseLines, parseList, type EnvEntry } from './logic';
import { roleMutationResponseSchema, type RoleDetail } from './schemas';

const TABS = [
  { key: 'basic', label: 'Basic' },
  { key: 'packages', label: 'Packages and env' },
  { key: 'files', label: 'Skills and jobs' },
  { key: 'docker', label: 'Docker' },
  { key: 'firewall', label: 'Firewall' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

function EnvEditor({ entries, onChange, isAdmin, editing }: { entries: EnvEntry[]; onChange: (entries: EnvEntry[]) => void; isAdmin: boolean; editing: boolean }) {
  const [shown, setShown] = useState(false);
  const update = (index: number, field: 'key' | 'value', value: string) => onChange(entries.map((entry, at) => (at === index ? { ...entry, [field]: value } : entry)));
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="field-label">Environment variables</span>
        <span className="flex gap-1">
          {isAdmin && entries.length > 0 ? <Button type="button" size="sm" variant="ghost" icon={shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />} onClick={() => setShown((value) => !value)}>{shown ? 'Hide values' : 'Show values'}</Button> : null}
          <Button type="button" size="sm" icon={<Plus className="size-4" />} onClick={() => onChange([...entries, { key: '', value: '', locked: false }])}>Add</Button>
        </span>
      </div>
      {isAdmin ? (
        <p className="m-0 text-xs text-text-muted">Values are written to hosts and may be secrets. Only ADMIN can read them. Removing a key here removes it from the role.</p>
      ) : (
        <p data-testid="env-restricted" className="m-0 flex items-start gap-2 rounded-control border border-warning bg-warning-soft px-3 py-2 text-sm text-warning">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>Only ADMIN can read values or remove keys. {editing ? 'Existing values stay hidden: leave one blank to keep it, or type to replace it. ' : ''}You can add new keys.</span>
        </p>
      )}
      {entries.map((entry, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
          <TextInput aria-label={`Variable ${index + 1} name`} value={entry.key} onChange={(value) => update(index, 'key', value)} placeholder="KEY_NAME" readOnly={entry.locked} className={cn('font-mono', entry.locked && 'text-text-muted')} autoComplete="off" />
          <TextInput aria-label={`${entry.key || `Variable ${index + 1}`} value`} type={shown ? 'text' : 'password'} value={entry.value} onChange={(value) => update(index, 'value', value)} placeholder={entry.locked ? 'Hidden: blank keeps it' : 'value'} autoComplete="new-password" />
          {entry.locked ? <span title="Only ADMIN can remove this key" className="flex size-8 items-center justify-center text-text-muted"><Lock aria-label={`${entry.key} cannot be removed at your role`} className="size-4" /></span> : <IconButton type="button" label={`Remove ${entry.key || `variable ${index + 1}`}`} variant="danger" icon={<Trash2 className="size-4" />} onClick={() => onChange(entries.filter((_, at) => at !== index))} />}
        </div>
      ))}
      {entries.length === 0 ? <p className="m-0 py-2 text-sm text-text-muted">No environment variables are configured.</p> : null}
    </div>
  );
}

export function RoleDrawer({ open, role, onClose, onSaved }: { open: boolean; role: RoleDetail | null; onClose: () => void; onSaved: () => void }) {
  const { can } = useMagnusSession();
  const isAdmin = can(ADMIN_ONLY);
  const [tab, setTab] = useState<TabKey>('basic');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('active');
  const [libraryFileIds, setLibraryFileIds] = useState<string[]>([]);
  const [apt, setApt] = useState('');
  const [npm, setNpm] = useState('');
  const [env, setEnv] = useState<EnvEntry[]>([]);
  const [dockerEnabled, setDockerEnabled] = useState(false);
  const [dockerNonRoot, setDockerNonRoot] = useState(false);
  const [dockerImage, setDockerImage] = useState('');
  const [dockerVolumes, setDockerVolumes] = useState('');
  const [firewallEnabled, setFirewallEnabled] = useState(false);
  const [firewallMode, setFirewallMode] = useState('restrictive');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const library = useMagnusResource((signal) => magnus.get('/library/files', libraryFilesListResponseSchema, { query: { pageSize: 200 }, signal }), [], { enabled: open });
  const files = library.data?.data ?? [];

  useEffect(() => {
    if (!open) return;
    setTab('basic');
    setError('');
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setStatus(role?.status ?? 'active');
    setLibraryFileIds(role?.libraryFileIds ?? []);
    setApt(role?.aptPackages.join(', ') ?? '');
    setNpm(role?.npmPackages.join(', ') ?? '');
    setEnv(envEntriesFor(role, isAdmin));
    setDockerEnabled(role?.dockerEnabled ?? false);
    setDockerNonRoot(role?.dockerNonRoot ?? false);
    setDockerImage(role?.dockerImage ?? '');
    setDockerVolumes(role?.dockerVolumes.join('\n') ?? '');
    setFirewallEnabled(role?.firewallEnabled ?? false);
    setFirewallMode(role?.firewallMode ?? 'restrictive');
  }, [open, role, isAdmin]);

  async function save() {
    if (!name.trim()) {
      setTab('basic');
      setError('A role needs a name.');
      return;
    }
    setSaving(true);
    setError('');
    const envConfig = envPayload(env, role, isAdmin);
    const body = {
      name: name.trim(),
      description: description.trim(),
      status,
      libraryFileIds,
      aptPackages: parseList(apt),
      npmPackages: parseList(npm),
      ...(envConfig ? { envConfig } : {}),
      dockerEnabled,
      dockerNonRoot,
      dockerImage: dockerImage.trim() || null,
      dockerVolumes: parseLines(dockerVolumes),
      firewallEnabled,
      ...(isWritableFirewallMode(firewallMode) ? { firewallMode } : {}),
    };
    try {
      if (role) await magnus.patch(`/roles/${segment(role.id)}`, roleMutationResponseSchema, { body });
      else await magnus.post('/roles', roleMutationResponseSchema, { body });
      onSaved();
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, 'The role could not be saved'));
    } finally {
      setSaving(false);
    }
  }
  const pickList = (title: string, mimeType: string, emptyText: string) => {
    const options = files.filter((file) => file.mimeType === mimeType);
    return (
      <div className="field">
        <span className="field-label">{title}</span>
        <div className="grid max-h-40 gap-1 overflow-y-auto rounded-control border border-border bg-surface-sunken p-2">
          {options.length === 0 ? <p className="m-0 px-2 py-1 text-sm text-text-muted">{emptyText}</p> : options.map((file) => (
            <label key={file.id} className="flex cursor-pointer items-center gap-2 rounded-chip px-2 py-1.5 text-sm hover:bg-surface-hover">
              <input type="checkbox" checked={libraryFileIds.includes(file.id)} onChange={() => setLibraryFileIds((previous) => (previous.includes(file.id) ? previous.filter((id) => id !== file.id) : [...previous, file.id]))} />
              <span className="min-w-0 truncate">{file.name}</span>
              <span className="ml-auto truncate text-xs text-text-muted">{file.fileName}</span>
            </label>
          ))}
        </div>
      </div>
    );
  };
  return (
    <Drawer
      open={open}
      title={role ? 'Edit node role' : 'Create node role'}
      eyebrow={role ? role.name : 'A reusable host provisioning bundle'}
      onClose={onClose}
      footer={
        <div className="grid w-full gap-2">
          {error ? <p role="alert" className="m-0 rounded-control border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>{role ? 'Save changes' : 'Create role'}</Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-4">
        <div className="tabs" role="tablist" aria-label="Role sections">
          {TABS.map((item) => <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => setTab(item.key)} className={cn('tab', tab === item.key && 'tab--active')}>{item.label}</button>)}
        </div>
        {tab === 'basic' ? (
          <>
            <Field label="Role name"><TextInput value={name} onChange={setName} placeholder="web-server" required /></Field>
            <Field label="Description"><TextArea value={description} onChange={setDescription} rows={3} placeholder="Standard web server with Nginx and monitoring…" /></Field>
            <Field label="Status"><Select value={status} onChange={setStatus} options={[{ value: 'active', label: 'Active' }, { value: 'draft', label: 'Draft' }]} /></Field>
          </>
        ) : null}
        {tab === 'packages' ? (
          <>
            <Field label="APT packages" hint="Comma-separated package names"><TextInput value={apt} onChange={setApt} placeholder="nginx, curl, htop, jq" /></Field>
            <Field label="NPM global packages" hint="Comma-separated package names"><TextInput value={npm} onChange={setNpm} placeholder="pm2, tsx" /></Field>
            <EnvEditor entries={env} onChange={setEnv} isAdmin={isAdmin} editing={!!role} />
          </>
        ) : null}
        {tab === 'files' ? (
          <>
            {library.error && !library.data ? <p role="alert" className="m-0 text-sm text-warning">The library could not be loaded: {errorMessage(library.error)}</p> : null}
            {pickList('Skills from the library', SKILL_MIME, 'The library holds no skills.')}
            {pickList('Cron jobs from the library', CRONJOB_MIME, 'The library holds no cron jobs.')}
          </>
        ) : null}
        {tab === 'docker' ? (
          <>
            <Toggle checked={dockerEnabled} onChange={setDockerEnabled} label="Run the workload inside a Docker container" />
            {dockerEnabled ? (
              <>
                <Toggle checked={dockerNonRoot} onChange={setDockerNonRoot} label="Run as a non-root user inside the container" />
                <Field label="Custom Docker image" hint="Leave empty for the default node:22-slim"><TextInput value={dockerImage} onChange={setDockerImage} placeholder="node:22-slim" /></Field>
                <Field label="Volume mounts" hint="One per line, for example /mnt/data/output:/mnt/data/output"><TextArea value={dockerVolumes} onChange={setDockerVolumes} rows={3} placeholder="/host/path:/container/path" className="font-mono text-xs" /></Field>
              </>
            ) : <p className="m-0 rounded-control border border-border bg-surface-sunken p-4 text-center text-sm text-text-muted">Enable Docker sandboxing to run workloads in an isolated container with an optional non-root user.</p>}
          </>
        ) : null}
        {tab === 'firewall' ? (
          <>
            <Toggle checked={firewallEnabled} onChange={setFirewallEnabled} label="Enable the UFW firewall on the node" />
            {firewallEnabled ? (
              <>
                <Field label="Firewall mode">
                  <Select
                    value={firewallMode}
                    onChange={setFirewallMode}
                    options={[
                      { value: 'restrictive', label: 'Restrictive: block private LAN, allow SSH and Magnus' },
                      { value: 'permissive', label: 'Permissive: allow SSH and Magnus only' },
                      ...(isWritableFirewallMode(firewallMode) ? [] : [{ value: firewallMode, label: `${firewallMode} (set outside this console)` }]),
                    ]}
                  />
                </Field>
                {firewallMode === 'restrictive' ? (
                  <div className="rounded-control border border-warning bg-warning-soft px-3 py-2 text-sm text-warning">
                    <p className="m-0 font-semibold">Rules this mode writes</p>
                    <ul className="m-0 mt-1 grid list-none gap-0.5 p-0 text-xs">
                      <li>Allow SSH (port 22)</li>
                      <li>Allow the Magnus agent port (4100)</li>
                      <li>Allow from the control API address</li>
                      <li>Deny 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16</li>
                    </ul>
                  </div>
                ) : null}
              </>
            ) : <p className="m-0 rounded-control border border-border bg-surface-sunken p-4 text-center text-sm text-text-muted">Enable UFW to firewall the node away from local networks while preserving Magnus agent communication.</p>}
          </>
        ) : null}
      </div>
    </Drawer>
  );
}
