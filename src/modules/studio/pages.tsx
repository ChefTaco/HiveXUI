import type { ReactNode } from 'react';
import { ArrowUpRight, Compass, Library, Plus, ServerOff, ShieldAlert } from 'lucide-react';
import { Button, EmptyState, PageHeader, Panel } from '@ui';
import { parseProfileRef, profileHref } from '../magnus/pages/agents/ardent/logic';
import { LoadingRows } from '../magnus/ui/resource-state';
import type { StudioConnection } from './api/client';
import './projects/projects.css';
import { AgentStudio } from './agents/page';
import { StudioLink } from './link';
import { ProjectReview } from './review/page';
import { CreateProject } from './projects/create';
import { ProjectsHome } from './projects/home';
import { ArchivedNotice, ProjectLanding } from './projects/project-page';
import { Gallery } from './gallery/gallery';
import { TeamDesigner } from './team/designer';
import { ConversationRoom } from './room/room-page';
import { STUDIO_PREFIX } from './paths';
import type { StudioMatch } from './routes';

/** What each page will hold once the Studio service's client is here, in the words of its empty state. */
const PURPOSE: Record<StudioMatch['route']['id'], string> = {
  home: 'your projects, their teams and their latest activity',
  new: 'the new-project form: brief, references and starting team',
  gallery: 'agent and team templates',
  agent: "this agent's identity, capabilities, knowledge and development",
  project: "this project's last area",
  team: "this project's team design and role bindings",
  'team-gallery': 'templates to apply to this team',
  room: "this project's conversation room and transcript",
  'project-agent': "this agent's work in this project",
  review: "this project's deliverables and their review",
};

/**
 * The body of every page whose data comes from the Studio service. Until a release of HiveXUI
 * carries that service's client, a page says what it cannot show and why; it never invents records.
 */
function ServiceBody({ match, connection, onRetry }: { match: StudioMatch; connection: StudioConnection; onRetry: () => void }) {
  if (connection.state === 'checking')
    return (
      <Panel aria-busy="true">
        <LoadingRows rows={3} />
      </Panel>
    );
  if (connection.state === 'ready')
    return (
      <EmptyState
        framed
        icon={<Compass className="size-6" />}
        title="This console cannot open this page yet"
        message={`This page shows ${PURPOSE[match.route.id]}. Ardent Project Studio answered, but this version of HiveXUI does not include its client yet. Update HiveXUI to work here.`}
      />
    );
  return (
    <EmptyState
      framed
      tone="warning"
      icon={connection.state === 'denied' ? <ShieldAlert className="size-6" /> : <ServerOff className="size-6" />}
      title={connection.state === 'denied' ? 'Ardent Project Studio refused this identity' : "The Studio service isn't reachable"}
      message={`${connection.message} This page shows ${PURPOSE[match.route.id]} once it answers.`}
      action={<Button onClick={onRetry}>Retry</Button>}
    />
  );
}

function header(match: StudioMatch): { description: string; actions?: ReactNode } {
  const ref = match.agentRef ? parseProfileRef(match.agentRef) : null;
  switch (match.route.id) {
    case 'home':
      return {
        description: 'Give a team of Ardent agents a shared project, watch them work together and review what they deliver.',
        actions: (
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
        ),
      };
    case 'new':
      return { description: 'Write the brief, add references and choose a starting team.' };
    case 'gallery':
    case 'team-gallery':
      return { description: 'Reusable agent and team templates, with their versions.' };
    case 'agent':
    case 'project-agent':
      return {
        description: ref ? `Profile ${ref.profileId} on node ${ref.nodeId}` : 'An Ardent agent',
        ...(ref
          ? {
              actions: (
                <StudioLink href={'/fleet' + profileHref(ref.nodeId, ref.profileId)} className="btn no-underline">
                  Fleet details
                  <ArrowUpRight className="btn-ico" aria-hidden="true" />
                </StudioLink>
              ),
            }
          : {}),
      };
    case 'team':
      return { description: 'Design the team, then bind each role to an Ardent agent.' };
    case 'room':
      return { description: 'Talk to the coordinator, an agent or the whole team.' };
    case 'review':
      return { description: 'Deliverables from every agent in this project, with their revisions and comments.' };
    case 'project':
      return { description: `Project ${match.projectId ?? ''}` };
  }
}

/** The pages this release of HiveXUI implements, once the service answers. */
function implemented(match: StudioMatch): ReactNode {
  switch (match.route.id) {
    case 'home':
      return <ProjectsHome />;
    case 'new':
      return <CreateProject />;
    case 'project':
      return <ProjectLanding projectId={match.projectId!} />;
    case 'team':
      return <TeamDesigner projectId={match.projectId!} />;
    case 'gallery':
      return <Gallery />;
    case 'team-gallery':
      return <Gallery projectId={match.projectId!} />;
    case 'review':
      return <ProjectReview projectId={match.projectId!} />;
    case 'agent':
    case 'project-agent':
      return <AgentStudio agentRef={match.agentRef!} projectId={match.projectId} />;
    case 'room':
      return <ConversationRoom projectId={match.projectId!} />;
    default:
      return null;
  }
}

export function StudioPage({ match, connection, onRetry }: { match: StudioMatch; connection: StudioConnection; onRetry: () => void }) {
  const { description, actions } = header(match);
  const page = connection.state === 'ready' ? implemented(match) : null;
  return (
    <div className="page-stack">
      {connection.state === 'ready' && connection.degraded.length ? (
        <div className="warning-banner text-sm" role="status">
          {connection.degraded.map((line) => (
            <p key={line} className="m-0">{line}</p>
          ))}
        </div>
      ) : null}
      {match.projectId && connection.state === 'ready' ? <ArchivedNotice projectId={match.projectId} /> : null}
      {page ?? (
        <>
          <PageHeader eyebrow="Ardent Project Studio" title={match.route.title} description={description} actions={actions} />
          <ServiceBody match={match} connection={connection} onRetry={onRetry} />
        </>
      )}
    </div>
  );
}

export function StudioNotFound() {
  return (
    <EmptyState
      framed
      icon={<Compass className="size-6" />}
      title="Not found"
      message="This Studio page does not exist."
      action={
        <StudioLink href={STUDIO_PREFIX} className="btn no-underline">
          Projects
        </StudioLink>
      }
    />
  );
}
