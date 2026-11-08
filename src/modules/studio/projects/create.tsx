import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, LayoutTemplate, Plus, Square, Trash2 } from 'lucide-react';
import { DELIVERABLE_FORMATS, STAGES } from '@contracts/ardentstudio.generated';
import { Badge, Button, ConfirmDialog, EmptyState, Field, IconButton, PageHeader, Panel, Select, TextArea, TextInput, Toggle } from '@ui';
import { cn } from '@lib/cn';
import { errorMessage } from '../../magnus/api/errors';
import { useMagnusResource } from '../../magnus/api/use-resource';
import { LoadingRows, ResourceError } from '../../magnus/ui/resource-state';
import { idempotencyKey, StudioApiError } from '../api/client';
import { applyTemplate, createProject, getProject, getTeam, listProjects, listTemplates, putTeamDraft, updateProject, type Project, type TemplateSummary } from '../api/endpoints';
import { goStudio } from '../paths';
import { setStudioQuery, StudioLink, useStudioSearch } from '../link';
import { projectHref } from '../routes';
import { useProject } from '../state/project-store';
import { STUDIO_PREFIX } from '../paths';
import { briefErrors, briefRequest, COMMON_FORMATS, emptyBrief, type BriefDraft, type DeliverableDraft, type DeliverableFormat, type Stage } from './logic';
import { ReferenceManager } from './references';

const STEPS = ['Brief', 'References', 'Starting team'] as const;
type Step = 1 | 2 | 3;

function Steps({ step, projectId }: { step: Step; projectId: string | null }) {
  return (
    <ol className="studio-steps" aria-label="Create project steps">
      {STEPS.map((label, index) => {
        const number = (index + 1) as Step;
        const state = number === step ? 'current' : number < step ? 'done' : 'todo';
        const reachable = projectId !== null || number === 1;
        return (
          <li key={label} className={cn('studio-step', state === 'current' ? 'text-accent' : state === 'done' ? 'text-text' : 'text-text-muted')} aria-current={state === 'current' ? 'step' : undefined}>
            {reachable && state !== 'current' ? (
              <button type="button" className="studio-step__button hover:text-text-strong" onClick={() => setStudioQuery({ step: number === 1 ? null : String(number) }, 'push')}>
                <span className={cn('studio-step__number num rounded-pill border', state === 'done' ? 'border-success text-success' : 'border-border-strong')} aria-hidden="true">{state === 'done' ? <Check className="size-4" /> : number}</span>
                {label}
              </button>
            ) : (
              <span className="studio-step__button">
                <span className={cn('studio-step__number num rounded-pill border', state === 'current' ? 'border-accent bg-accent-soft' : 'border-border-strong')} aria-hidden="true">{number}</span>
                {label}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const fromProject = (project: Project): BriefDraft => ({
  name: project.name,
  brief: project.brief_md,
  audience: project.audience ?? '',
  constraints: project.constraints.join('\n'),
  tags: project.tags.join(', '),
  deliverables: project.deliverables.map((item) => ({ name: item.name, kind: item.kind, formats: item.formats, stage: item.stage ?? '' })),
});

function DeliverableRow({ value, index, onChange, onRemove }: { value: DeliverableDraft; index: number; onChange: (next: DeliverableDraft) => void; onRemove: () => void }) {
  const [more, setMore] = useState(() => value.formats.some((format) => !COMMON_FORMATS.includes(format)));
  const formats = more ? DELIVERABLE_FORMATS : COMMON_FORMATS;
  const toggle = (format: DeliverableFormat) => onChange({ ...value, formats: value.formats.includes(format) ? value.formats.filter((item) => item !== format) : [...value.formats, format] });
  return (
    <li className="studio-deliverable rounded-panel border border-border bg-surface-sunken">
      <div className="form-grid">
        <Field label={`Deliverable ${index + 1} name`}>
          <TextInput value={value.name} onChange={(name) => onChange({ ...value, name })} maxLength={200} placeholder="Campaign book" />
        </Field>
        <Field label="Kind" hint="What it is, in a word or two">
          <TextInput value={value.kind} onChange={(kind) => onChange({ ...value, kind })} maxLength={64} placeholder="document, map, report" />
        </Field>
        <Field label="Stage" hint="Optional">
          <Select value={value.stage} onChange={(stage) => onChange({ ...value, stage: stage as Stage | '' })} options={[{ value: '', label: 'Any stage' }, ...STAGES.map((stage) => ({ value: stage, label: stage[0]!.toUpperCase() + stage.slice(1) }))]} />
        </Field>
      </div>
      <fieldset className="studio-formats">
        <legend className="field-label">Formats</legend>
        <div className="role-chip-list">
          {formats.map((format) => (
            <button key={format} type="button" aria-pressed={value.formats.includes(format)} className={cn('role-chip role-chip--button', value.formats.includes(format) && 'border-accent bg-accent-soft text-accent')} onClick={() => toggle(format)}>
              .{format}
            </button>
          ))}
          {more ? null : (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setMore(true)}>
              More formats
            </button>
          )}
        </div>
      </fieldset>
      <div className="studio-deliverable__remove">
        <IconButton type="button" label={`Remove deliverable ${index + 1}`} icon={<Trash2 className="size-4" />} onClick={onRemove} />
      </div>
    </li>
  );
}

function BriefStep({ project, onSaved }: { project: Project | null; onSaved: (project: Project) => void }) {
  const [draft, setDraft] = useState<BriefDraft>(() => (project ? fromProject(project) : emptyBrief()));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // One key per form: a resubmit after a lost answer cannot create a second project.
  const [key, setKey] = useState(idempotencyKey);
  const errors = briefErrors(draft);
  const set = <K extends keyof BriefDraft>(field: K, value: BriefDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setKey(idempotencyKey());
  };
  const archived = project?.status === 'archived';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length || archived) return;
    setSaving(true);
    setFailure(null);
    try {
      const body = briefRequest(draft);
      onSaved(project ? await updateProject(project.id, body, key) : await createProject(body, key));
    } catch (error) {
      setFailure(errorMessage(error, 'The project could not be saved'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="page-stack" onSubmit={(event) => void submit(event)} noValidate>
      <Panel title="Brief" description="What the team works on. Agents read the brief on their first turn, so write it for them.">
        <div className="studio-form">
          <Field label="Project name">
            <TextInput value={draft.name} onChange={(value) => set('name', value)} maxLength={200} required aria-invalid={touched && Boolean(errors.name)} placeholder="The Sunken Archive" />
          </Field>
          {touched && errors.name ? <p role="alert" className="m-0 text-sm text-danger">{errors.name}</p> : null}
          <Field label="Brief" hint="Markdown. Goals, tone, what done looks like.">
            <TextArea value={draft.brief} onChange={(value) => set('brief', value)} rows={8} maxLength={100_000} />
          </Field>
          <div className="form-grid">
            <Field label="Audience" hint="Optional">
              <TextInput value={draft.audience} onChange={(value) => set('audience', value)} maxLength={2000} />
            </Field>
            <Field label="Tags" hint="Comma separated">
              <TextInput value={draft.tags} onChange={(value) => set('tags', value)} />
            </Field>
          </div>
          <Field label="Constraints" hint="One per line">
            <TextArea value={draft.constraints} onChange={(value) => set('constraints', value)} rows={3} />
          </Field>
        </div>
      </Panel>
      <Panel
        title="Requested deliverables"
        description="What the team should hand you. Each deliverable needs a role that produces it before the team can be published."
        actions={
          <Button type="button" size="sm" icon={<Plus className="size-4" />} onClick={() => set('deliverables', [...draft.deliverables, { name: '', kind: '', formats: ['md'], stage: '' }])} disabled={draft.deliverables.length >= 50}>
            Add deliverable
          </Button>
        }
      >
        {draft.deliverables.length ? (
          <ul className="studio-deliverables">
            {draft.deliverables.map((item, index) => (
              <DeliverableRow
                key={index}
                value={item}
                index={index}
                onChange={(next) => set('deliverables', draft.deliverables.map((entry, at) => (at === index ? next : entry)))}
                onRemove={() => set('deliverables', draft.deliverables.filter((_, at) => at !== index))}
              />
            ))}
          </ul>
        ) : (
          <EmptyState compact title="No deliverables yet" message="Optional. You can add them now or later from the project." />
        )}
        {touched && errors.deliverables ? <p role="alert" className="m-0 text-sm text-danger">{errors.deliverables}</p> : null}
      </Panel>
      {failure ? <p role="alert" className="m-0 text-sm text-danger">{failure}</p> : null}
      {archived ? <p className="m-0 text-sm text-warning">This project is archived and read-only. Reopen it to change the brief.</p> : null}
      <div className="studio-form-actions">
        <StudioLink href={STUDIO_PREFIX} className="btn btn--ghost no-underline">
          Cancel
        </StudioLink>
        <Button type="submit" variant="primary" loading={saving} disabled={archived} icon={<ArrowRight className="size-4" />}>
          {project ? 'Save and continue' : 'Create and continue'}
        </Button>
      </div>
    </form>
  );
}

function ReferencesStep({ projectId }: { projectId: string }) {
  const { state, store } = useProject(projectId);
  const files = state.snapshot?.files ?? [];
  const pending = files.filter((file) => file.knowledge.state === 'pending' || file.knowledge.state === 'indexing').length;
  return (
    <div className="page-stack">
      <Panel title="References" description="Source material the team should know. Indexing continues in the background; you can move on while it runs.">
        {state.snapshot ? (
          <>
            {state.snapshot.project.hivemem.state !== 'ready' ? (
              <p className="m-0 text-sm text-warning" role="status">
                {state.snapshot.project.hivemem.state === 'failed'
                  ? `HiveMem unavailable: references are stored but not searchable by agents yet. ${state.snapshot.project.hivemem.error ?? ''}`
                  : 'The project’s HiveMem workspace is still being prepared. References are stored now and indexed when it is ready.'}
              </p>
            ) : null}
            <ReferenceManager store={store} files={files} readOnly={state.snapshot.project.status === 'archived'} />
          </>
        ) : state.status === 'loading' ? (
          <LoadingRows rows={3} />
        ) : (
          <ResourceError error={state.error} title="The project could not be loaded" onRetry={() => store.start()} />
        )}
      </Panel>
      <div className="studio-form-actions">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => setStudioQuery({ step: null }, 'push')}>
          Back
        </Button>
        {pending ? <span className="text-sm text-text-muted" role="status">{pending} indexing</span> : null}
        <Button variant="primary" icon={<ArrowRight className="size-4" />} onClick={() => setStudioQuery({ step: '3' }, 'push')}>
          Continue
        </Button>
      </div>
    </div>
  );
}

type Start = 'template' | 'copy' | 'blank';

function TemplateChoice({ template, selected, onSelect, name }: { template: TemplateSummary; selected: boolean; onSelect: () => void; name: string }) {
  return (
    <label className={cn('studio-choice rounded-panel border bg-surface', selected ? 'border-accent bg-accent-soft' : 'border-border hover:border-border-strong')}>
      <input type="radio" name={name} className="sr-only" checked={selected} onChange={onSelect} />
      <span className="studio-choice__head">
        <span className="cell-strong">{template.name}</span>
        <Badge tone="neutral">{template.source === 'seed' ? 'Seed' : 'Mine'}</Badge>
      </span>
      <span className="text-sm text-text-muted">{template.purpose || 'No description.'}</span>
      <span className="text-xs text-text-muted">
        {template.category} · v{template.latest_version}
        {template.used_by ? ` · used by ${template.used_by} ${template.used_by === 1 ? 'project' : 'projects'}` : ''}
      </span>
    </label>
  );
}

/** Applies the starting team, then opens Team Assignment. */
function StartingTeamStep({ projectId }: { projectId: string }) {
  const search = useStudioSearch();
  const [start, setStart] = useState<Start>('template');
  const [templateId, setTemplateId] = useState<string | null>(search.get('template'));
  const [sourceProject, setSourceProject] = useState('');
  const [keepBindings, setKeepBindings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const group = useId();
  const templates = useMagnusResource((signal) => listTemplates({ kind: 'team' }, signal), []);
  const projects = useMagnusResource((signal) => listProjects({ status: 'all' }, signal), [], { enabled: start === 'copy' });
  const others = useMemo(() => (projects.data ?? []).filter((project) => project.id !== projectId && project.team.role_count > 0), [projects.data, projectId]);
  useEffect(() => {
    if (!templateId && templates.data?.[0]) setTemplateId(templates.data[0].id);
  }, [templateId, templates.data]);

  const open = () => goStudio(projectHref(projectId, '/team?start=1'));

  async function apply(replace = false) {
    setBusy(true);
    setFailure(null);
    try {
      if (start === 'template') {
        const template = templates.data?.find((item) => item.id === templateId);
        if (!template) throw new Error('Choose a template.');
        await applyTemplate(projectId, template.id, template.latest_version, replace);
      } else if (start === 'copy') {
        if (!sourceProject) throw new Error('Choose a project to copy from.');
        const [source, target] = await Promise.all([getTeam(sourceProject), getTeam(projectId)]);
        const revision = source.current ?? source.draft;
        if (!revision) throw new Error('That project has no team to copy.');
        if (target.draft && !replace) {
          setConfirmReplace(true);
          return;
        }
        const body = revision.body;
        await putTeamDraft(projectId, {
          base_revision: target.current?.revision ?? null,
          body: {
            roles: body.roles.map(({ binding_id: _binding, knowledge: _knowledge, agent_ref, ...role }) => ({ ...role, agent_ref: keepBindings ? agent_ref : null, knowledge: [] })),
            relationships: body.relationships,
            stages: body.stages,
          },
        });
      }
      open();
    } catch (error) {
      if (error instanceof StudioApiError && error.conflict && start === 'template' && !replace) setConfirmReplace(true);
      else setFailure(errorMessage(error, 'The starting team could not be applied'));
    } finally {
      setBusy(false);
    }
  }

  const options: ReadonlyArray<{ value: Start; label: string; icon: typeof LayoutTemplate; text: string }> = [
    { value: 'template', label: 'From a template', icon: LayoutTemplate, text: 'Roles, relationships and stages from a team template. Bind agents next.' },
    { value: 'copy', label: 'Copy a project’s team', icon: Copy, text: 'The current team of another project. Knowledge is not copied.' },
    { value: 'blank', label: 'Blank', icon: Square, text: 'Start with no roles and design the team yourself.' },
  ];

  return (
    <div className="page-stack">
      <Panel title="Starting team" description="Pick where the team starts. Everything stays editable in Team Assignment.">
        <div role="radiogroup" aria-label="Starting team" className="studio-start-options">
          {options.map(({ value, label, icon: Icon, text }) => (
            <label key={value} className={cn('studio-choice rounded-panel border bg-surface', start === value ? 'border-accent bg-accent-soft' : 'border-border hover:border-border-strong')}>
              <input type="radio" name={`${group}-start`} className="sr-only" checked={start === value} onChange={() => setStart(value)} />
              <span className="studio-choice__head">
                <Icon className="size-4 text-accent" aria-hidden="true" />
                <span className="cell-strong">{label}</span>
              </span>
              <span className="text-sm text-text-muted">{text}</span>
            </label>
          ))}
        </div>
      </Panel>
      {start === 'template' ? (
        <Panel title="Team templates" description="Seed templates and the ones your organization saved. Each project pins the version it used.">
          {templates.data ? (
            templates.data.length ? (
              <div role="radiogroup" aria-label="Team template" className="studio-choices">
                {templates.data.map((template) => (
                  <TemplateChoice key={template.id} template={template} name={`${group}-template`} selected={template.id === templateId} onSelect={() => setTemplateId(template.id)} />
                ))}
              </div>
            ) : (
              <EmptyState compact title="No team templates" message="The Studio service has no team templates. Start blank, or save a team as a template later." />
            )
          ) : templates.loading ? (
            <LoadingRows rows={3} />
          ) : (
            <ResourceError error={templates.error} title="Templates could not be loaded" onRetry={() => void templates.refresh()} />
          )}
        </Panel>
      ) : start === 'copy' ? (
        <Panel title="Copy from a project">
          {projects.data ? (
            others.length ? (
              <div className="studio-form">
                <Field label="Project">
                  <Select value={sourceProject} onChange={setSourceProject} options={[{ value: '', label: 'Choose a project…' }, ...others.map((project) => ({ value: project.id, label: `${project.name} (${project.team.role_count} roles)` }))]} />
                </Field>
                <Toggle checked={keepBindings} onChange={setKeepBindings} label="Keep the same agents bound to each role" />
              </div>
            ) : (
              <EmptyState compact title="No other project has a team" message="Choose a template or start blank." />
            )
          ) : projects.loading ? (
            <LoadingRows rows={2} />
          ) : (
            <ResourceError error={projects.error} title="Projects could not be loaded" onRetry={() => void projects.refresh()} />
          )}
        </Panel>
      ) : null}
      {failure ? <p role="alert" className="m-0 text-sm text-danger">{failure}</p> : null}
      <div className="studio-form-actions">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => setStudioQuery({ step: '2' }, 'push')}>
          Back
        </Button>
        <Button variant="primary" loading={busy} icon={<ArrowRight className="size-4" />} onClick={() => (start === 'blank' ? open() : void apply())} disabled={(start === 'template' && !templateId) || (start === 'copy' && !sourceProject)}>
          Open Team Assignment
        </Button>
      </div>
      <ConfirmDialog
        open={confirmReplace}
        title="Replace the team draft?"
        message="This project already has an unpublished team draft. Applying the starting team replaces it."
        confirmLabel="Replace draft"
        tone="warning"
        loading={busy}
        onCancel={() => setConfirmReplace(false)}
        onConfirm={() => {
          setConfirmReplace(false);
          void apply(true);
        }}
      />
    </div>
  );
}

/** /studio/new: brief and deliverables, references, starting team. The project exists from step 1, so a refresh resumes. */
export function CreateProject() {
  const search = useStudioSearch();
  const projectId = search.get('project');
  const requested = Number(search.get('step') ?? 1);
  const step: Step = projectId && (requested === 2 || requested === 3) ? requested : 1;
  const project = useMagnusResource((signal) => (projectId ? getProject(projectId, signal) : Promise.resolve(null)), [projectId]);

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Ardent Project Studio" title={project.data ? project.data.name : 'New project'} description="Write the brief, add references and choose a starting team." />
      <Steps step={step} projectId={projectId} />
      {projectId && !project.data ? (
        project.loading ? (
          <Panel aria-busy="true">
            <LoadingRows rows={4} />
          </Panel>
        ) : (
          <ResourceError error={project.error} title="This project could not be loaded" onRetry={() => void project.refresh()} />
        )
      ) : step === 1 ? (
        <BriefStep
          key={project.data?.id ?? 'new'}
          project={project.data ?? null}
          onSaved={(saved) => {
            project.setData(saved);
            goStudio(`${STUDIO_PREFIX}/new?project=${encodeURIComponent(saved.id)}&step=2`, projectId ? 'push' : 'replace');
          }}
        />
      ) : step === 2 ? (
        <ReferencesStep projectId={projectId!} />
      ) : (
        <StartingTeamStep projectId={projectId!} />
      )}
    </div>
  );
}
