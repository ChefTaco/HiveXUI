import { lazy, Suspense } from 'react';
import { PageHeader } from '@ui';
import { LoadingRows } from '../../magnus/ui/resource-state';
import { ProjectFrame } from '../projects/project-page';
import './review.css';

const ReviewWorkspace = lazy(() => import('./workspace'));

/** /studio/p/:id/review: every deliverable in the project. */
export function ProjectReview({ projectId }: { projectId: string }) {
  return (
    <ProjectFrame projectId={projectId}>
      {(state) => (
        <div className="page-stack">
          <PageHeader eyebrow="Ardent Project Studio" title="Review" description="Deliverables from every agent in this project, with their revisions, comments and decisions." />
          <Suspense fallback={<LoadingRows rows={5} />}>
            <ReviewWorkspace projectId={projectId} snapshot={state.snapshot} />
          </Suspense>
        </div>
      )}
    </ProjectFrame>
  );
}

export { ReviewWorkspace };
