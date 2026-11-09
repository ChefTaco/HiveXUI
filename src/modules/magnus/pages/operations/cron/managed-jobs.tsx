import { useState, type FormEvent } from 'react';
import { Pause, Play, Plus, RefreshCw } from 'lucide-react';
import { cronCreateResponseSchema, cronListResponseSchema, cronUpdateResponseSchema, nodeListResponseSchema } from '@contracts/magnus/browser';
import type { z } from 'zod';
import { Badge, Button, Drawer, Field, Select, TextInput } from '@ui';
import { formatTime } from '@lib/format';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { useMagnusSession, WRITE_ROLES } from '../../../session';
import { FxPanel } from '../../../effects';
import { ResourceError } from '../../../ui/resource-state';
import { FormError } from '../shared/parts';
import { finiteJobBody, localExpiry, managedRegistration, scheduleActive } from './managed-model';

type Job = z.output<typeof cronListResponseSchema>['data'][number];
export function ManagedJobs() {
  const session = useMagnusSession(); const canWrite = session.can(WRITE_ROLES);
  const jobs = useMagnusResource(signal => magnus.get('/cron', cronListResponseSchema, { signal }));
  const nodes = useMagnusResource(signal => magnus.get('/nodes', nodeListResponseSchema, { signal, query: { pageSize: 100 } }));
  const [editing, setEditing] = useState<Job | 'new' | null>(null);
  const [name, setName] = useState(''); const [nodeId, setNodeId] = useState('');
  const [command, setCommand] = useState(''); const [args, setArgs] = useState('[]');
  const [schedule, setSchedule] = useState('0 * * * *'); const [timeout, setTimeoutSeconds] = useState('60');
  const [expires, setExpires] = useState(localExpiry); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const list = (jobs.data?.data ?? []).filter(job => job.managed);
  function open(job: Job | 'new') {
    setEditing(job); setError(''); setExpires(localExpiry());
    setName(job === 'new' ? '' : job.name); setNodeId(job === 'new' ? '' : job.nodeId);
    setCommand(job === 'new' ? '' : job.command); setArgs(job === 'new' ? '[]' : job.args);
    setSchedule(job === 'new' ? '0 * * * *' : job.schedule); setTimeoutSeconds(job === 'new' ? '60' : String(job.timeoutSeconds));
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!editing) return; setError(''); setBusy(true);
    try {
      if (editing === 'new') {
        await magnus.post('/cron', cronCreateResponseSchema, { body: finiteJobBody({ name, nodeId, command, args, schedule, timeout, expires }) });
      } else {
        const managed = managedRegistration(timeout, expires, (editing.managed?.revision ?? 0) + 1);
        await magnus.patch(`/cron/${segment(editing.id)}`, cronUpdateResponseSchema, {
          body: { status: 'ACTIVE', timeoutSeconds: managed.timeoutSeconds, managed } });
      }
      setEditing(null); void jobs.refresh();
    } catch (caught) { setError(errorMessage(caught, 'The schedule was not acknowledged. Review its state before retrying.')); }
    finally { setBusy(false); }
  }
  async function pause(job: Job) {
    setError(''); setBusy(true);
    try { await magnus.patch(`/cron/${segment(job.id)}`, cronUpdateResponseSchema, { body: { status: 'PAUSED' } }); void jobs.refresh(); }
    catch (caught) { setError(errorMessage(caught, 'The node did not acknowledge the pause.')); }
    finally { setBusy(false); }
  }
  return <>
    <FxPanel title="Managed schedules" description="Finite UTC schedules on fully enrolled nodes. Every run has an execution budget; schedules stop admitting runs at their expiry." interactive={false}>
      <div className="mb-4 flex flex-wrap gap-2">
        {canWrite ? <Button size="sm" icon={<Plus className="size-4" />} onClick={() => open('new')}>Add managed job</Button> : null}
        <Button size="sm" icon={<RefreshCw className="size-4" />} onClick={() => void jobs.refresh()} disabled={jobs.loading || jobs.refreshing}>Refresh schedules</Button>
      </div>
      {jobs.error ? <ResourceError error={jobs.error} title="Schedules could not be loaded" onRetry={() => void jobs.refresh()} /> : null}
      {error && !editing ? <FormError message={error} /> : null}
      {!jobs.loading && !jobs.error && list.length === 0 ? <p className="text-sm text-text-muted">No managed schedules yet.</p> : null}
      <div className="grid gap-3">{list.map(job => <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border p-3">
        <div className="min-w-0"><strong>{job.name}</strong> <Badge tone={scheduleActive(job.managed!) ? 'success' : 'neutral'}>{scheduleActive(job.managed!) ? 'Enabled' : Date.parse(job.managed!.expiresAt) <= Date.now() ? 'Expired' : 'Paused'}</Badge>
          <p className="m-0 break-words font-mono text-sm">{job.command}</p>
          <p className="m-0 text-xs text-text-muted">{job.node.name} · {job.schedule} UTC · {job.timeoutSeconds}s · expires {formatTime(job.managed!.expiresAt)}</p>
          {job.lastRunAt ? <p className="m-0 text-xs text-text-muted">Last run {formatTime(job.lastRunAt)} · exit {job.lastRunExitCode ?? 'pending'}</p> : null}
        </div>
        {canWrite ? <Button size="sm" disabled={busy} icon={scheduleActive(job.managed!) ? <Pause className="size-4" /> : <Play className="size-4" />}
          onClick={() => scheduleActive(job.managed!) ? void pause(job) : open(job)}>{scheduleActive(job.managed!) ? 'Pause' : 'Resume…'}</Button> : null}
      </div>)}</div>
    </FxPanel>
    <Drawer open={editing !== null} title={editing === 'new' ? 'New managed schedule' : 'Resume managed schedule'} onClose={() => { if (!busy) setEditing(null); }}>
      <form className="grid gap-4" onSubmit={event => void submit(event)}>
        <FormError message={error} />
        {editing === 'new' ? <>
          <Field label="Job name"><TextInput value={name} onChange={setName} required /></Field>
          <Field label="Target node" hint="Requires full node enrollment."><Select value={nodeId} onChange={setNodeId} required options={[{ value: '', label: 'Select a node…' }, ...(nodes.data?.data ?? []).filter(node => node.status === 'ONLINE').map(node => ({ value: node.id, label: node.name }))]} /></Field>
          <Field label="Command" hint="Executable path; use arguments for its parameters."><TextInput value={command} onChange={setCommand} placeholder="/usr/bin/uptime" required /></Field>
          <Field label="Arguments (JSON array)"><TextInput value={args} onChange={setArgs} required /></Field>
          <Field label="Schedule (UTC)" hint="Numeric five-field cron expression."><TextInput value={schedule} onChange={setSchedule} required /></Field>
        </> : <p className="text-sm">Resume {name} with a new revision and the expiry below. The command and UTC schedule stay the same.</p>}
        <Field label="Timeout (seconds)"><TextInput type="number" min={1} max={3600} step={1} value={timeout} onChange={setTimeoutSeconds} required /></Field>
        <Field label="Expires (local time)"><TextInput type="datetime-local" value={expires} onChange={setExpires} required /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>{editing === 'new' ? 'Create schedule' : 'Resume schedule'}</Button></div>
      </form>
    </Drawer>
  </>;
}
