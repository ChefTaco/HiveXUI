// The room transcript: the stored messages of one conversation, threads under their first message,
// live reply bubbles while a turn streams, and the cards agents ask people to act on. The list is
// not a live region: a finished reply is announced once by the page, never per delta.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CircleHelp, Copy, CornerDownRight, ExternalLink, ListPlus, MessageSquareReply, Pin, Reply, Undo2 } from 'lucide-react';
import { Badge, Button, EmptyState, Skeleton } from '@ui';
import { cn } from '@lib/cn';
import { errorMessage } from '../../magnus/api/errors';
import { idempotencyKey } from '../api/client';
import { answerClarification, type Message, type StudioFile, type Task } from '../api/endpoints';
import { StudioLink } from '../link';
import { projectHref } from '../routes';
import type { Role } from './addressing';
import { MessageBody } from './message-body';
import { visibleLiveText, type TranscriptState } from './transcript-state';

export interface Author {
  name: string;
  /** The role the agent spoke for, shown beside its name. */
  role?: string;
  kind: 'user' | 'agent' | 'system';
}

export interface TranscriptActions {
  reply: (message: Message, thread: boolean) => void;
  pin: (message: Message) => void;
  createTask: (message: Message) => void;
  followUp: (message: Message) => void;
  openTask: (taskId: string) => void;
  jump: (messageId: string) => void;
  copyLink: (message: Message) => void;
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

export function authorOf(message: Message, roles: readonly Role[]): Author {
  if (message.author.kind === 'system') return { name: 'Studio', kind: 'system' };
  if (message.author.kind === 'user') return { name: message.author.user_id, kind: 'user' };
  const { role_key: key, binding_id: binding } = message.author;
  const role = roles.find((item) => item.key === key) ?? roles.find((item) => item.binding_id === binding);
  return { name: role?.name ?? key ?? 'Agent', kind: 'agent', ...(role ? { role: role.key } : {}) };
}

const time = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/** One line of what a message says, for a reply quote or an announcement. */
export const quote = (text: string, length = 90): string => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= length ? line : `${line.slice(0, length - 1).trimEnd()}…`;
};

interface Context {
  roles: readonly Role[];
  messages: ReadonlyMap<string, Message>;
  files: ReadonlyMap<string, StudioFile>;
  tasks: ReadonlyMap<string, Task>;
  projectId: string;
  archived: boolean;
  highlight: string | null;
  actions: TranscriptActions;
}

function Addressees({ message, roles }: { message: Message; roles: readonly Role[] }) {
  if (!message.addressees.length) return null;
  const names = message.addressees.map((key) => roles.find((role) => role.key === key)?.name ?? key);
  return <span className="text-xs text-text-muted">{`→ ${names.join(', ')}`}</span>;
}

function ClarificationCard({ message, context }: { message: Message; context: Context }) {
  const links = message.links;
  const options = Array.isArray(links.options) ? links.options.filter((item): item is string => typeof item === 'string') : [];
  const answered = str(links.answer_message_id);
  const [option, setOption] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const fieldId = useId();
  if (answered)
    return (
      <div className="room-card__foot text-sm text-text-muted">
        <Badge tone="success">Answered</Badge>
        <button type="button" className="room-link text-accent" onClick={() => context.actions.jump(answered)}>
          Show the answer
        </button>
      </div>
    );
  if (context.archived) return <p className="room-card__foot m-0 text-sm text-text-muted">Not answered. The project is archived.</p>;
  async function send() {
    const text = body.trim() || option;
    if (!text) {
      setError('Choose an option or write an answer.');
      return;
    }
    setBusy(true);
    setError(null);
    key.current ??= idempotencyKey();
    try {
      await answerClarification(message.id, { body_md: text, ...(option && body.trim() ? { option } : {}) }, key.current);
      key.current = null;
      setBody('');
    } catch (failure) {
      setError(errorMessage(failure, 'The answer could not be sent'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="room-card__form"
      aria-label="Answer the question"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      {options.length ? (
        <div className="room-options" role="radiogroup" aria-label="Options">
          {options.map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={option === item}
              className={cn('room-option rounded-control border text-sm', option === item ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface text-text hover:border-accent')}
              onClick={() => {
                key.current = null;
                setOption(option === item ? null : item);
              }}
            >
              {item}
            </button>
          ))}
        </div>
      ) : null}
      <label className="field" htmlFor={fieldId}>
        <span className="field-label">{options.length ? 'Add a note (optional)' : 'Your answer'}</span>
        <textarea
          id={fieldId}
          rows={2}
          value={body}
          onChange={(event) => {
            key.current = null;
            setBody(event.target.value);
          }}
        />
      </label>
      {error ? (
        <p className="m-0 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" size="sm" variant="primary" loading={busy}>
          Send answer
        </Button>
      </div>
    </form>
  );
}

function ProposalCard({ message, context }: { message: Message; context: Context }) {
  const proposal = record(message.links.proposal);
  const decided = str(message.links.decision_id);
  return (
    <div className="room-card__body">
      {str(proposal.title) ? <p className="m-0 text-sm text-text-strong">{str(proposal.title)}</p> : null}
      {str(proposal.rationale) ? <p className="m-0 text-xs text-text-muted">{`Why: ${str(proposal.rationale)}`}</p> : null}
      <div className="room-card__foot">
        {decided ? (
          <Badge tone="success">Pinned as a decision</Badge>
        ) : context.archived ? (
          <span className="text-sm text-text-muted">Proposed. Only a person can pin it.</span>
        ) : (
          <>
            <Button size="sm" variant="primary" icon={<Pin className="btn-ico" aria-hidden="true" />} onClick={() => context.actions.pin(message)}>
              Pin as decision
            </Button>
            <span className="text-xs text-text-muted">Proposed by an agent. Only a person pins it.</span>
          </>
        )}
      </div>
    </div>
  );
}

function Attachments({ message, files }: { message: Message; files: ReadonlyMap<string, StudioFile> }) {
  if (!message.attachments.length) return null;
  return (
    <ul className="room-attachments" aria-label="Attachments">
      {message.attachments.map((id) => (
        <li key={id} className="room-chip rounded-chip border border-border bg-surface text-xs text-text">
          {files.get(id)?.name ?? 'A project file'}
        </li>
      ))}
    </ul>
  );
}

function MessageLinks({ message, context }: { message: Message; context: Context }) {
  const links = message.links;
  const task = str(links.task_id) ?? str(record(links.handoff).task_id);
  const deliverable = str(links.deliverable_id);
  const revision = str(links.revision_id);
  const source = str(links.follow_up_of) ?? str(links.answers);
  const items: ReactNode[] = [];
  if (task && context.tasks.has(task))
    items.push(
      <button key="task" type="button" className="room-link text-xs text-accent" onClick={() => context.actions.openTask(task)}>
        {`Task: ${quote(context.tasks.get(task)!.title, 48)}`}
      </button>,
    );
  if (deliverable)
    items.push(
      <StudioLink key="deliverable" href={projectHref(context.projectId, `/review?d=${encodeURIComponent(deliverable)}${revision ? `&rev=${encodeURIComponent(revision)}` : ''}`)} className="room-link text-xs text-accent">
        Open deliverable
        <ExternalLink className="size-3" aria-hidden="true" />
      </StudioLink>,
    );
  if (source && context.messages.has(source))
    items.push(
      <button key="source" type="button" className="room-link text-xs text-accent" onClick={() => context.actions.jump(source)}>
        Open source message
      </button>,
    );
  return items.length ? <div className="room-msg__links">{items}</div> : null;
}

function Actions({ message, context, author }: { message: Message; context: Context; author: Author }) {
  const { actions } = context;
  const writable = !context.archived;
  const settled = message.state !== 'streaming';
  return (
    <div className="room-msg__actions" role="group" aria-label="Message actions">
      {writable && settled ? (
        <>
          <button type="button" className="room-action text-text-muted hover:text-text" aria-label="Reply" title="Reply" onClick={() => actions.reply(message, false)}>
            <Reply className="size-4" aria-hidden="true" />
          </button>
          <button type="button" className="room-action text-text-muted hover:text-text" aria-label="Reply in thread" title="Reply in thread" onClick={() => actions.reply(message, true)}>
            <MessageSquareReply className="size-4" aria-hidden="true" />
          </button>
          {message.kind !== 'decision_proposal' ? (
            <button type="button" className="room-action text-text-muted hover:text-text" aria-label="Pin as decision" title="Pin as decision" onClick={() => actions.pin(message)}>
              <Pin className="size-4" aria-hidden="true" />
            </button>
          ) : null}
          <button type="button" className="room-action text-text-muted hover:text-text" aria-label="Create task" title="Create task" onClick={() => actions.createTask(message)}>
            <ListPlus className="size-4" aria-hidden="true" />
          </button>
          {author.kind === 'agent' && author.role ? (
            <button type="button" className="room-action text-text-muted hover:text-text" aria-label="Request follow-up" title="Request follow-up" onClick={() => actions.followUp(message)}>
              <Undo2 className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </>
      ) : null}
      <button type="button" className="room-action text-text-muted hover:text-text" aria-label="Copy link" title="Copy link" onClick={() => actions.copyLink(message)}>
        <Copy className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  clarification: 'Question',
  decision_proposal: 'Decision proposal',
  summary: 'Discussion summary',
  discussion_question: 'Discussion question',
  answer: 'Answer',
  handoff: 'Hand-off',
  delivery: 'Delivery',
  revision_request: 'Revision request',
};

function MessageItem({ message, live, context }: { message: Message; live: TranscriptState['live'][string] | undefined; context: Context }) {
  const author = authorOf(message, context.roles);
  const replyTo = message.reply_to ? context.messages.get(message.reply_to) : undefined;
  const streaming = message.state === 'streaming';
  const visible = streaming ? visibleLiveText(live) : null;
  const highlight = context.highlight === message.id;
  const kind = KIND_LABEL[message.kind];
  if (message.kind === 'system') {
    const handoff = record(message.links.handoff);
    return (
      <li id={`message-${message.id}`} className={cn('room-note rounded-control border text-sm', handoff.allowed === false ? 'border-warning/50 bg-warning/10 text-text' : 'border-border bg-surface text-text-muted', highlight && 'room-msg--highlight')} data-message={message.id} tabIndex={-1}>
        <span className="stat-label">{handoff.allowed === false ? 'Hand-off refused' : 'Studio'}</span>
        <span className="room-msg__text">{message.body_md}</span>
        <MessageLinks message={message} context={context} />
      </li>
    );
  }
  const card = message.kind === 'clarification' || message.kind === 'decision_proposal';
  return (
    <li
      id={`message-${message.id}`}
      tabIndex={-1}
      data-message={message.id}
      data-state={message.state}
      className={cn(
        'room-msg rounded-control border',
        author.kind === 'user' ? 'room-msg--own border-accent/30 bg-accent-soft' : 'border-border bg-surface-raised',
        card && 'border-warning/50',
        message.state === 'failed' && 'border-danger/50',
        highlight && 'room-msg--highlight',
      )}
    >
      <div className="room-msg__head">
        <span className="text-sm text-text-strong">{author.name}</span>
        {author.kind === 'agent' && author.role ? <span className="text-xs text-text-muted">{`@${author.role}`}</span> : null}
        <Addressees message={message} roles={context.roles} />
        {kind ? (
          <Badge tone={card ? 'warning' : 'neutral'}>
            {message.kind === 'clarification' ? <CircleHelp className="size-3" aria-hidden="true" /> : null}
            {kind}
          </Badge>
        ) : null}
        {streaming ? <span className="text-xs text-accent">Replying…</span> : null}
        {message.state === 'failed' ? <Badge tone="danger">Failed</Badge> : null}
        <time className="room-msg__time text-xs text-text-muted" dateTime={message.created_at}>
          {time(message.created_at)}
        </time>
      </div>
      {replyTo ? (
        <button type="button" className="room-quote text-left text-xs text-text-muted hover:text-text" onClick={() => context.actions.jump(replyTo.id)}>
          <CornerDownRight className="size-3" aria-hidden="true" />
          <span>{`${authorOf(replyTo, context.roles).name}: ${quote(replyTo.body_md, 70)}`}</span>
        </button>
      ) : null}
      {streaming ? (
        visible === null ? (
          <p className="room-msg__text m-0 text-sm text-text-muted">
            <span className="typing-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>{' '}
            Working…
          </p>
        ) : (
          <p className="room-msg__text room-msg__text--live m-0 text-sm text-text">{visible}</p>
        )
      ) : (
        message.body_md ? <MessageBody text={message.body_md} /> : <p className="room-msg__text m-0 text-sm text-text">{message.state === 'failed' ? 'The turn ended without a reply.' : ''}</p>
      )}
      <Attachments message={message} files={context.files} />
      {message.kind === 'clarification' ? <ClarificationCard message={message} context={context} /> : null}
      {message.kind === 'decision_proposal' ? <ProposalCard message={message} context={context} /> : null}
      <MessageLinks message={message} context={context} />
      <Actions message={message} context={context} author={author} />
    </li>
  );
}

const THREAD_PREVIEW = 3;

function Thread({ root, replies, live, context }: { root: Message; replies: readonly Message[]; live: TranscriptState['live']; context: Context }) {
  const [open, setOpen] = useState(false);
  const containsHighlight = context.highlight ? replies.some((reply) => reply.id === context.highlight) : false;
  const shown = open || containsHighlight ? replies : replies.slice(-THREAD_PREVIEW);
  const hidden = replies.length - shown.length;
  return (
    <>
      <MessageItem message={root} live={live[root.id]} context={context} />
      {replies.length ? (
        <li className="room-thread-wrap">
          <ol className="room-thread" aria-label={`Thread, ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}>
            {hidden > 0 ? (
              <li>
                <button type="button" className="room-link text-xs text-accent" onClick={() => setOpen(true)}>
                  {`Show ${hidden} earlier ${hidden === 1 ? 'reply' : 'replies'}`}
                </button>
              </li>
            ) : null}
            {shown.map((reply) => (
              <MessageItem key={reply.id} message={reply} live={live[reply.id]} context={context} />
            ))}
          </ol>
        </li>
      ) : null}
    </>
  );
}

/** Messages with their thread replies after them; a reply whose thread start is not loaded stands alone. */
export function threads(messages: readonly Message[]): Array<{ root: Message; replies: Message[] }> {
  const ids = new Set(messages.map((message) => message.id));
  const groups = new Map<string, { root: Message; replies: Message[] }>();
  const order: Array<{ root: Message; replies: Message[] }> = [];
  for (const message of messages) {
    const root = message.thread_root && message.thread_root !== message.id && ids.has(message.thread_root) ? message.thread_root : null;
    if (root) {
      groups.get(root)?.replies.push(message);
      continue;
    }
    const group = { root: message, replies: [] as Message[] };
    groups.set(message.id, group);
    order.push(group);
  }
  return order;
}

export interface TranscriptProps {
  transcript: TranscriptState;
  roles: readonly Role[];
  files: readonly StudioFile[];
  tasks: readonly Task[];
  projectId: string;
  archived: boolean;
  highlight: string | null;
  actions: TranscriptActions;
  onRetry: () => void;
  /** What the empty state invites, which depends on the conversation. */
  emptyMessage: string;
  listRef?: React.Ref<HTMLOListElement>;
}

export function Transcript({ transcript, roles, files, tasks, projectId, archived, highlight, actions, onRetry, emptyMessage, listRef }: TranscriptProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const messages = new Map(transcript.messages.map((message) => [message.id, message] as const));
  const context: Context = {
    roles,
    messages,
    files: new Map(files.map((file) => [file.id, file] as const)),
    tasks: new Map(tasks.map((task) => [task.id, task] as const)),
    projectId,
    archived,
    highlight,
    actions,
  };
  const liveLength = Object.values(transcript.live).reduce((sum, item) => sum + item.text.length, 0);
  // Follow new text while the reader is at the bottom; leave them where they are when they scrolled up.
  useEffect(() => {
    const node = scroller.current;
    if (node && pinned.current && !highlight) node.scrollTop = node.scrollHeight;
  }, [transcript.messages.length, liveLength, highlight]);
  useEffect(() => {
    if (!highlight || transcript.status !== 'ready') return;
    const node = document.getElementById(`message-${highlight}`);
    node?.scrollIntoView({ block: 'center' });
  }, [highlight, transcript.status]);

  let body: ReactNode;
  if (transcript.status === 'loading' && !transcript.messages.length)
    body = (
      <div className="room-transcript__loading" aria-busy="true" aria-label="Loading messages">
        <Skeleton className="h-10" />
        <Skeleton className="h-16" />
        <Skeleton className="h-10" />
      </div>
    );
  else if (transcript.status === 'error')
    body = <EmptyState compact tone="warning" title="The conversation could not be read" message="The Studio service did not answer. Your messages are safe on the service." action={<Button size="sm" onClick={onRetry}>Retry</Button>} />;
  else if (!transcript.messages.length) body = <EmptyState compact title="No messages yet" message={emptyMessage} />;
  else
    body = (
      <ol ref={listRef} className="room-messages" aria-label="Messages" tabIndex={-1}>
        {threads(transcript.messages).map(({ root, replies }) => (
          <Thread key={root.id} root={root} replies={replies} live={transcript.live} context={context} />
        ))}
      </ol>
    );
  return (
    <div
      ref={scroller}
      className="room-transcript__scroll"
      onScroll={(event) => {
        const node = event.currentTarget;
        pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
      }}
    >
      {transcript.status === 'loading' && transcript.messages.length ? <p className="room-transcript__refresh m-0 text-xs text-text-muted" role="status">Catching up…</p> : null}
      {body}
    </div>
  );
}
