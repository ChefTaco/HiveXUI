import { useState } from 'react';
import { Check, MessageSquarePlus, Send, X } from 'lucide-react';
import { Badge, Button, Drawer, Field, Select, TextArea } from '@ui';
import { errorMessage } from '../../magnus/api/errors';
import { idempotencyKey } from '../api/client';
import type { TeamRevision } from '../api/endpoints';
import { StudioLink } from '../link';
import { projectHref } from '../routes';
import { anchorLabel } from './anchors';
import { addComment, requestRevision, resolveComment, type CommentAnchor, type Deliverable, type ReviewComment, type Revision } from './api';
import { when } from '../agents/shared';

export interface CommentsProps {
  projectId: string;
  deliverable: Deliverable;
  revision: Revision;
  comments: readonly ReviewComment[];
  /** The selection or region waiting for a comment; null comments on the whole file. */
  pending: CommentAnchor | null;
  onClearPending: () => void;
  focused: string | null;
  onFocus: (commentId: string | null) => void;
  onOpenRevision: (revisionId: string) => void;
  /** Roles that can take a revision task: bound roles of the published team. */
  roles: TeamRevision['body']['roles'];
  readOnly: boolean;
  onChanged: () => void;
}

/** Comment on the selection (or the whole file). */
function Composer({ revision, pending, onClearPending, readOnly, onChanged, onFocus }: Pick<CommentsProps, 'revision' | 'pending' | 'onClearPending' | 'readOnly' | 'onChanged' | 'onFocus'>) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (readOnly) return null;
  async function send() {
    setBusy(true);
    setError('');
    try {
      const comment = await addComment(revision.id, { anchor: pending ?? { kind: 'file' }, body_md: body.trim() }, idempotencyKey());
      setBody('');
      onClearPending();
      onFocus(comment.id);
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught, 'The comment could not be added'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="review-composer grid gap-2">
      <div className="review-composer__target text-xs">
        <span className="text-text-muted">On:</span>
        <span className="review-composer__anchor">{pending ? anchorLabel(pending) : 'Whole file'}</span>
        {pending ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClearPending} aria-label="Comment on the whole file instead">
            <X className="size-3" aria-hidden="true" />
            Whole file
          </Button>
        ) : (
          <span className="text-text-muted">Select text or draw a region to point at part of it.</span>
        )}
      </div>
      <Field label="Comment">
        <TextArea value={body} onChange={setBody} maxLength={20_000} className="review-composer__input" />
      </Field>
      <Button size="sm" variant="primary" icon={<MessageSquarePlus className="size-4" />} loading={busy} disabled={!body.trim()} onClick={() => void send()} className="justify-self-start">
        Comment
      </Button>
      {error ? <p role="alert" className="m-0 text-sm text-danger">{error}</p> : null}
    </div>
  );
}

/** Select comments, then send them to the producer role as a revision task. */
function RevisionRequest({ projectId, deliverable, selected, roles, onDone }: { projectId: string; deliverable: Deliverable; selected: readonly ReviewComment[]; roles: CommentsProps['roles']; onDone: (message: string) => void }) {
  const bound = roles.filter((role) => role.agent_ref);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(deliverable.producer_role ?? bound[0]?.key ?? '');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const start = () => {
    setRole(deliverable.producer_role ?? bound[0]?.key ?? '');
    setInstructions(`Please address ${selected.length === 1 ? 'this comment' : `these ${selected.length} comments`} on ${deliverable.name}.`);
    setError('');
    setOpen(true);
  };
  async function send() {
    setBusy(true);
    setError('');
    try {
      const result = await requestRevision(projectId, { comment_ids: selected.map((comment) => comment.id), ...(role ? { role_key: role } : {}), instructions_md: instructions.trim() }, idempotencyKey());
      setOpen(false);
      onDone(`Revision task created: ${result.task.title}.`);
    } catch (caught) {
      setError(errorMessage(caught, 'The revision could not be requested'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button size="sm" icon={<Send className="size-4" />} disabled={selected.length === 0} onClick={start}>
        Request revision{selected.length ? ` (${selected.length})` : ''}
      </Button>
      <Drawer
        open={open}
        title="Request revision"
        eyebrow={deliverable.name}
        onClose={() => setOpen(false)}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} disabled={!role} onClick={() => void send()}>
              Send revision task
            </Button>
          </div>
        }
      >
        <div className="grid gap-4">
          <p className="m-0 text-sm text-text-muted">
            The role gets a revision task with {selected.length === 1 ? 'the comment' : `the ${selected.length} comments`} and the passages they point at. The revised file arrives as the next revision.
          </p>
          <Field label="Send to">
            <Select
              value={role}
              onChange={setRole}
              options={[...(role && !bound.some((item) => item.key === role) ? [{ value: role, label: `${role} (no bound agent)` }] : []), ...bound.map((item) => ({ value: item.key, label: `${item.name}${item.key === deliverable.producer_role ? ' · producer' : ''}` }))]}
            />
          </Field>
          <Field label="Instructions">
            <TextArea value={instructions} onChange={setInstructions} maxLength={20_000} className="review-composer__input" />
          </Field>
          <ul className="review-comment-list" aria-label="Comments to send">
            {selected.map((comment) => (
              <li key={comment.id} className="rounded-control border border-border bg-surface-sunken p-2 text-sm">
                <span className="block text-xs text-text-muted">{anchorLabel(comment.anchor)}</span>
                {comment.body_md}
              </li>
            ))}
          </ul>
          {error ? <p role="alert" className="m-0 text-sm text-danger">{error}</p> : null}
        </div>
      </Drawer>
    </>
  );
}

export function CommentsPanel(props: CommentsProps) {
  const { projectId, deliverable, comments, focused, onFocus, onOpenRevision, readOnly, onChanged } = props;
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const shown = comments.filter((comment) => filter === 'all' || comment.state === filter);
  const selected = comments.filter((comment) => chosen.has(comment.id) && comment.state === 'open');
  const revisionNumber = (id: string | null) => deliverable.revisions.find((item) => item.id === id)?.revision;

  async function resolve(comment: ReviewComment) {
    setBusy(comment.id);
    setError('');
    try {
      await resolveComment(comment.id, idempotencyKey());
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught, 'The comment could not be resolved'));
    } finally {
      setBusy('');
    }
  }
  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="review-comments panel panel--sm" aria-labelledby="review-comments-title">
      <div className="review-comments__head">
        <h3 id="review-comments-title" className="m-0 text-base font-semibold text-text-strong">
          Comments <span className="tab-count">{comments.filter((comment) => comment.state === 'open').length}</span>
        </h3>
        <Select aria-label="Show comments" value={filter} onChange={(value) => setFilter(value as typeof filter)} options={[{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }, { value: 'all', label: 'All' }]} />
      </div>
      <Composer {...props} />
      {shown.length ? (
        <ul className="review-comment-list" aria-label="Comments on this revision">
          {shown.map((comment) => (
            <li key={comment.id} className={`review-comment rounded-control border p-3 ${comment.id === focused ? 'border-accent bg-accent-soft' : 'border-border bg-surface-sunken'}`}>
              <div className="review-comment__head">
                {comment.state === 'open' && !readOnly ? (
                  <input type="checkbox" className="review-comment__check" checked={chosen.has(comment.id)} onChange={() => toggle(comment.id)} aria-label={`Include in a revision request: ${anchorLabel(comment.anchor)}`} />
                ) : null}
                <Button type="button" variant="ghost" size="sm" className="review-comment__anchor" aria-pressed={comment.id === focused} onClick={() => onFocus(comment.id === focused ? null : comment.id)}>
                  {anchorLabel(comment.anchor)}
                </Button>
                {comment.state === 'resolved' ? <Badge tone="success">Resolved</Badge> : null}
              </div>
              <p className="m-0 mt-2 whitespace-pre-wrap text-sm">{comment.body_md}</p>
              <p className="m-0 mt-1 text-xs text-text-muted">
                {comment.author} · {when(comment.created_at)}
              </p>
              {comment.revision_task_id || comment.addressed_in_revision_id ? (
                <p className="review-comment__links m-0 mt-2 text-xs">
                  {comment.revision_task_id ? (
                    <StudioLink href={projectHref(projectId, `/room?task=${encodeURIComponent(comment.revision_task_id)}`)}>→ Revision task</StudioLink>
                  ) : null}
                  {comment.addressed_in_revision_id ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => onOpenRevision(comment.addressed_in_revision_id!)}>
                      → rev {revisionNumber(comment.addressed_in_revision_id) ?? '?'}
                    </Button>
                  ) : null}
                </p>
              ) : null}
              {comment.state === 'open' && !readOnly ? (
                <Button size="sm" variant="ghost" icon={<Check className="size-4" />} loading={busy === comment.id} className="mt-2" onClick={() => void resolve(comment)}>
                  Resolve
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-sm text-text-muted">{filter === 'open' ? 'No open comments on this revision.' : 'No comments here.'}</p>
      )}
      {!readOnly ? (
        <div className="review-comments__foot">
          <RevisionRequest
            projectId={projectId}
            deliverable={deliverable}
            selected={selected}
            roles={props.roles}
            onDone={(message) => {
              setNote(message);
              setChosen(new Set());
              onChanged();
            }}
          />
          {!selected.length ? <span className="text-xs text-text-muted">Tick open comments to send them back to the producer.</span> : null}
        </div>
      ) : null}
      {note ? <p role="status" className="m-0 text-sm text-success">{note}</p> : null}
      {error ? <p role="alert" className="m-0 text-sm text-danger">{error}</p> : null}
    </section>
  );
}
