import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Archive, ArchiveRestore, ArrowLeft, Copy, Library, PencilLine, Play, Search, Users } from 'lucide-react';
import { Badge, Button, ConfirmDialog, EmptyState, PageHeader, Panel, Select, Skeleton, Toggle } from '@ui';
import { cn } from '@lib/cn';
import { formatTime } from '@lib/format';
import { useToast } from '../../../components/toast';
import { errorMessage } from '../../magnus/api/errors';
import { useMagnusResource } from '../../magnus/api/use-resource';
import { LoadingRows, ResourceError } from '../../magnus/ui/resource-state';
import { idempotencyKey, StudioApiError } from '../api/client';
import { applyTemplate, archiveTemplate, getTemplate, getTemplateVersion, listTemplates, type TemplateDetail, type TemplateSummary, type TemplateVersion } from '../api/endpoints';
import { setStudioQuery, StudioLink, useStudioSearch } from '../link';
import { goStudio, STUDIO_PREFIX } from '../paths';
import { projectHref } from '../routes';
import { useOptionalProject } from '../state/project-store';
import { RELATIONSHIP_LABEL, STAGE_LABEL, type TeamDraft } from '../team/model';
import '../team/team.css';
import { roleFromTemplate } from './diff';
import { galleryHref, parseTemplateParam, type GalleryKind } from './links';
import { TemplateEditor } from './template-editor';

const TeamCanvas = lazy(() => import('../team/canvas/team-canvas'));
const SEARCH_DELAY_MS = 250;
const INTEGRATION_LABEL: Record<string, string> = { hivemem: 'HiveMem', hiveskills: 'HiveSkills', emberpath: 'Emberpath' };
const BACKEND_LABEL: Record<string, string> = { any: 'any backend', llamacpp: 'llama.cpp', codex: 'Codex' };

function TemplateCard({ template, href }: { template: TemplateSummary; href: string }) {
  return (
    <li className="studio-card panel panel--sm glow-hover--accent">
      <div className="studio-card__head">
        <h3 className="studio-card__title">
          <StudioLink href={href} className="studio-card__link text-text-strong no-underline hover:text-accent">
            {template.name}
          </StudioLink>
        </h3>
        <Badge tone="neutral">{template.source === 'seed' ? 'Seed' : 'Mine'}</Badge>
      </div>
      <p className="studio-card__brief text-sm text-text-muted">{template.purpose || 'No description.'}</p>
      <div className="studio-card__foot text-xs text-text-muted">
        <span>
          {template.category} · v{template.latest_version}
          {template.used_by ? ` · used by ${template.used_by} ${template.used_by === 1 ? 'project' : 'projects'}` : ''}
        </span>
        {template.archived ? <Badge tone="neutral">Archived</Badge> : null}
      </div>
    </li>
  );
}

/** A team template's roles drawn as a small read-only canvas, with a list for screen readers. */
function MiniTeam({ body }: { body: Extract<TemplateVersion, { kind: 'team' }>['body'] }) {
  const draft: TeamDraft = useMemo(() => ({ roles: body.roles.map(roleFromTemplate), relationships: body.relationships, stages: body.stages }), [body]);
  const empty = useMemo(() => new Map(), []);
  return (
    <>
      <div aria-hidden="true">
        <Suspense fallback={<Skeleton className="h-40" />}>
          <TeamCanvas mini label="Team template diagram" draft={draft} positions={{}} agents={empty} creating={new Set()} issues={empty} selected={null} readOnly />
        </Suspense>
      </div>
      <ul className="studio-template-roles" aria-label="Roles">
        {body.roles.map((role) => (
          <li key={role.key}>
            <span className="cell-strong">
              {role.name}
              {role.coordinator ? <Badge tone="signal">Coordinator</Badge> : null}
            </span>
            <span className="text-sm text-text-muted">{role.responsibilities_md || 'No responsibilities written.'}</span>
            <span className="text-xs text-text-muted">
              {role.stage ? `${STAGE_LABEL[role.stage]} stage` : 'No stage'}
              {body.relationships.filter((edge) => edge.from === role.key).map((edge) => ` · ${RELATIONSHIP_LABEL[edge.type]} ${body.roles.find((item) => item.key === edge.to)?.name ?? edge.to}`).join('')}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Detail({ id, version, projectId, onBack }: { id: string; version: number | null; projectId: string | undefined; onBack: string }) {
  const toast = useToast();
  const detail = useMagnusResource((signal) => getTemplate(id, signal), [id]);
  const viewing = version && detail.data && version !== detail.data.latest.version ? version : null;
  const older = useMagnusResource((signal) => getTemplateVersion(id, viewing!, signal), [id, viewing], { enabled: viewing !== null });
  const body: TemplateVersion | undefined = viewing ? older.data : detail.data?.latest;
  const [editing, setEditing] = useState<'version' | 'variant' | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const project = useOptionalProject(projectId);
  const pinned = projectId ? (project.state.snapshot?.team.draft?.source_template ?? project.state.snapshot?.team.current?.source_template) : null;

  if (!detail.data) return detail.loading ? <Panel aria-busy="true"><LoadingRows rows={6} /></Panel> : <ResourceError error={detail.error} title="This template could not be loaded" onRetry={() => void detail.refresh()} />;
  const template = detail.data;
  if (!body) return older.loading ? <Panel aria-busy="true"><LoadingRows rows={6} /></Panel> : <ResourceError error={older.error} title={`Version ${viewing} could not be loaded`} onRetry={() => void older.refresh()} />;
  const archivedProject = project.state.snapshot?.project.status === 'archived';

  async function use(replaceDraft = false) {
    if (!projectId) {
      goStudio(`${STUDIO_PREFIX}/new?template=${encodeURIComponent(template.id)}`);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      project.store?.setTeam(await applyTemplate(projectId, template.id, body!.version, replaceDraft, idempotencyKey()));
      goStudio(projectHref(projectId, '/team'));
    } catch (error) {
      if (error instanceof StudioApiError && error.conflict && !replaceDraft) setReplace(true);
      else setFailure(errorMessage(error, 'The template could not be applied'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive() {
    setBusy(true);
    try {
      detail.setData(await archiveTemplate(template.id, !template.archived, idempotencyKey()));
      setArchiving(false);
    } catch (error) {
      setArchiving(false);
      setFailure(errorMessage(error, 'The template could not be changed'));
    } finally {
      setBusy(false);
    }
  }

  const skills = body.kind === 'team' ? [...new Map(body.body.roles.flatMap((role) => role.skills).map((skill) => [`${skill.kind}:${skill.ref}`, skill])).values()] : body.body.skills;
  const roleCount = body.kind === 'team' ? body.body.roles.length : 0;
  const templateRefs = body.kind === 'team' ? body.body.roles.filter((role) => role.agent_template_ref).length : 0;

  return (
    <div className="page-stack">
      <div>
        <StudioLink href={onBack} className="btn btn--ghost btn--sm no-underline">
          <ArrowLeft className="btn-ico" aria-hidden="true" />
          All templates
        </StudioLink>
      </div>
      <PageHeader
        eyebrow={template.kind === 'team' ? 'Team template' : 'Agent template'}
        title={body.body.name}
        status={
          <span className="studio-revision">
            <Badge tone="neutral">{template.source === 'seed' ? 'Seed' : 'Mine'}</Badge>
            <Badge tone={viewing ? 'warning' : 'info'}>v{body.version}{viewing ? ` of ${template.latest_version}` : ''}</Badge>
            {template.archived ? <Badge tone="neutral">Archived</Badge> : null}
          </span>
        }
        description={body.body.purpose || undefined}
        actions={
          <>
            {template.kind === 'team' && !template.archived ? (
              <Button variant="primary" icon={<Play className="size-4" />} loading={busy} disabled={archivedProject} onClick={() => void use()}>
                {projectId ? 'Use in project' : 'Use in a new project'}
              </Button>
            ) : null}
            <Button icon={<PencilLine className="size-4" />} disabled={template.archived} onClick={() => setEditing('version')}>
              Customize
            </Button>
            <Button icon={<Copy className="size-4" />} onClick={() => setEditing('variant')}>
              Duplicate as variant
            </Button>
            <Button variant="ghost" icon={template.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />} onClick={() => setArchiving(true)}>
              {template.archived ? 'Unarchive' : 'Archive'}
            </Button>
          </>
        }
      />
      {failure ? <p role="alert" className="m-0 text-sm text-danger">{failure}</p> : null}
      {pinned && pinned.template_id === template.id ? (
        <p className="info-banner m-0 text-sm" role="status">
          This project uses version {pinned.version}.
          {pinned.version < template.latest_version ? (
            <>
              {' '}Version {template.latest_version} is available: <StudioLink href={projectHref(projectId!, '/team')}>review its changes in Team Assignment</StudioLink>.
            </>
          ) : null}
        </p>
      ) : null}
      <div className="studio-template-grid">
        <div className="page-stack">
          {body.kind === 'team' ? (
            <Panel title={`Team · ${roleCount} roles`} description={body.body.stages.length ? `Stages: ${body.body.stages.map((stage) => STAGE_LABEL[stage]).join(' → ')}` : 'No stages'}>
              <MiniTeam body={body.body} />
            </Panel>
          ) : (
            <Panel title="Persona">
              <h4 className="stat-label m-0">SOUL.md</h4>
              <pre className="code-block studio-excerpt">{body.body.soul_md.slice(0, 1200) || '—'}</pre>
              <h4 className="stat-label m-0">IDENTITY.md</h4>
              <pre className="code-block studio-excerpt">{body.body.identity_md.slice(0, 1200) || '—'}</pre>
            </Panel>
          )}
          {body.body.example_uses.length ? (
            <Panel title="Example uses">
              <ul className="m-0 text-sm">
                {body.body.example_uses.map((use) => (
                  <li key={use}>{use}</li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
        <div className="page-stack">
          <Panel title="What will happen">
            <p className="m-0 text-sm">
              {template.kind === 'team'
                ? `Using it ${projectId ? "replaces this project's team draft" : 'starts a new project'} with ${roleCount} roles, their relationships and stages. No agent is created or changed: you bind each role to an existing agent, or create one with New agent.${templateRefs ? ` ${templateRefs} ${templateRefs === 1 ? 'role names an agent template' : 'roles name agent templates'} that New agent can start from.` : ''}`
                : 'New agent can start from this persona: Magnus creates a new Ardent profile with it. Existing agents are never changed.'}
            </p>
          </Panel>
          <Panel title="Requirements">
            <dl className="kv-list text-sm">
              <div className="kv-row">
                <dt>Ardent</dt>
                <dd>{body.body.runtime_req.ardent ?? 'any version'}, {BACKEND_LABEL[body.body.runtime_req.backend] ?? body.body.runtime_req.backend}</dd>
              </div>
              <div className="kv-row">
                <dt>Integrations</dt>
                <dd>{body.body.integrations.length ? body.body.integrations.map((name) => INTEGRATION_LABEL[name] ?? name).join(', ') : 'None'}</dd>
              </div>
              {body.kind === 'agent' ? (
                <div className="kv-row">
                  <dt>Model hint</dt>
                  <dd>{body.body.model_hint ?? 'None'}</dd>
                </div>
              ) : null}
              <div className="kv-row">
                <dt>Skills</dt>
                <dd>
                  {skills.length ? (
                    <span className="role-chip-list">
                      {skills.map((skill) => (
                        <span key={`${skill.kind}:${skill.ref}`} className="tag" title={skill.kind === 'hiveskills' ? 'HiveSkills catalog' : 'Local skill'}>
                          {skill.kind === 'hiveskills' ? 'HiveSkills · ' : ''}
                          {skill.ref}
                        </span>
                      ))}
                    </span>
                  ) : (
                    'None'
                  )}
                </dd>
              </div>
              {body.kind === 'agent' && body.body.expected_outputs.length ? (
                <div className="kv-row">
                  <dt>Outputs</dt>
                  <dd>{body.body.expected_outputs.join(', ')}</dd>
                </div>
              ) : null}
            </dl>
          </Panel>
          <Panel title="Versions" description={template.used_by ? `Used by ${template.used_by} ${template.used_by === 1 ? 'project' : 'projects'}` : 'Not used by any project yet'}>
            <ol className="studio-versions">
              {template.versions.map((item) => {
                const current = item.version === body.version;
                return (
                  <li key={item.version}>
                    <StudioLink
                      href={galleryHref({ projectId, kind: template.kind === 'agent' ? 'agents' : 'teams', template: template.id, version: item.version === template.latest_version ? undefined : item.version })}
                      className={cn('studio-version rounded-control no-underline', current ? 'bg-accent-soft text-accent' : 'text-text hover:bg-surface-hover')}
                      aria-current={current ? 'page' : undefined}
                    >
                      <span className="cell-strong num">v{item.version}</span>
                      <span className="text-sm">{item.changelog}</span>
                      <span className="text-xs text-text-muted">
                        {formatTime(item.created_at)} · {item.created_by}
                        {item.version === template.latest_version ? ' · latest' : ''}
                      </span>
                    </StudioLink>
                  </li>
                );
              })}
            </ol>
          </Panel>
        </div>
      </div>
      {editing ? (
        <TemplateEditor
          template={template}
          base={body}
          mode={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            toast.success(editing === 'version' ? `Saved ${saved.name} v${saved.latest_version}` : `Saved ${saved.name}`);
            if (saved.id === template.id) detail.setData(saved);
            goStudio(galleryHref({ projectId, kind: saved.kind === 'agent' ? 'agents' : 'teams', template: saved.id }));
          }}
        />
      ) : null}
      <ConfirmDialog
        open={archiving}
        title={template.archived ? `Unarchive ${template.name}?` : `Archive ${template.name}?`}
        message={template.archived ? 'It is listed in the Gallery again.' : 'It leaves the Gallery list. Projects that use it keep their pinned version.'}
        confirmLabel={template.archived ? 'Unarchive' : 'Archive'}
        tone={template.archived ? 'primary' : 'warning'}
        loading={busy}
        onCancel={() => setArchiving(false)}
        onConfirm={() => void toggleArchive()}
      />
      <ConfirmDialog
        open={replace}
        title="Replace the team draft?"
        message="This project already has an unpublished team draft. Using the template replaces it; the published team is unchanged until you publish."
        confirmLabel="Replace draft"
        tone="warning"
        loading={busy}
        onCancel={() => setReplace(false)}
        onConfirm={() => {
          setReplace(false);
          void use(true);
        }}
      />
    </div>
  );
}

/** Gallery: team and agent templates, with versions; inside a project it applies templates to that project's team. */
export function Gallery({ projectId }: { projectId?: string }) {
  const search = useStudioSearch();
  const kind: GalleryKind = search.get('kind') === 'agents' ? 'agents' : 'teams';
  const source = search.get('source') === 'seed' || search.get('source') === 'user' ? (search.get('source') as 'seed' | 'user') : null;
  const archived = search.get('archived') === '1';
  const category = search.get('category') ?? '';
  const query = search.get('q') ?? '';
  const selected = parseTemplateParam(search.get('template'));
  const [text, setText] = useState(query);
  useEffect(() => {
    if (text === query) return;
    const timer = setTimeout(() => setStudioQuery({ q: text.trim() || null }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, query]);
  const templates = useMagnusResource(
    (signal) => listTemplates({ kind: kind === 'agents' ? 'agent' : 'team', archived: archived ? 'all' : 'false', ...(source ? { source } : {}), ...(query ? { q: query } : {}) }, signal),
    [kind, archived, source, query],
    { enabled: !selected },
  );
  const categories = useMemo(() => [...new Set((templates.data ?? []).map((item) => item.category))].sort(), [templates.data]);
  const shown = (templates.data ?? []).filter((item) => !category || item.category === category);
  const back = galleryHref({ projectId, kind });

  if (selected) return <Detail id={selected.id} version={selected.version} projectId={projectId} onBack={back} />;
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Ardent Project Studio"
        title="Gallery"
        description={projectId ? 'Templates to start or update this project’s team. Projects pin the version they use and never update by themselves.' : 'Reusable team and agent templates, with their versions.'}
        actions={
          projectId ? (
            <StudioLink href={projectHref(projectId, '/team')} className="btn no-underline">
              <Users className="btn-ico" aria-hidden="true" />
              Back to the team
            </StudioLink>
          ) : undefined
        }
      />
      <div className="studio-toolbar">
        <div role="group" aria-label="Template kind" className="segmented-tabs">
          {(['teams', 'agents'] as const).map((option) => (
            <button key={option} type="button" aria-pressed={kind === option} className={cn('tab-button', kind === option && 'tab-button--active')} onClick={() => setStudioQuery({ kind: option === 'agents' ? 'agents' : null, category: null })}>
              {option === 'teams' ? 'Teams' : 'Agents'}
            </button>
          ))}
        </div>
        <label className="studio-search">
          <Search className="studio-search__icon size-4 text-text-muted" aria-hidden="true" />
          <span className="sr-only">Search templates</span>
          <input type="search" value={text} onChange={(event) => setText(event.target.value)} placeholder="Search templates" maxLength={200} />
        </label>
        <Select aria-label="Source" value={source ?? ''} onChange={(value) => setStudioQuery({ source: value || null })} options={[{ value: '', label: 'All sources' }, { value: 'seed', label: 'Seed' }, { value: 'user', label: 'Mine' }]} />
        <Select aria-label="Category" value={category} onChange={(value) => setStudioQuery({ category: value || null })} options={[{ value: '', label: 'All categories' }, ...categories.map((item) => ({ value: item, label: item }))]} />
        <Toggle checked={archived} onChange={(value) => setStudioQuery({ archived: value ? '1' : null })} label="Show archived" />
      </div>
      {templates.data ? (
        shown.length ? (
          <ul className="studio-cards" aria-label={kind === 'teams' ? 'Team templates' : 'Agent templates'}>
            {shown.map((template) => (
              <TemplateCard key={template.id} template={template} href={galleryHref({ projectId, kind, template: template.id })} />
            ))}
          </ul>
        ) : (
          <EmptyState
            framed
            icon={<Library className="size-6" />}
            title={query || category || source ? 'No templates match' : kind === 'teams' ? 'No team templates' : 'No agent templates'}
            message={query || category || source ? 'Clear the filters to see every template.' : kind === 'teams' ? 'Save a project’s team as a template from Team Assignment.' : 'Save a role as an agent template from its inspector.'}
          />
        )
      ) : templates.loading ? (
        <LoadingRows rows={4} />
      ) : (
        <ResourceError error={templates.error} title="Templates could not be loaded" onRetry={() => void templates.refresh()} />
      )}
    </div>
  );
}
