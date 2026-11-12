// Deliverable Review: the list, the viewer with its renderers and Compare, the comments and the
// decision bar. Used project-wide (/studio/p/:id/review) and in Agent Studio's Review tab.
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { FileStack, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Badge, Button, EmptyState, Panel, Select, LoadingRows, ResourceError } from '@ui';
import { cn } from '@lib/cn';
import { useMagnusResource } from '../../magnus/api/use-resource';
import type { Snapshot } from '../api/endpoints';
import { setStudioQuery, StudioLink, useStudioSearch } from '../link';
import { formatBytes } from '../projects/logic';
import { projectHref } from '../routes';
import { useProject } from '../state/project-store';
import { when } from '../agents/shared';
import { getRevision, listDeliverables, type ArtifactImport, type CommentAnchor, type Deliverable, type Revision } from './api';
import { CommentsPanel } from './comments';
import { useRevisionContent } from './content';
import { DecisionBar } from './decision-bar';
import { filterDeliverables, latestRevision, revisionName, shortMime, STATUS, type ReviewFilter } from './logic';
import { PreviewRenderer } from './renderers/registry';
import { DownloadButton } from './renderers/shared';

const CompareView = lazy(() => import('./compare'));

export interface ReviewAgent {
  ref: string;
  name: string;
  /** The roles this agent holds in the project's team. */
  roles: readonly string[];
}

function DeliverableList({ deliverables, imports, selected, filter, onFilter, onSelect, scope }: {
  deliverables: readonly Deliverable[];
  imports: readonly ArtifactImport[];
  selected: string | undefined;
  filter: ReviewFilter;
  onFilter: (next: ReviewFilter) => void;
  onSelect: (id: string) => void;
  scope: { agent?: ReviewAgent | undefined; value: 'agent' | 'project'; onChange: (value: 'agent' | 'project') => void };
}) {
  const all = deliverables;
  const shown = filterDeliverables(all, { ...filter, agent: scope.value === 'agent' && scope.agent ? { ref: scope.agent.ref, roles: scope.agent.roles } : undefined });
  const producers = [...new Set(all.map((item) => item.producer_role).filter((role): role is string => Boolean(role)))];
  const kinds = [...new Set(all.map((item) => item.kind))];
  return (
    <aside className="review-list panel panel--sm" aria-label="Deliverables">
      <div className="review-list__head">
        <h3 className="m-0 text-base font-semibold text-text-strong">
          Deliverables <span className="tab-count">{shown.length}</span>
        </h3>
        {scope.agent ? (
          <Select aria-label="Show deliverables from" value={scope.value} onChange={(value) => scope.onChange(value as 'agent' | 'project')} options={[{ value: 'agent', label: 'This agent' }, { value: 'project', label: 'Whole project' }]} />
        ) : null}
      </div>
      <div className="review-list__filters">
        <Select aria-label="Filter by status" value={filter.status} onChange={(status) => onFilter({ ...filter, status: status as ReviewFilter['status'] })} options={[{ value: '', label: 'Any status' }, ...Object.entries(STATUS).map(([value, item]) => ({ value, label: item.label })), { value: 'final', label: 'Has a final' }]} />
        <Select aria-label="Filter by producer" value={filter.producer} onChange={(producer) => onFilter({ ...filter, producer })} options={[{ value: '', label: 'Any producer' }, ...producers.map((value) => ({ value, label: value }))]} />
        <Select aria-label="Filter by kind" value={filter.kind} onChange={(kind) => onFilter({ ...filter, kind })} options={[{ value: '', label: 'Any kind' }, ...kinds.map((value) => ({ value, label: value }))]} />
      </div>
      {shown.length ? (
        <ul className="review-list__items">
          {shown.map((deliverable) => {
            const latest = latestRevision(deliverable);
            const status = latest ? STATUS[latest.review_status] : null;
            return (
              <li key={deliverable.id}>
                <button type="button" className={cn('review-list__item rounded-control border', deliverable.id === selected ? 'border-accent bg-accent-soft' : 'border-border bg-surface-sunken hover:border-accent')} aria-current={deliverable.id === selected ? 'true' : undefined} onClick={() => onSelect(deliverable.id)}>
                  <span className="review-list__name font-medium text-text-strong">{deliverable.name}</span>
                  <span className="review-list__facts text-xs text-text-muted">
                    {latest ? `${shortMime(latest.mime, revisionName(latest, deliverable.name))} · r${latest.revision}` : 'no revision'}
                    {deliverable.producer_role ? ` · ${deliverable.producer_role}` : ''}
                  </span>
                  <span className="review-list__badges">
                    {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
                    {deliverable.final_revision_id ? <Badge tone="success">Final</Badge> : null}
                    {deliverable.comments.open ? <Badge tone="warning">{deliverable.comments.open} open</Badge> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="m-0 text-sm text-text-muted">{all.length ? 'Nothing matches these filters.' : 'Nothing delivered yet.'}</p>
      )}
      {imports.length ? (
        <div className="review-list__imports grid gap-2">
          <p className="m-0 stat-label">Receiving</p>
          {imports.map((item) => (
            <p key={item.artifact_id} className="m-0 text-xs">
              <span className="font-medium">{item.name}</span> ·{' '}
              {item.state === 'failed' ? <span className="text-danger">not received: {item.error ?? 'failed'}</span> : <span className="text-text-muted">being received ({formatBytes(item.size)})</span>}
            </p>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function Viewer({ projectId, deliverable, revision, comments, focused, onAnchor, readOnly }: {
  projectId: string;
  deliverable: Deliverable;
  revision: Revision;
  comments: Parameters<typeof PreviewRenderer>[0]['comments'];
  focused: string | null;
  onAnchor: (anchor: CommentAnchor) => void;
  readOnly: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const content = useRevisionContent(revision, attempt);
  const name = revisionName(revision, deliverable.name);
  return (
    <>
      <dl className="review-meta m-0 text-xs">
        <div>
          <dt className="text-text-muted">Task</dt>
          <dd className="m-0">{revision.source_task_id ? <StudioLink href={projectHref(projectId, `/room?task=${encodeURIComponent(revision.source_task_id)}`)}>Open in Room</StudioLink> : 'Not from a Studio task'}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Received</dt>
          <dd className="m-0">
            {when(revision.received_at)} · {formatBytes(revision.size)}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">SHA-256</dt>
          <dd className="m-0 font-mono">
            {revision.blob_sha256.slice(0, 12)}
            {content.status === 'ready' ? (
              content.content.verified ? (
                <span className="review-meta__check text-success">
                  <ShieldCheck className="size-3" aria-hidden="true" /> verified
                </span>
              ) : (
                <span className="review-meta__check text-danger">
                  <ShieldAlert className="size-3" aria-hidden="true" /> does not match
                </span>
              )
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">Review</dt>
          <dd className="m-0">
            <Badge tone={STATUS[revision.review_status].tone}>{STATUS[revision.review_status].label}</Badge>
          </dd>
        </div>
      </dl>
      <div className="review-viewer__body">
        {content.status === 'loading' ? (
          <LoadingRows rows={6} />
        ) : content.status === 'error' ? (
          <ResourceError error={content.error} title="The file could not be downloaded" onRetry={() => setAttempt((value) => value + 1)} />
        ) : !content.content.verified ? (
          <EmptyState compact tone="danger" title="These bytes do not match the revision" message="The download differs from the digest Studio recorded, so it is not shown. Retry, and tell an administrator if it happens again." action={<Button size="sm" onClick={() => setAttempt((value) => value + 1)}>Retry</Button>} />
        ) : (
          <>
            <PreviewRenderer revision={revision} content={content.content} name={name} comments={comments} focused={focused} onAnchor={onAnchor} readOnly={readOnly} />
            <div className="mt-3">
              <DownloadButton content={content.content} name={name} />
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default function ReviewWorkspace({ projectId, snapshot, agent }: { projectId: string; snapshot: Snapshot; agent?: ReviewAgent | undefined }) {
  const search = useStudioSearch();
  const { store } = useProject(projectId);
  const list = useMagnusResource((signal) => listDeliverables(projectId, signal), [projectId]);
  const [scope, setScope] = useState<'agent' | 'project'>(agent ? 'agent' : 'project');
  const [filter, setFilter] = useState<ReviewFilter>({ status: '', producer: '', kind: '' });
  const [pending, setPending] = useState<CommentAnchor | null>(null);
  const deliverables = list.data?.deliverables ?? [];
  const visible = filterDeliverables(deliverables, { ...filter, agent: scope === 'agent' && agent ? { ref: agent.ref, roles: agent.roles } : undefined });
  const deliverable = deliverables.find((item) => item.id === search.get('d')) ?? visible[0];
  const revision = deliverable ? deliverable.revisions.find((item) => item.id === search.get('rev')) ?? latestRevision(deliverable) : undefined;
  const compareWith = deliverable?.revisions.find((item) => item.id === search.get('compare') && item.id !== revision?.id);
  const detail = useMagnusResource((signal) => getRevision(revision!.id, signal), [revision?.id], { enabled: Boolean(revision) });
  const comments = detail.data?.revision.id === revision?.id ? detail.data?.comments ?? [] : [];
  const focused = search.get('comment');
  const readOnly = snapshot.project.status === 'archived';
  const roles = (snapshot.team.current ?? snapshot.team.draft)?.body.roles ?? [];

  const refresh = useCallback(() => {
    void list.refresh();
    void detail.refresh();
  }, [list.refresh, detail.refresh]);
  useEffect(() => store.onEvent((event) => {
    if (/^(review|deliverable|export|artifact)\./.test(event.type)) refresh();
  }), [store, refresh]);
  useEffect(() => setPending(null), [revision?.id]);

  if (!list.data)
    return <Panel>{list.loading ? <LoadingRows rows={5} /> : <ResourceError error={list.error} title="Deliverables could not be loaded" onRetry={() => void list.refresh()} />}</Panel>;
  if (!deliverables.length && !list.data.imports.length)
    return <EmptyState framed icon={<FileStack className="size-6" />} title="No deliverables yet" message="When an agent registers a file, it appears here once Studio has received it and checked its digest." />;

  const select = (id: string) => setStudioQuery({ d: id, rev: null, compare: null, comment: null }, 'push');
  return (
    <div className="review">
      <DeliverableList deliverables={deliverables} imports={list.data.imports} selected={deliverable?.id} filter={filter} onFilter={setFilter} onSelect={select} scope={{ agent, value: scope, onChange: setScope }} />
      {deliverable && revision ? (
        <>
          <section className="review-viewer panel panel--sm" aria-label={`${deliverable.name}, revision ${revision.revision}`}>
            <div className="review-viewer__head">
              <div className="min-w-0">
                <h3 className="m-0 text-lg font-semibold text-text-strong">{deliverable.name}</h3>
                <p className="m-0 text-xs text-text-muted">
                  {deliverable.kind} · {revision.mime}
                  {deliverable.producer_role ? ` · from ${deliverable.producer_role}` : ''}
                </p>
              </div>
              <div className="review-viewer__controls">
                <Select aria-label="Revision" value={revision.id} onChange={(id) => setStudioQuery({ rev: id, compare: null, comment: null })} options={[...deliverable.revisions].sort((a, b) => b.revision - a.revision).map((item) => ({ value: item.id, label: `Revision ${item.revision}${item.id === deliverable.final_revision_id ? ' · final' : ''}` }))} />
                {deliverable.revisions.length > 1 ? (
                  <Select aria-label="Compare with" value={compareWith?.id ?? ''} onChange={(id) => setStudioQuery({ compare: id || null })} options={[{ value: '', label: 'No comparison' }, ...deliverable.revisions.filter((item) => item.id !== revision.id).map((item) => ({ value: item.id, label: `Compare with revision ${item.revision}` }))]} />
                ) : null}
              </div>
            </div>
            {compareWith ? (
              <Suspense fallback={<LoadingRows rows={6} />}>
                <CompareView before={compareWith.revision < revision.revision ? compareWith : revision} after={compareWith.revision < revision.revision ? revision : compareWith} />
              </Suspense>
            ) : (
              <Viewer key={revision.id} projectId={projectId} deliverable={deliverable} revision={revision} comments={comments} focused={focused} onAnchor={setPending} readOnly={readOnly} />
            )}
          </section>
          <div className="review-side">
            <CommentsPanel
              projectId={projectId}
              deliverable={deliverable}
              revision={revision}
              comments={comments}
              pending={pending}
              onClearPending={() => setPending(null)}
              focused={focused}
              onFocus={(id) => setStudioQuery({ comment: id, compare: null })}
              onOpenRevision={(id) => setStudioQuery({ rev: id, compare: null, comment: null })}
              roles={roles}
              readOnly={readOnly}
              onChanged={refresh}
            />
          </div>
          <DecisionBar projectId={projectId} projectName={snapshot.project.name} deliverable={deliverable} deliverables={deliverables} revision={revision} comments={comments} readOnly={readOnly} onChanged={refresh} />
        </>
      ) : (
        <EmptyState framed icon={<FileStack className="size-6" />} title={deliverables.length ? 'Choose a deliverable' : 'Nothing received yet'} message={deliverables.length ? 'Nothing matches the filters. Clear them, or show the whole project.' : 'Files that agents register appear here once received.'} />
      )}
    </div>
  );
}
