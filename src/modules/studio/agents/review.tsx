import { Suspense } from 'react';
import { FileStack } from 'lucide-react';
import { EmptyState, LoadingRows } from '@ui';
import { ReviewWorkspace } from '../review/page';
import { projectRoles } from './logic';
import type { AgentContext } from './page';

/** Deliverable Review for this agent's work in the open project; the whole project is a filter away. */
export function ReviewTab({ context }: { context: AgentContext }) {
  const { snapshot, projectId, agentRef, agent, profileId } = context;
  if (!snapshot || !projectId)
    return <EmptyState framed icon={<FileStack className="size-6" />} title="Open this agent from a project" message="Deliverables belong to a project. Choose one of the projects using this agent above to review what it delivered there." />;
  return (
    <Suspense fallback={<LoadingRows rows={5} />}>
      <ReviewWorkspace projectId={projectId} snapshot={snapshot} agent={{ ref: agentRef, name: agent?.display_name ?? profileId, roles: projectRoles(snapshot, agentRef).map((role) => role.key) }} />
    </Suspense>
  );
}
