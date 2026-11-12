import { useEffect, type ReactNode } from 'react';
import { FolderX } from 'lucide-react';
import { EmptyState, Panel, LoadingRows, ResourceError, buttonClass } from '@ui';
import { StudioLink } from '../link';
import { goStudio, STUDIO_PREFIX } from '../paths';
import { areaHref, projectHref } from '../routes';
import { useProject, type ProjectState } from '../state/project-store';

/** Where /studio/p/:id leads: the last area recorded, else Room once the coordinator is bound, else Team. */
export function landingHref(projectId: string, snapshot: NonNullable<ProjectState['snapshot']>): string {
  const last = snapshot.project.last_area;
  if (last === 'review') return projectHref(projectId, '/review');
  if (last) return areaHref(last, projectId);
  const team = snapshot.team.current ?? snapshot.team.draft;
  const coordinator = team?.body.roles.find((role) => role.coordinator);
  return areaHref(coordinator?.agent_ref ? 'room' : 'team', projectId);
}

/** Loading, missing and failed states for any page of one project; children render once the snapshot is in. */
export function ProjectFrame({ projectId, children }: { projectId: string; children: (state: ProjectState & { snapshot: NonNullable<ProjectState['snapshot']> }) => ReactNode }) {
  const { state, store } = useProject(projectId);
  if (state.snapshot) return <>{children(state as ProjectState & { snapshot: NonNullable<ProjectState['snapshot']> })}</>;
  if (state.status === 'missing')
    return (
      <EmptyState
        framed
        icon={<FolderX className="size-6" />}
        title="Project not found"
        message="It may have been removed, or this address is mistyped."
        action={
          <StudioLink href={STUDIO_PREFIX} className={buttonClass({ className: 'no-underline' })}>
            All projects
          </StudioLink>
        }
      />
    );
  if (state.status === 'loading')
    return (
      <Panel aria-busy="true">
        <LoadingRows rows={4} />
      </Panel>
    );
  return <ResourceError error={state.error} title="The project could not be loaded" onRetry={() => store.start()} />;
}

/** /studio/p/:id opens the project's area once its snapshot says which. */
export function ProjectLanding({ projectId }: { projectId: string }) {
  const { state } = useProject(projectId);
  const target = state.snapshot ? landingHref(projectId, state.snapshot) : null;
  useEffect(() => {
    if (target) goStudio(target, 'replace');
  }, [target]);
  return <ProjectFrame projectId={projectId}>{() => <Panel aria-busy="true"><LoadingRows rows={2} /></Panel>}</ProjectFrame>;
}

/** Every page of an archived project says so once, above its content. */
export function ArchivedNotice({ projectId }: { projectId: string }) {
  const { state } = useProject(projectId);
  if (state.snapshot?.project.status !== 'archived') return null;
  return (
    <p className="info-banner m-0 text-sm" role="status">
      This project is archived and read-only. Reopen it from the top bar to change it.
    </p>
  );
}
