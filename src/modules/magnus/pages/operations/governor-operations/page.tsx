import { useEffect, useState, type FormEvent } from 'react';
import { Clock, Pause, Play, Plus, RefreshCw, Server, SlidersHorizontal, Terminal, Trash2 } from 'lucide-react';
import { cronCreateResponseSchema, cronDeleteResponseSchema, cronListResponseSchema, cronUpdateResponseSchema, nodeListResponseSchema, skillListResponseSchema } from '@contracts/magnus/browser';
import type { z } from 'zod';
import { Badge, Button, ConfirmDialog, Drawer, EmptyState, Field, IconButton, PageHeader, Select, StatusDot, statusTone, TextInput } from '@ui';
import { formatTime } from '@lib/format';
import { cn } from '@lib/cn';
import { useToast } from '../../../../../components/toast';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel, PageItem } from '../../../effects';
import { useMagnusSession, WRITE_ROLES } from '../../../session';
import { LoadingRows, ResourceError } from '../../../ui/resource-state';
import { FormError } from '../shared/parts';
import { AI_JOB_PREFIX, createJobBody, CUSTOM_SCHEDULE, DEFAULT_SCHEDULE, describeSchedule, displayName, isSkillJob, nextStatus, SCHEDULE_PRESETS, skillCommand } from './job-model';

type Job = z.output<typeof cronListResponseSchema>['data'][number];
type NodeOption = z.output<typeof nodeListResponseSchema>['data'][number];
type Skill = z.output<typeof skillListResponseSchema>['data'][number];

function AddJobDrawer({ open, nodes, skills, onClose, onCreated }: { open: boolean; nodes: readonly NodeOption[]; skills: readonly Skill[]; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [skillName, setSkillName] = useState('');
  const [preset, setPreset] = useState(DEFAULT_SCHEDULE);
  const [custom, setCustom] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const schedule = preset === CUSTOM_SCHEDULE ? custom : preset;
  const skill = skills.find((item) => item.name === skillName);
  useEffect(() => {
    if (!open) return;
    setName('');
    setNodeId('');
    setSkillName('');
    setPreset(DEFAULT_SCHEDULE);
    setCustom('');
    setError('');
  }, [open]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!name.trim() || !nodeId || !skillName || !schedule.trim()) {
      setError('All fields are required.');
      return;
    }
    setSaving(true);
    try {
      await magnus.post('/cron', cronCreateResponseSchema, { body: createJobBody({ name, nodeId, skill: skillName, entryPoint: skill?.entryPoint, schedule }) });
      onCreated();
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, 'The cron job could not be created.'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Drawer open={open} title="New scheduled skill job" onClose={onClose}>
      <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
        <FormError message={error} />
        <Field label="Job name" hint={`Will be prefixed with ${AI_JOB_PREFIX}`}><TextInput placeholder="e.g. Log Analyzer — Prod" value={name} onChange={setName} required /></Field>
        <Field label="Target node">
          <Select value={nodeId} onChange={setNodeId} required options={[{ value: '', label: 'Select a node…' }, ...nodes.map((node) => ({ value: node.id, label: `${node.name} (${node.hostname}) — ${node.status}` }))]} />
        </Field>
        <Field label="Skill" {...(skillName ? { hint: `Command: ${skillCommand(skillName, skill?.entryPoint)}` } : {})}>
          <Select value={skillName} onChange={setSkillName} required options={[{ value: '', label: 'Select a skill…' }, ...skills.map((item) => ({ value: item.name, label: item.description ? `${item.name} — ${item.description}` : item.name }))]} />
        </Field>
        <Field label="Schedule"><Select value={preset} onChange={setPreset} options={SCHEDULE_PRESETS} /></Field>
        {preset === CUSTOM_SCHEDULE ? <Field label="Cron expression"><TextInput className="font-mono" placeholder="e.g. 0 */4 * * *" value={custom} onChange={setCustom} required /></Field> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" icon={<Plus className="size-4" />} loading={saving}>Create job</Button>
        </div>
      </form>
    </Drawer>
  );
}

export default function OperationsPage() {
  const toast = useToast();
  const { can } = useMagnusSession();
  const canWrite = can(WRITE_ROLES);
  const jobs = useMagnusResource((signal) => magnus.get('/cron', cronListResponseSchema, { signal }));
  const nodes = useMagnusResource((signal) => magnus.get('/nodes', nodeListResponseSchema, { query: { pageSize: 100 }, signal }));
  const skills = useMagnusResource((signal) => magnus.get('/skills', skillListResponseSchema, { signal }));
  const [addOpen, setAddOpen] = useState(false);
  const [deleting, setDeleting] = useState<Job | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const list = jobs.data?.data.filter(isSkillJob);
  const nodeList = nodes.data?.data ?? [];
  const refresh = () => {
    void jobs.refresh();
    void nodes.refresh();
    void skills.refresh();
  };
  async function remove() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await magnus.delete(`/cron/${segment(deleting.id)}`, cronDeleteResponseSchema);
      await jobs.refresh();
    } catch (error) {
      toast.error('The job could not be deleted', errorMessage(error));
    } finally {
      setDeleteBusy(false);
      setDeleting(null);
    }
  }
  async function toggle(job: Job) {
    setTogglingId(job.id);
    try {
      await magnus.patch(`/cron/${segment(job.id)}`, cronUpdateResponseSchema, { body: { status: nextStatus(job.status) } });
      await jobs.refresh();
    } catch (error) {
      toast.error('The job could not be changed', errorMessage(error));
    } finally {
      setTogglingId(null);
    }
  }
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader title="Operations" eyebrow="Governor" icon={<SlidersHorizontal className="size-5" />} description="Configure scheduled skill analysis jobs" />
      </PageItem>
      <PageItem>
        <FxPanel
          title="Skill cron jobs"
          description="Deterministic cron jobs that run node skills and record results in Magnus command history."
          interactive={false}
          actions={
            <>
              <IconButton label="Refresh jobs" variant="default" icon={<RefreshCw className={cn('size-4', jobs.refreshing && 'animate-spin')} />} disabled={jobs.refreshing} onClick={refresh} />
              {canWrite ? <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setAddOpen(true)}>Add job</Button> : null}
            </>
          }
        >
          {!list ? (
            jobs.loading ? <LoadingRows /> : <ResourceError error={jobs.error} title="Jobs could not be loaded" onRetry={() => void jobs.refresh()} />
          ) : list.length === 0 ? (
            <EmptyState icon={<Terminal className="size-5" />} title="No scheduled skill jobs yet" {...(canWrite ? { message: 'Choose Add job to create a skill-based analysis cron job.' } : {})} />
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {list.map((job) => {
                const active = job.status === 'ACTIVE';
                return (
                  <li key={`${job.id}-${job.status}`} className={cn('fx-rail scan-sweep flex items-start gap-3 rounded-control border border-border px-3 py-2.5 hover:border-accent', job.status === 'PAUSED' && 'opacity-60')}>
                    <StatusDot status={job.status} className="mt-1.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{displayName(job.name)}</span>
                        <Badge tone={statusTone(job.status)}>{job.status}</Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-text-muted">
                        <span className="flex items-center gap-1"><Clock aria-hidden="true" className="size-4" />{describeSchedule(job.schedule)}</span>
                        <span className="flex items-center gap-1"><Server aria-hidden="true" className="size-4" />{job.node.name}</span>
                        {job.lastRunAt ? <span className="num">Last run: {formatTime(job.lastRunAt)}</span> : null}
                      </div>
                      <p className="m-0 mt-0.5 truncate font-mono text-xs text-text-muted" title={job.command}>{job.command}</p>
                    </div>
                    {canWrite ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <IconButton label={active ? `Pause ${displayName(job.name)}` : `Resume ${displayName(job.name)}`} icon={active ? <Pause className="size-4" /> : <Play className="size-4" />} disabled={togglingId === job.id || job.status === 'ERROR'} onClick={() => void toggle(job)} />
                        <IconButton label={`Delete ${displayName(job.name)}`} variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(job)} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </FxPanel>
      </PageItem>
      <ConfirmDialog
        open={!!deleting}
        title="Delete this job?"
        message={deleting ? `Delete "${displayName(deleting.name)}" on ${deleting.node.name}? It stops running, and this cannot be undone.` : ''}
        loading={deleteBusy}
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
      <AddJobDrawer open={addOpen} nodes={nodeList} skills={skills.data?.data ?? []} onClose={() => setAddOpen(false)} onCreated={() => void jobs.refresh()} />
    </div>
  );
}
