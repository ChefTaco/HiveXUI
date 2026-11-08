import { useMemo, useState } from 'react';
import { History, MessageSquare, Sparkles } from 'lucide-react';
import { Badge, Button, EmptyState, Field, Panel, Select, TextArea } from '@ui';
import { errorMessage } from '../../magnus/api/errors';
import { useMagnusResource } from '../../magnus/api/use-resource';
import { readResource } from '../../magnus/pages/agents/ardent/api';
import { LoadingRows } from '../../magnus/ui/resource-state';
import { identityFileName } from '../../magnus/pages/agents/ardent/profile/editors';
import { identityHistorySchema } from '../../magnus/pages/agents/ardent/schemas';
import { idempotencyKey } from '../api/client';
import { StudioLink } from '../link';
import { projectHref } from '../routes';
import { commentOnRecord, listDevelopment, listProjectTasks, type Development, type DevelopmentRecord } from './api';
import { DEVELOPMENT_KINDS, filterRecords, kindLabel, shortSha, type DevelopmentWindow } from './logic';
import type { AgentContext } from './page';
import { Loaded, when } from './shared';

const AUTHOR: Record<DevelopmentRecord['author'], string> = { agent: 'The agent', operator: 'An operator', runtime: 'The runtime' };
const PAGE_SIZE = 50;

/** Identity history stays visible when a runtime publishes no development records. */
function IdentityHistory({ context }: { context: AgentContext }) {
  const { nodeId, profileId, agentRef } = context;
  const history = useMagnusResource(async (signal) => {
    const [soul, identity] = await Promise.all([
      readResource(nodeId, profileId, 'identity/soul/history', identityHistorySchema, signal),
      readResource(nodeId, profileId, 'identity/identity/history', identityHistorySchema, signal),
    ]);
    return { soul: soul.history, identity: identity.history };
  }, [agentRef]);
  return (
    <Panel title="Identity history" description="Earlier versions of the identity files. Restore one from the Identity tab." className="min-w-0">
      <Loaded resource={history} title="Identity history could not be read from the node">
        {(data) => (
          <div className="agent-columns">
            {(['soul', 'identity'] as const).map((kind) => (
              <div key={kind} className="grid gap-2">
                <p className="m-0 text-sm font-semibold text-text-strong">{identityFileName(kind)}</p>
                {data[kind].length ? (
                  <ul className="agent-list" aria-label={`${identityFileName(kind)} history`}>
                    {data[kind].map((item) => (
                      <li key={item.name} className="agent-list__row border-t border-border pt-2 text-xs">
                        <span className="break-all font-mono">{item.name}</span>
                        <span className="font-mono text-text-muted">{shortSha(item.revision)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 text-sm text-text-muted">No earlier versions.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Loaded>
    </Panel>
  );
}

function Source({ source, taskLinks }: { source: DevelopmentRecord['sources'][number]; taskLinks: ReadonlyMap<string, string> }) {
  const label = `${source.kind}: ${source.ref}`;
  if (source.kind === 'url' && /^https:\/\//.test(source.ref))
    return (
      <a href={source.ref} target="_blank" rel="noopener noreferrer" className="break-all">
        {source.ref}
      </a>
    );
  const task = source.kind === 'task' ? taskLinks.get(source.ref) : undefined;
  if (task)
    return (
      <StudioLink href={task} className="font-mono">
        {label}
      </StudioLink>
    );
  return <span className="break-all font-mono text-text-muted">{label}</span>;
}

/** Comment, or Discuss with agent: the same note, also written to the agent's own development history. */
function Composer({ context, record, relay, onDone }: { context: AgentContext; record: DevelopmentRecord; relay: boolean; onDone: (comment: DevelopmentRecord['comments'][number], note: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function send() {
    setBusy(true);
    setError('');
    try {
      const answer = await commentOnRecord(context.agentRef, record.id, { body_md: text.trim(), relay_to_agent: relay }, idempotencyKey());
      const note = !relay ? 'Comment added.' : answer.relayed ? 'Comment added and recorded in the agent’s development history, where it reads it.' : `Comment added, but it could not be recorded with the agent: ${answer.relay_error ?? 'no reason given'}.`;
      onDone(answer.comment, note);
    } catch (caught) {
      setError(errorMessage(caught, 'The comment could not be added'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="agent-record__composer mt-3 grid gap-2">
      <Field label={relay ? 'Message to the agent' : 'Comment'} hint={relay ? 'Recorded in the agent’s development history as an operator note.' : 'Visible in Studio only.'}>
        <TextArea value={text} onChange={setText} maxLength={8000} className="agent-record__input" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" loading={busy} disabled={!text.trim()} onClick={() => void send()}>
          {relay ? 'Send to agent' : 'Add comment'}
        </Button>
      </div>
      {error ? <p role="alert" className="m-0 text-sm text-danger">{error}</p> : null}
    </div>
  );
}

function RecordCard({ context, record, taskLinks, onComment }: { context: AgentContext; record: DevelopmentRecord; taskLinks: ReadonlyMap<string, string>; onComment: (comment: DevelopmentRecord['comments'][number]) => void }) {
  const [composer, setComposer] = useState<'comment' | 'discuss' | null>(null);
  const [note, setNote] = useState('');
  return (
    <li className="agent-record panel panel--sm">
      <div className="agent-record__head">
        <Badge tone="info">{kindLabel(record.kind)}</Badge>
        {record.epistemic === 'agent_reported' ? (
          <Badge tone="signal" className="agent-record__reported">
            <Sparkles className="size-3" aria-hidden="true" />
            Agent-reported
          </Badge>
        ) : record.epistemic === 'observed' ? (
          <Badge tone="success">Observed</Badge>
        ) : (
          <Badge>Operator-reported</Badge>
        )}
        <time className="ml-auto text-xs text-text-muted" dateTime={record.created_at}>
          {when(record.created_at)}
        </time>
      </div>
      <h4 className="m-0 mt-2 text-base font-semibold text-text-strong">{record.title}</h4>
      <p className="m-0 text-xs text-text-muted">{AUTHOR[record.author]} wrote this.</p>
      <p className="m-0 mt-2 whitespace-pre-wrap text-sm">{record.body}</p>
      {record.before_sha256 || record.after_sha256 ? (
        <p className="m-0 mt-2 font-mono text-xs text-text-muted">
          Revision {shortSha(record.before_sha256)} → {shortSha(record.after_sha256)}
        </p>
      ) : null}
      {record.sources.length ? (
        <div className="mt-2 text-xs">
          <span className="stat-label">Sources</span>
          <ul className="agent-record__sources">
            {record.sources.map((source, index) => (
              <li key={`${source.kind}:${source.ref}:${index}`}>
                <Source source={source} taskLinks={taskLinks} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {record.comments.length ? (
        <ul className="agent-record__comments mt-3" aria-label="Comments">
          {record.comments.map((comment) => (
            <li key={comment.id} className="rounded-control border border-border bg-surface-sunken p-2 text-sm">
              <p className="m-0 whitespace-pre-wrap">{comment.body_md}</p>
              <p className="m-0 mt-1 text-xs text-text-muted">
                {comment.author} · {when(comment.created_at)}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant={composer === 'comment' ? 'default' : 'ghost'} icon={<MessageSquare className="size-4" />} aria-expanded={composer === 'comment'} onClick={() => setComposer(composer === 'comment' ? null : 'comment')}>
          Comment
        </Button>
        <Button size="sm" variant={composer === 'discuss' ? 'default' : 'ghost'} icon={<Sparkles className="size-4" />} aria-expanded={composer === 'discuss'} onClick={() => setComposer(composer === 'discuss' ? null : 'discuss')}>
          Discuss with agent
        </Button>
      </div>
      {composer ? (
        <Composer
          key={composer}
          context={context}
          record={record}
          relay={composer === 'discuss'}
          onDone={(comment, message) => {
            onComment(comment);
            setNote(message);
            setComposer(null);
          }}
        />
      ) : null}
      {note ? <p role="status" className="m-0 mt-2 text-sm text-success">{note}</p> : null}
    </li>
  );
}

export function DevelopmentTab({ context }: { context: AgentContext }) {
  const { agentRef, projectId } = context;
  const [kind, setKind] = useState('');
  const [scope, setScope] = useState<'project' | 'all'>(projectId ? 'project' : 'all');
  const [period, setPeriod] = useState<DevelopmentWindow>('all');
  const [more, setMore] = useState<{ busy: boolean; error: string }>({ busy: false, error: '' });
  const development = useMagnusResource((signal) => listDevelopment(agentRef, { kind: kind || undefined, limit: PAGE_SIZE }, signal), [agentRef, kind]);
  const tasks = useMagnusResource((signal) => listProjectTasks(projectId!, signal), [projectId], { enabled: Boolean(projectId) });
  const projectTaskIds = useMemo(() => new Set((tasks.data ?? []).map((task) => task.ardent.task_id).filter((id): id is string => Boolean(id))), [tasks.data]);
  const taskLinks = useMemo(() => {
    const links = new Map<string, string>();
    if (projectId) for (const task of tasks.data ?? []) if (task.ardent.task_id && task.conversation_id) links.set(task.ardent.task_id, projectHref(projectId, `/room?c=${encodeURIComponent(task.conversation_id)}&task=${encodeURIComponent(task.id)}`));
    return links;
  }, [tasks.data, projectId]);

  async function loadMore(data: Development) {
    if (!data.next) return;
    setMore({ busy: true, error: '' });
    try {
      const page = await listDevelopment(agentRef, { kind: kind || undefined, limit: PAGE_SIZE, after: data.next });
      development.setData({ ...page, records: [...data.records, ...page.records] });
      setMore({ busy: false, error: '' });
    } catch (caught) {
      setMore({ busy: false, error: errorMessage(caught, 'More records could not be loaded') });
    }
  }

  const kinds = [...new Set([...Object.keys(DEVELOPMENT_KINDS), ...(development.data?.records.map((record) => record.kind) ?? [])])];
  return (
    <div className="page-stack">
      <div className="studio-toolbar" role="group" aria-label="Filter development records">
        <Field label="Kind">
          <Select value={kind} onChange={setKind} options={[{ value: '', label: 'All kinds' }, ...kinds.map((value) => ({ value, label: kindLabel(value) }))]} />
        </Field>
        {projectId ? (
          <Field label="Project">
            <Select value={scope} onChange={(value) => setScope(value as 'project' | 'all')} options={[{ value: 'project', label: 'This project' }, { value: 'all', label: 'All projects and work' }]} />
          </Field>
        ) : null}
        <Field label="Time">
          <Select value={period} onChange={(value) => setPeriod(value as DevelopmentWindow)} options={[{ value: 'all', label: 'Any time' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }]} />
        </Field>
      </div>
      <Loaded resource={development} title="Development records could not be loaded" rows={5}>
        {(data) => {
          if (!data.supported)
            return (
              <>
                <EmptyState framed icon={<History className="size-6" />} title="This runtime doesn't publish development records" message={data.reason ?? 'Upgrade the agent to an Ardent release that publishes them.'} />
                <IdentityHistory context={context} />
              </>
            );
          const projectFilter = scope === 'project' && projectId;
          if (projectFilter && !tasks.data && tasks.loading)
            return (
              <Panel aria-busy="true">
                <LoadingRows rows={3} />
              </Panel>
            );
          const shown = filterRecords(data.records, { taskIds: projectFilter ? projectTaskIds : undefined, window: period });
          return (
            <>
              {shown.length ? (
                <ol className="agent-timeline" aria-label="Development timeline">
                  {shown.map((record) => (
                    <RecordCard
                      key={record.id}
                      context={context}
                      record={record}
                      taskLinks={taskLinks}
                      onComment={(comment) => development.setData({ ...data, records: data.records.map((item) => (item.id === record.id ? { ...item, comments: [...item.comments, comment] } : item)) })}
                    />
                  ))}
                </ol>
              ) : (
                <EmptyState
                  framed
                  icon={<History className="size-6" />}
                  title={data.records.length ? 'No records match these filters' : 'No development records yet'}
                  message={data.records.length ? (projectFilter ? 'Records link to a project through its tasks. Try All projects and work.' : 'Widen the time or kind filter.') : 'The agent records observations, reflections and changes as it works.'}
                />
              )}
              {projectFilter && tasks.error && !tasks.data ? <p className="m-0 text-sm text-warning" role="status">This project&apos;s tasks could not be read, so its records cannot be picked out: {errorMessage(tasks.error)}</p> : null}
              {data.next ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="sm" loading={more.busy} onClick={() => void loadMore(data)}>
                    Load older records
                  </Button>
                  {more.error ? <span role="alert" className="text-sm text-danger">{more.error}</span> : null}
                </div>
              ) : null}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
