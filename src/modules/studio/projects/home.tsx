import { useCallback, useEffect, useState } from 'react';
import { Activity, Archive, ClipboardCheck, FileText, FolderKanban, Library, MessageCircleQuestion, Plus, Search, Users } from 'lucide-react';
import { Badge, EmptyState, PageHeader, Skeleton, ResourceError } from '@ui';
import { cn } from '@lib/cn';
import { relativeTime } from '@lib/format';
import { useMagnusResource } from '../../magnus/api/use-resource';
import { listProjects, type ProjectSummary } from '../api/endpoints';
import { setStudioQuery, StudioLink, useStudioSearch } from '../link';
import { STUDIO_PREFIX } from '../paths';
import { projectHref } from '../routes';
import { activityLine, questionsText, referencesText, reviewText, tasksText, teamLine } from './logic';
import { SUMMARY_POLL_MS, useLiveSummaries, type Counts } from './live-summaries';

type Status = 'active' | 'archived';
const SEARCH_DELAY_MS = 250;

function ProjectCard({ project }: { project: ProjectSummary }) {
  const hivemem = project.hivemem.state;
  return (
    <li className="studio-card panel panel--sm glow-hover--accent">
      <div className="studio-card__head">
        <h3 className="studio-card__title">
          <StudioLink href={projectHref(project.id)} className="studio-card__link text-text-strong no-underline hover:text-accent">
            {project.name}
          </StudioLink>
        </h3>
        {project.status === 'archived' ? <Badge tone="neutral">Archived</Badge> : null}
      </div>
      {project.open_questions || project.review_pending ? (
        <p className="studio-card__badges m-0">
          {project.open_questions ? (
            <Badge tone="warning">
              <MessageCircleQuestion className="size-3" aria-hidden="true" />
              {questionsText(project.open_questions)}
            </Badge>
          ) : null}
          {project.review_pending ? (
            <Badge tone="accent">
              <ClipboardCheck className="size-3" aria-hidden="true" />
              {reviewText(project.review_pending)}
            </Badge>
          ) : null}
        </p>
      ) : null}
      <p className="studio-card__brief text-sm text-text-muted">{project.brief_excerpt || 'No brief yet.'}</p>
      <dl className="studio-card__facts text-sm">
        <div>
          <dt className="sr-only">Team</dt>
          <dd>
            <Users className="size-4 text-text-muted" aria-hidden="true" />
            {teamLine(project.team)}
          </dd>
        </div>
        <div>
          <dt className="sr-only">Work</dt>
          <dd className={project.active_tasks ? undefined : 'text-text-muted'}>
            <Activity className="size-4 text-text-muted" aria-hidden="true" />
            {tasksText(project.active_tasks)}
          </dd>
        </div>
        <div>
          <dt className="sr-only">References and deliverables</dt>
          <dd>
            <FileText className="size-4 text-text-muted" aria-hidden="true" />
            {referencesText(project)}
          </dd>
        </div>
      </dl>
      <div className="studio-card__foot text-xs text-text-muted">
        {project.last_activity ? (
          <span className="studio-card__activity">
            <span className="studio-card__activity-text">{activityLine(project.last_activity)}</span> · <time dateTime={project.last_activity.at}>{relativeTime(project.last_activity.at)}</time>
          </span>
        ) : (
          <span>No recorded activity</span>
        )}
        {hivemem !== 'ready' ? <Badge tone={hivemem === 'failed' ? 'danger' : 'info'}>{hivemem === 'failed' ? 'Knowledge failed' : 'Knowledge pending'}</Badge> : null}
        {project.tags.length ? (
          <span className="studio-card__tags">
            {project.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="tag">
                {tag}
              </span>
            ))}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function CardSkeletons() {
  return (
    <ul className="studio-cards" aria-busy="true" aria-label="Loading projects">
      {[0, 1, 2].map((index) => (
        <li key={index} className="studio-card panel panel--sm">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-10" />
          <Skeleton className="h-4 w-2/3" />
        </li>
      ))}
    </ul>
  );
}

/** Projects home: search, Active and Archived, and a card per project from the service's summaries. */
export function ProjectsHome() {
  const search = useStudioSearch();
  const status: Status = search.get('status') === 'archived' ? 'archived' : 'active';
  const query = search.get('q') ?? '';
  const [text, setText] = useState(query);
  useEffect(() => {
    if (text === query) return;
    const timer = setTimeout(() => setStudioQuery({ q: text.trim() || null }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, query]);
  const needsReview = search.get('review') === '1';
  const projects = useMagnusResource((signal) => listProjects({ status, ...(query ? { q: query } : {}), ...(needsReview ? { needs_review: 'true' as const } : {}) }, signal), [status, query, needsReview], { pollMs: SUMMARY_POLL_MS });
  const filtered = Boolean(query) || needsReview;
  const { data, setData, refresh } = projects;
  const patch = useCallback(
    (projectId: string, counts: Counts) => {
      if (!data) return;
      // A card that no longer needs review leaves the filtered list with the next read.
      setData(data.map((project) => (project.id === projectId ? { ...project, ...counts } : project)));
      if (needsReview && counts.review_pending === 0) void refresh();
    },
    [data, setData, refresh, needsReview],
  );
  const reread = useCallback(() => void refresh(), [refresh]);
  useLiveSummaries(data, patch, reread);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Ardent Project Studio"
        title="Projects"
        description="Give a team of Ardent agents a shared project, watch them work together and review what they deliver."
        actions={
          <>
            <StudioLink href={`${STUDIO_PREFIX}/gallery`} className="btn no-underline">
              <Library className="btn-ico" aria-hidden="true" />
              Gallery
            </StudioLink>
            <StudioLink href={`${STUDIO_PREFIX}/new`} className="btn btn--primary no-underline">
              <Plus className="btn-ico" aria-hidden="true" />
              New project
            </StudioLink>
          </>
        }
      />
      <div className="studio-toolbar">
        <label className="studio-search">
          <Search className="studio-search__icon size-4 text-text-muted" aria-hidden="true" />
          <span className="sr-only">Search projects</span>
          <input type="search" value={text} onChange={(event) => setText(event.target.value)} placeholder="Search name, brief or tags" maxLength={200} />
        </label>
        <div role="group" aria-label="Status" className="segmented-tabs">
          {(['active', 'archived'] as const).map((option) => (
            <button key={option} type="button" aria-pressed={status === option} className={cn('tab-button', status === option && 'tab-button--active')} onClick={() => setStudioQuery({ status: option === 'active' ? null : option })}>
              {option === 'active' ? 'Active' : 'Archived'}
            </button>
          ))}
        </div>
        <button type="button" aria-pressed={needsReview} className={cn('btn btn--sm', needsReview && 'border-accent bg-accent-soft text-accent')} onClick={() => setStudioQuery({ review: needsReview ? null : '1' })}>
          <ClipboardCheck className="btn-ico" aria-hidden="true" />
          Needs review
        </button>
      </div>
      {projects.data ? (
        projects.data.length ? (
          <>
            {projects.error ? <ResourceError error={projects.error} title="Showing the last list: refreshing failed" onRetry={() => void projects.refresh()} /> : null}
            <ul className="studio-cards" aria-label={status === 'active' ? 'Active projects' : 'Archived projects'}>
              {projects.data.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </ul>
          </>
        ) : needsReview && !query ? (
          <EmptyState framed icon={<ClipboardCheck className="size-6" />} title="Nothing needs review" message={`No ${status === 'archived' ? 'archived' : 'active'} project has a delivery waiting for you.`} action={<button type="button" className="btn" onClick={() => setStudioQuery({ review: null })}>Show all projects</button>} />
        ) : filtered ? (
          <EmptyState
            framed
            icon={<Search className="size-6" />}
            title="No projects match"
            message={`Nothing ${status === 'archived' ? 'archived' : 'active'}${needsReview ? ' that needs review' : ''} matches “${query}”.`}
            action={
              <button type="button" className="btn" onClick={() => { setText(''); setStudioQuery({ review: null }); }}>
                Clear filters
              </button>
            }
          />
        ) : status === 'archived' ? (
          <EmptyState framed icon={<Archive className="size-6" />} title="No archived projects" message="Archiving a project makes it read-only. Archived projects are listed here and can be reopened." />
        ) : (
          <EmptyState
            framed
            icon={<FolderKanban className="size-6" />}
            title="Start your first project"
            message="Write a brief, add references and pick a starting team. Then bind each role to an Ardent agent and start the conversation."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <StudioLink href={`${STUDIO_PREFIX}/new`} className="btn btn--primary no-underline">
                  <Plus className="btn-ico" aria-hidden="true" />
                  Create project
                </StudioLink>
                <StudioLink href={`${STUDIO_PREFIX}/gallery`} className="btn no-underline">
                  <Library className="btn-ico" aria-hidden="true" />
                  Browse templates
                </StudioLink>
              </div>
            }
          />
        )
      ) : projects.loading ? (
        <CardSkeletons />
      ) : (
        <ResourceError error={projects.error} title="Projects could not be loaded" onRetry={() => void projects.refresh()} />
      )}
    </div>
  );
}
