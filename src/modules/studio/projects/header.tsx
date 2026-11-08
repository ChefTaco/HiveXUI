import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArchiveRestore, ChevronsUpDown, FolderOpen, Plus, Search } from 'lucide-react';
import { Badge, Button, ConfirmDialog, Drawer } from '@ui';
import { errorMessage } from '../../magnus/api/errors';
import { useMagnusResource } from '../../magnus/api/use-resource';
import { LoadingRows, ResourceError } from '../../magnus/ui/resource-state';
import { idempotencyKey, StudioApiError } from '../api/client';
import { archiveProject, listProjects, reopenProject } from '../api/endpoints';
import { StudioLink } from '../link';
import { STUDIO_PREFIX } from '../paths';
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
  const name = state.snapshot?.project.name ?? (state.status === 'missing' ? 'Project not found' : projectId);

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
        aria-label={`Project ${name}. Switch project`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="studio-switcher__label stat-label">Project</span>
        <span className="studio-switcher__name">{name}</span>
        {state.snapshot?.project.status === 'archived' ? <Badge tone="neutral">Archived</Badge> : null}
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
            <StudioLink href={STUDIO_PREFIX} className="btn btn--ghost btn--sm no-underline" onClick={() => setOpen(false)}>
              <FolderOpen className="btn-ico" aria-hidden="true" />
              All projects
            </StudioLink>
            <StudioLink href={`${STUDIO_PREFIX}/new`} className="btn btn--sm no-underline" onClick={() => setOpen(false)}>
              <Plus className="btn-ico" aria-hidden="true" />
              New project
            </StudioLink>
          </div>
        </div>
      ) : null}
    </div>
  );
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
  const project = state.snapshot?.project;
  if (!project) return null;
  const archived = project.status === 'archived';
  const references = state.snapshot!.files.filter((file) => file.purpose === 'reference');
  const links = state.snapshot!.links;
  const count = references.length + links.length;
  const failed = [...references.map((file) => file.knowledge), ...links.map((link) => link.knowledge)].filter((knowledge) => knowledge.state === 'failed').length;

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
      <Button size="sm" variant="ghost" onClick={() => setFiles(true)} aria-label={`Files and links, ${count}${failed ? `, ${failed} failed` : ''}`}>
        Files
        <span className="tab-count">{count}</span>
        {failed ? <Badge tone="danger">{failed} failed</Badge> : null}
      </Button>
      <Button size="sm" variant="ghost" icon={archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />} onClick={() => setConfirm(true)}>
        <span className="studio-tool-label">{archived ? 'Reopen' : 'Archive'}</span>
      </Button>
      {/* The top bar's backdrop filter would hold fixed overlays inside it; they render on the body. */}
      {createPortal(
        <>
          <Drawer open={files} title="Files and links" eyebrow={project.name} onClose={() => setFiles(false)}>
            <section className="studio-drawer-section" aria-labelledby="studio-files-heading">
              <h4 id="studio-files-heading" className="studio-drawer-section__title stat-label">Files</h4>
              <ReferenceManager store={store} files={state.snapshot!.files} readOnly={archived} />
            </section>
            <section className="studio-drawer-section" aria-labelledby="studio-links-heading">
              <h4 id="studio-links-heading" className="studio-drawer-section__title stat-label">Links</h4>
              <LinkManager store={store} links={links} readOnly={archived} />
            </section>
          </Drawer>
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
