import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, OctagonAlert } from 'lucide-react';
import { Badge, Button, ConfirmDialog, Drawer, EmptyState, Field, Panel, TextArea, TextInput } from '@ui';
import { cn } from '@lib/cn';
import { useToast } from '../../../components/toast';
import { errorMessage } from '../../magnus/api/errors';
import { useMagnusResource } from '../../magnus/api/use-resource';
import { LoadingRows, ResourceError } from '../../magnus/ui/resource-state';
import { idempotencyKey } from '../api/client';
import { createTemplate, getTemplate, getTemplateVersion, reassignTask, saveTeamAsTemplate, type Task, type ValidationResult } from '../api/endpoints';
import { applyChanges, templateDiff } from '../gallery/diff';
import { StudioLink } from '../link';
import { galleryHref } from '../gallery/links';
import type { Role, TeamDraft } from './model';

/** Every issue, errors first; choosing one selects its role. */
export function ValidationPanel({ validation, confirmed, names, onPick }: { validation: ValidationResult; confirmed: boolean; names: ReadonlyMap<string, string>; onPick: (key: string) => void }) {
  const issues = [...validation.issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  return (
    <section className="studio-validation panel panel--sm" aria-label="Validation">
      <div className="studio-validation__head">
        <h3 className="m-0 text-base">Validation</h3>
        <span className="text-xs text-text-muted" role="status">
          {confirmed ? 'Checked by the Studio service' : 'Checked here; the Studio service is checking…'}
        </span>
      </div>
      {issues.length ? (
        <ul className="studio-validation__list">
          {issues.map((issue, index) => {
            const Icon = issue.severity === 'error' ? OctagonAlert : AlertTriangle;
            const body = (
              <>
                <Icon className={cn('size-4 flex-none', issue.severity === 'error' ? 'text-danger' : 'text-warning')} aria-hidden="true" />
                <span>
                  <span className="sr-only">{issue.severity === 'error' ? 'Error: ' : 'Warning: '}</span>
                  {issue.message}
                </span>
              </>
            );
            return (
              <li key={`${issue.code}-${index}`}>
                {issue.role_key && names.has(issue.role_key) ? (
                  <button type="button" className="studio-validation__item hover:text-text-strong" onClick={() => onPick(issue.role_key!)}>
                    {body}
                  </button>
                ) : (
                  <span className="studio-validation__item">{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="studio-validation__item m-0 text-sm text-success">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          No issues.
        </p>
      )}
      {validation.agent_facts !== 'complete' ? <p className="m-0 text-xs text-text-muted">Agent skills and HiveMem could not all be checked through Magnus.</p> : null}
    </section>
  );
}

/** Save the team as a new template, or as a new version of the user template it came from. */
export function SaveTeamTemplate({ open, projectId, hasDraft, source, onClose }: { open: boolean; projectId: string; hasDraft: boolean; source: { template_id: string; version: number } | null; onClose: () => void }) {
  const toast = useToast();
  const origin = useMagnusResource((signal) => getTemplate(source!.template_id, signal), [source?.template_id], { enabled: open && Boolean(source) });
  const versionable = origin.data && origin.data.source === 'user' && !origin.data.archived ? origin.data : null;
  const [mode, setMode] = useState<'new' | 'version'>('new');
  const [chosen, setFrom] = useState<'draft' | 'current'>(hasDraft ? 'draft' : 'current');
  // The drawer stays mounted: once the draft is published there is only the published revision.
  const from = hasDraft ? chosen : 'current';
  const [name, setName] = useState('');
  const [category, setCategory] = useState('custom');
  const [purpose, setPurpose] = useState('');
  const [changelog, setChangelog] = useState('Saved from a project team');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (versionable && !name) {
      setName(versionable.name);
      setCategory(versionable.category);
      setPurpose(versionable.purpose);
    }
  }, [versionable, name]);

  async function submit() {
    setBusy(true);
    setFailure(null);
    try {
      const saved = await saveTeamAsTemplate(
        projectId,
        {
          from,
          name: name.trim(),
          category: category.trim() || 'custom',
          purpose,
          changelog: changelog.trim() || 'Saved from a project team',
          ...(mode === 'version' && versionable ? { template_id: versionable.id, base_version: versionable.latest_version } : {}),
        },
        idempotencyKey(),
      );
      toast.success(mode === 'version' ? `Saved ${saved.name} v${saved.latest_version}` : `Saved ${saved.name}`, 'Bindings and knowledge stay with the project.');
      onClose();
    } catch (error) {
      setFailure(errorMessage(error, 'The template could not be saved'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      title="Save team as template"
      eyebrow="Gallery"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void submit()}>
            {mode === 'version' ? 'Save new version' : 'Save template'}
          </Button>
        </>
      }
    >
      <p className="m-0 text-sm text-text-muted">Roles, relationships and stages are saved. Agent bindings and project knowledge are not.</p>
      {versionable ? (
        <fieldset className="studio-radio-row">
          <legend className="field-label">Save as</legend>
          <label className="check-field">
            <input type="radio" name="studio-save-mode" checked={mode === 'new'} onChange={() => setMode('new')} />
            A new template
          </label>
          <label className="check-field">
            <input type="radio" name="studio-save-mode" checked={mode === 'version'} onChange={() => setMode('version')} />
            Version {versionable.latest_version + 1} of {versionable.name}
          </label>
        </fieldset>
      ) : null}
      {hasDraft ? (
        <fieldset className="studio-radio-row">
          <legend className="field-label">Which team</legend>
          <label className="check-field">
            <input type="radio" name="studio-save-from" checked={from === 'draft'} onChange={() => setFrom('draft')} />
            The draft
          </label>
          <label className="check-field">
            <input type="radio" name="studio-save-from" checked={from === 'current'} onChange={() => setFrom('current')} />
            The published revision
          </label>
        </fieldset>
      ) : null}
      <Field label="Template name">
        <TextInput value={name} onChange={setName} maxLength={200} />
      </Field>
      <Field label="Category">
        <TextInput value={category} onChange={setCategory} maxLength={64} />
      </Field>
      <Field label="Purpose">
        <TextArea value={purpose} onChange={setPurpose} rows={3} maxLength={2000} />
      </Field>
      <Field label="Changelog">
        <TextInput value={changelog} onChange={setChangelog} maxLength={2000} />
      </Field>
      {failure ? <p role="alert" className="m-0 text-sm text-danger">{failure}</p> : null}
    </Drawer>
  );
}

/** A role's persona and instructions as a reusable agent template. */
export function SaveRoleTemplate({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(role?.name ?? '');
  const [purpose, setPurpose] = useState(role?.responsibilities_md.split('\n')[0] ?? '');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    setName(role?.name ?? '');
    setPurpose(role?.responsibilities_md.split('\n')[0]?.slice(0, 2000) ?? '');
    setFailure(null);
  }, [role]);
  if (!role) return null;

  async function submit() {
    if (!role) return;
    setBusy(true);
    setFailure(null);
    try {
      const saved = await createTemplate(
        {
          kind: 'agent',
          changelog: 'Saved from a project role',
          body: {
            name: name.trim(),
            category: 'custom',
            purpose,
            example_uses: [],
            soul_md: `# ${name.trim()}\n`,
            identity_md: `# Identity\n\nRole: ${name.trim()}\n\n## Responsibilities\n\n${role.responsibilities_md}\n\n## How I work\n\n${role.instructions_md}\n`,
            skills: role.skills.filter((skill) => skill.ref.trim()),
            model_hint: null,
            runtime_req: { ardent: null, backend: 'any' },
            integrations: ['hivemem'],
            expected_outputs: role.deliverables,
            avatar_preset: { preset: 'silhouette-a', accent: 'blue', emblem: 'star' },
          },
        },
        idempotencyKey(),
      );
      toast.success(`Saved agent template ${saved.name}`);
      onClose();
    } catch (error) {
      setFailure(errorMessage(error, 'The agent template could not be saved'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      title="Save role as agent template"
      eyebrow={role.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void submit()}>
            Save agent template
          </Button>
        </>
      }
    >
      <p className="m-0 text-sm text-text-muted">The role&apos;s responsibilities, instructions, skills and deliverables become a persona others can reuse. The bound agent is not part of it.</p>
      <Field label="Template name">
        <TextInput value={name} onChange={setName} maxLength={200} />
      </Field>
      <Field label="Purpose">
        <TextArea value={purpose} onChange={setPurpose} rows={3} maxLength={2000} />
      </Field>
      {failure ? <p role="alert" className="m-0 text-sm text-danger">{failure}</p> : null}
    </Drawer>
  );
}

/** Template updates: the newest version against the one the team pins, applied change by change to the draft. */
export function TemplateUpdate({
  open,
  source,
  latest,
  draft,
  onApply,
  onClose,
}: {
  open: boolean;
  source: { template_id: string; version: number };
  latest: number;
  draft: TeamDraft;
  onApply: (next: TeamDraft, version: number) => void;
  onClose: () => void;
}) {
  const versions = useMagnusResource(
    async (signal) => Promise.all([getTemplateVersion(source.template_id, source.version, signal), getTemplateVersion(source.template_id, latest, signal)]),
    [source.template_id, source.version, latest],
    { enabled: open },
  );
  const changes = useMemo(() => {
    const [before, after] = versions.data ?? [];
    return before?.kind === 'team' && after?.kind === 'team' ? templateDiff(before.body, after.body) : [];
  }, [versions.data]);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => setChosen(new Set(changes.map((change) => change.id))), [changes]);
  const toggle = (id: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Drawer
      open={open}
      title={`Update to version ${latest}`}
      eyebrow={`Pinned at version ${source.version}`}
      onClose={onClose}
      footer={
        <>
          <StudioLink href={galleryHref({ template: source.template_id })} className="btn btn--ghost no-underline">
            View template
          </StudioLink>
          <Button variant="primary" disabled={!chosen.size} onClick={() => onApply(applyChanges(draft, changes, chosen), latest)}>
            Apply {chosen.size} to draft
          </Button>
        </>
      }
    >
      <p className="m-0 text-sm text-text-muted">Choose the changes to bring into this project&apos;s draft. Nothing changes until you apply, and the published team stays as it is until you publish.</p>
      {versions.data ? (
        changes.length ? (
          <ul className="studio-diff">
            {changes.map((change) => (
              <li key={change.id} className="studio-diff__item rounded-control border border-border">
                <label className="check-field">
                  <input type="checkbox" checked={chosen.has(change.id)} onChange={(event) => toggle(change.id, event.target.checked)} />
                  <span className="cell-strong">{change.label}</span>
                </label>
                {change.before !== undefined || change.after !== undefined ? (
                  <dl className="studio-diff__values text-xs">
                    <dt className="text-text-muted">Before</dt>
                    <dd className="text-danger">{change.before}</dd>
                    <dt className="text-text-muted">After</dt>
                    <dd className="text-success">{change.after}</dd>
                  </dl>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact title="No differences" message="The two versions hold the same team." />
        )
      ) : versions.loading ? (
        <LoadingRows rows={4} />
      ) : (
        <ResourceError error={versions.error} title="The versions could not be compared" onRetry={() => void versions.refresh()} />
      )}
    </Drawer>
  );
}

const TASK_STATE: Record<Task['state'], { label: string; tone: 'info' | 'warning' | 'success' | 'danger' | 'neutral' }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'info' },
  input_required: { label: 'Needs an answer', tone: 'warning' },
  pausing: { label: 'Pausing', tone: 'warning' },
  paused: { label: 'Paused', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  partial: { label: 'Partial', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  unknown: { label: 'Unknown', tone: 'neutral' },
};

/** The revision a task works under, against the current one. */
export const revisionLine = (task: Pick<Task, 'assignment_revision'>, current: number | null): string | null =>
  task.assignment_revision === null ? null : current !== null && task.assignment_revision < current ? `Working under r${task.assignment_revision} (current r${current})` : `Working under r${task.assignment_revision}`;

/** Active work in this project and the team revision it runs under; Reassign moves stale work to the current revision. */
export function ActiveWork({ tasks, current, names, readOnly, onReassigned }: { tasks: readonly Task[]; current: number | null; names: ReadonlyMap<string, string>; readOnly: boolean; onReassigned: () => void }) {
  const [confirm, setConfirm] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (!tasks.length) return null;

  async function reassign(task: Task) {
    setBusy(true);
    setFailure(null);
    try {
      await reassignTask(task.id, task.role_key!, idempotencyKey());
      setConfirm(null);
      onReassigned();
    } catch (error) {
      setConfirm(null);
      setFailure(errorMessage(error, 'The task could not be reassigned'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Active work" description="Tasks keep the team revision they started under. Publishing a new revision does not change them.">
      <ul className="studio-tasks">
        {tasks.map((task) => {
          const stale = task.assignment_revision !== null && current !== null && task.assignment_revision < current;
          const state = TASK_STATE[task.state];
          return (
            <li key={task.id} className="studio-task">
              <span className="studio-task__main">
                <span className="cell-strong">{task.title}</span>
                <span className="text-xs text-text-muted">{task.role_key ? names.get(task.role_key) ?? task.role_key : 'No role'}</span>
              </span>
              <Badge tone={state.tone}>{state.label}</Badge>
              <span className={cn('text-xs', stale ? 'text-warning' : 'text-text-muted')}>{revisionLine(task, current)}</span>
              {stale && task.role_key && !readOnly ? (
                <Button size="sm" onClick={() => setConfirm(task)}>
                  Reassign
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {failure ? <p role="alert" className="m-0 text-sm text-danger">{failure}</p> : null}
      <ConfirmDialog
        open={confirm !== null}
        title={`Reassign ${confirm?.title ?? 'task'}?`}
        message={`This cancels the task and creates the same work for ${confirm?.role_key ? names.get(confirm.role_key) ?? confirm.role_key : 'its role'} under r${current ?? ''}, linked to the original.`}
        confirmLabel="Reassign"
        tone="warning"
        loading={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void reassign(confirm!)}
      />
    </Panel>
  );
}
