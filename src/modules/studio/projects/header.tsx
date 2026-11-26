import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArchiveRestore, ChevronsUpDown, DatabaseZap, FolderOpen, Plus, Search, Trash2, Users } from 'lucide-react';
import { Badge, Button, ConfirmDialog, Drawer, Field, LoadingRows, ResourceError, TextInput, buttonClass } from '@ui';
import { errorMessage } from '../../magnus/api/errors';
import { useMagnusResource } from '../../magnus/api/use-resource';
import { idempotencyKey, StudioApiError } from '../api/client';
import { archiveProject, listProjects, purgeProject, reindexProject, reopenProject } from '../api/endpoints';
import { MembersDrawer } from './members';
import { StudioLink } from '../link';
import { goStudio, STUDIO_PREFIX } from '../paths';
import { projectHref } from '../routes';
import { useProject } from '../state/project-store';
import { LinkManager } from './links';
import { ReferenceManager } from './references';

/** The current project's name, and a menu of the others. */
export function ProjectSwitcher({ projectId }: { projectId: string }) {
  const { state } = useProject(projectId);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const projects = useMagnusResource((signal) => listProjects({ status: 'active' }, signal), [], { enabled: open });
  const name = state.snapshot?.project.name ?? (state.status === 'purged' ? 'Project purged' : state.status === 'missing' ? 'Project not found' : projectId);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    root.current?.addEventListener('keydown', key);
    const element = root.current;
    return () => {
      document.removeEventListener('pointerdown', outside);
      element?.removeEventListener('keydown', key);
    };
  }, [open]);

  const needle = filter.trim().toLowerCase();
  const shown = (projects.data ?? []).filter((project) => !needle || project.name.toLowerCase().includes(needle)).slice(0, 12);

  return (
    <div ref={root} className="studio-switcher-wrap">
      <button
        ref={button}
        type="button"
        className="studio-switcher rounded-control border border-border bg-surface px-2 py-1 text-sm text-text hover:border-accent"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="studio-switcher__label stat-label">Project</span>
        <span className="studio-switcher__name">{name}</span>
        {state.snapshot?.project.status === 'archived' ? <Badge tone="neutral">Archived</Badge> : null}
        <span className="sr-only">. Switch project</span>
        <ChevronsUpDown className="size-4 text-text-muted" aria-hidden="true" />
      </button>
      {open ? (
        <div id={menuId} role="dialog" aria-label="Switch project" className="studio-popover panel panel--sm">
          <label className="studio-search">
            <Search className="studio-search__icon size-4 text-text-muted" aria-hidden="true" />
            <span className="sr-only">Find a project</span>
            {/* The menu opens on request, so focus goes to its search box. */}
            <input type="search" autoFocus value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Find a project" />
          </label>
          {projects.data ? (
            shown.length ? (
              <ul className="studio-menu" aria-label="Projects">
                {shown.map((project) => (
                  <li key={project.id}>
                    <StudioLink href={projectHref(project.id)} className="studio-menu__item rounded-control text-text no-underline hover:bg-surface-hover aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent" aria-current={project.id === projectId ? 'page' : undefined} onClick={() => setOpen(false)}>
                      <span className="studio-menu__name">{project.name}</span>
                      <span className="text-xs text-text-muted">{project.team.role_count} roles</span>
                    </StudioLink>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-sm text-text-muted">No active project matches.</p>
            )
          ) : projects.loading ? (
            <LoadingRows rows={3} />
          ) : (
            <ResourceError error={projects.error} title="Projects could not be loaded" onRetry={() => void projects.refresh()} />
          )}
          <div className="studio-menu__foot">
            <StudioLink href={STUDIO_PREFIX} className={buttonClass({ variant: 'ghost', size: 'sm', className: 'no-underline' })} onClick={() => setOpen(false)}>
              <FolderOpen className="btn-ico" aria-hidden="true" />
              All projects
            </StudioLink>
            <StudioLink href={`${STUDIO_PREFIX}/new`} className={buttonClass({ size: 'sm', className: 'no-underline' })} onClick={() => setOpen(false)}>
              <Plus className="btn-ico" aria-hidden="true" />
              New project
            </StudioLink>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Queues every reference file and link for HiveMem sync again, for example after a backup was
 * restored (the ArdentStudio release after 0.5.1). Each row's state then follows the project stream.
 */
export function ProjectReindex({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const queued = await reindexProject(projectId, idempotencyKey());
      setResult({ tone: 'success', text: `Queued ${queued.files} ${queued.files === 1 ? 'file' : 'files'} and ${queued.links} ${queued.links === 1 ? 'link' : 'links'} for indexing again.` });
    } catch (error) {
      setResult({ tone: 'danger', text: errorMessage(error, 'The project could not be queued for indexing again') });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="studio-drawer-section">
      <Button size="sm" icon={<DatabaseZap className="size-4" />} loading={busy} onClick={() => void run()}>
        Reindex project
      </Button>
      <p className="m-0 text-xs text-text-muted">Sends every file and link to HiveMem again, for example after restoring a backup.</p>
      {result ? <p role={result.tone === 'danger' ? 'alert' : 'status'} className={`m-0 text-sm ${result.tone === 'danger' ? 'text-danger' : 'text-success'}`}>{result.text}</p> : null}
    </div>
  );
}

/** Why Studio refused a purge, in words. */
export function purgeRefusal(error: unknown): string {
  if (error instanceof StudioApiError) {
    if (error.code === 'PROJECT_NOT_ARCHIVED') return 'Only an archived project can be purged. Archive it first.';
    if (error.code === 'TASKS_ACTIVE') return 'Tasks of this project are still running. Cancel them first:';
    if (error.code === 'CONFIRMATION_MISMATCH') return 'The name you typed is not the project’s exact name. Nothing was purged.';
    if (error.code === 'FILE_IN_USE') {
      const agents = (error.details as { agents?: unknown } | null)?.agents;
      const names = Array.isArray(agents) ? agents.filter((item): item is string => typeof item === 'string') : [];
      return `An agent portrait uses one of this project’s files${names.length ? ` (${names.join(', ')})` : ''}. Choose another portrait for ${names.length === 1 ? 'that agent' : 'those agents'} first.`;
    }
    if (error.status === 403) return 'Purging a project needs the Studio administrator permission (ardentstudio:agents:admin).';
  }
  return errorMessage(error, 'The project could not be purged');
}

interface ActiveTask {
  id?: string;
  title?: string;
}
const activeTasks = (details: unknown): ActiveTask[] => {
  const tasks = details && typeof details === 'object' && 'tasks' in details ? (details as { tasks: unknown }).tasks : null;
  return Array.isArray(tasks) ? tasks.filter((task): task is ActiveTask => Boolean(task) && typeof task === 'object') : [];
};

/** Files and archive or reopen, beside the project's area tabs. */
export function ProjectTools({ projectId }: { projectId: string }) {
  const { state, store } = useProject(projectId);
  const [files, setFiles] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; tasks: ActiveTask[] } | null>(null);
  const [members, setMembers] = useState(false);
  const [purging, setPurging] = useState(false);
  const [typed, setTyped] = useState('');
  const project = state.snapshot?.project;
  if (!project) return null;
  const archived = project.status === 'archived';
  const references = state.snapshot!.files.filter((file) => file.purpose === 'reference');
  const links = state.snapshot!.links;
  const count = references.length + links.length;
  const failed = [...references.map((file) => file.knowledge), ...links.map((link) => link.knowledge)].filter((knowledge) => knowledge.state === 'failed').length;
  // Owners manage members; a Studio administrator is an owner of every project. Purging also needs
  // the administrator permission, which only Studio checks: a non-admin owner gets its refusal.
  const owner = state.snapshot!.summary.access?.role === 'owner';

  async function purge() {
    if (!project) return;
    setBusy(true);
    setFailure(null);
    try {
      await purgeProject(projectId, typed, idempotencyKey());
      setPurging(false);
      goStudio(STUDIO_PREFIX, 'replace');
    } catch (error) {
      setPurging(false);
      setFailure({ message: purgeRefusal(error), tasks: error instanceof StudioApiError && error.code === 'TASKS_ACTIVE' ? activeTasks(error.details) : [] });
    } finally {
      setBusy(false);
      setTyped('');
    }
  }

  async function toggleArchive() {
    setBusy(true);
    setFailure(null);
    try {
      store.setProject(archived ? await reopenProject(projectId, idempotencyKey()) : await archiveProject(projectId, idempotencyKey()));
      setConfirm(false);
    } catch (error) {
      setConfirm(false);
      setFailure({ message: errorMessage(error, archived ? 'The project could not be reopened' : 'The project could not be archived'), tasks: error instanceof StudioApiError ? activeTasks(error.details) : [] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="studio-project__tools">
      {/* The visible words start the accessible name (WCAG 2.5.3); the rest is for screen readers. */}
      <Button size="sm" variant="ghost" onClick={() => setFiles(true)}>
        Files<span className="sr-only"> and links,</span>{' '}
        <span className="tab-count">{count}</span>
        {failed ? <Badge tone="danger">{failed} failed</Badge> : null}
      </Button>
      {owner ? (
        <Button size="sm" variant="ghost" icon={<Users className="size-4" />} onClick={() => setMembers(true)}>
          <span className="studio-tool-label">Members</span>
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" icon={archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />} onClick={() => setConfirm(true)}>
        <span className="studio-tool-label">{archived ? 'Reopen' : 'Archive'}</span>
      </Button>
      {archived && owner ? (
        <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setPurging(true)}>
          <span className="studio-tool-label">Purge</span>
        </Button>
      ) : null}
      {/* The top bar's backdrop filter would hold fixed overlays inside it; they render on the body. */}
      {createPortal(
        <>
          <Drawer open={files} title="Files and links" eyebrow={project.name} onClose={() => setFiles(false)}>
            {archived ? null : <ProjectReindex projectId={projectId} />}
            <section className="studio-drawer-section" aria-labelledby="studio-files-heading">
              <h4 id="studio-files-heading" className="studio-drawer-section__title stat-label">Files</h4>
              <ReferenceManager store={store} files={state.snapshot!.files} readOnly={archived} />
            </section>
            <section className="studio-drawer-section" aria-labelledby="studio-links-heading">
              <h4 id="studio-links-heading" className="studio-drawer-section__title stat-label">Links</h4>
              <LinkManager store={store} links={links} readOnly={archived} />
            </section>
          </Drawer>
          <MembersDrawer projectId={projectId} projectName={project.name} open={members} onClose={() => setMembers(false)} onSaved={() => void store.refetch()} />
          <ConfirmDialog
            open={purging}
            title={`Purge ${project.name} for good?`}
            message="Its events, files, links, team, room, tasks, workflow runs, deliverables, reviews and exports are deleted and cannot be restored. Its references leave HiveMem; audit records are kept. Type the project's name to confirm."
            confirmLabel="Purge project"
            loading={busy}
            confirmDisabled={typed !== project.name}
            onCancel={() => {
              setPurging(false);
              setTyped('');
            }}
            onConfirm={() => void purge()}
          >
            <Field label="Project name">
              <TextInput value={typed} onChange={setTyped} autoComplete="off" spellCheck={false} />
            </Field>
          </ConfirmDialog>
          <ConfirmDialog
            open={confirm}
            title={archived ? `Reopen ${project.name}?` : `Archive ${project.name}?`}
            message={archived ? 'The project becomes editable again, with its team, references and history as they were.' : 'The project becomes read-only. Running tasks must be cancelled first. You can reopen it later.'}
            confirmLabel={archived ? 'Reopen' : 'Archive'}
            tone={archived ? 'primary' : 'warning'}
            loading={busy}
            onCancel={() => setConfirm(false)}
            onConfirm={() => void toggleArchive()}
          />
        </>,
        document.body,
      )}
      {failure ? (
        <div role="alert" className="studio-tool-error warning-banner text-sm">
          <span>{failure.message}</span>
          {failure.tasks.length ? (
            <ul className="m-0">
              {failure.tasks.map((task, index) => (
                <li key={task.id ?? index}>{task.title ?? task.id ?? 'Task'}</li>
              ))}
            </ul>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setFailure(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  );
}
