// The lineage drawer: one Studio task followed from the request that started it, through hand-offs
// and the agents that ran it, to each model attempt (with its Emberpath trace), each tool call and each
// artifact, with its recovery when a restart interrupted it. Older tasks still render: without any
// recorded ancestry the drawer says so.
import { useId, type ReactNode } from 'react';
import { GitBranch, History } from 'lucide-react';
import { Badge, Button, Drawer, EmptyState, LoadingRows, ResourceError } from '@ui';
import { formatBytes } from '../../projects/logic';
import { linkTo } from '../../../../lib/routes';
import { traceOutcome } from '../../../agents/trace-outcome';
import type { Task } from '../../api/endpoints';
import type { ArdentAttempt } from '../../api/execution';
import { StudioLink } from '../../link';
import type { ProjectStore } from '../../state/project-store';
import { taskChip } from '../tasks';
import { buildChain, chainKindLabel, describeRef, formatUsage, hasExecutionHistory, toolState } from './logic';
import { RecoveryPanel } from './recovery-panel';
import { useAttemptTraces, useTaskLineage, type TraceState } from './use-lineage';

export interface LineageDrawerProps {
  /** The task to show; null closes the drawer. */
  taskId: string | null;
  tasks: ReadonlyMap<string, Task>;
  store: ProjectStore;
  archived: boolean;
  eyebrow?: string | undefined;
  onClose: () => void;
  /** Follow the chain to another task of the project. */
  onOpenTask: (taskId: string) => void;
}

export function LineageDrawer({ taskId, tasks, store, archived, eyebrow, onClose, onOpenTask }: LineageDrawerProps) {
  const task = taskId ? tasks.get(taskId) : undefined;
  return (
    <Drawer open={taskId !== null} title={task ? `Execution history: ${task.title}` : 'Execution history'} {...(eyebrow ? { eyebrow } : {})} onClose={onClose}>
      {task ? <LineageBody task={task} tasks={tasks} store={store} archived={archived} onOpenTask={onOpenTask} /> : <EmptyState compact title="This task is not in this project" message="It may have been removed, or the link names a task of another project." />}
    </Drawer>
  );
}

function LineageBody({ task, tasks, store, archived, onOpenTask }: { task: Task; tasks: ReadonlyMap<string, Task>; store: ProjectStore; archived: boolean; onOpenTask: (taskId: string) => void }) {
  const { state, reload } = useTaskLineage(store, task.id);
  const traces = useAttemptTraces(state.lineage);
  const chip = taskChip(task);
  const lineage = state.lineage;
  const chain = buildChain(task, lineage, tasks);
  const history = hasExecutionHistory(task, lineage);
  return (
    <div className="room-lineage grid gap-4" data-lineage={task.id}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={chip.tone}>{chip.label}</Badge>
        {state.status === 'loading' && lineage ? (
          <span className="text-xs text-text-muted" role="status">
            Refreshing…
          </span>
        ) : null}
      </div>
      <RecoveryPanel task={task} archived={archived} onDecided={() => reload()} />
      {state.status === 'loading' && !lineage ? (
        <LoadingRows rows={4} />
      ) : state.status === 'error' && !lineage ? (
        <ResourceError error={state.error} title="The execution history could not be read" onRetry={reload} />
      ) : (
        <>
          <section aria-labelledby={`chain-${task.id}`}>
            <h4 id={`chain-${task.id}`} className="room-task-group__title stat-label">
              Chain
            </h4>
            <ol className="room-lineage__chain m-0 grid gap-2 p-0" aria-label="Execution chain">
              {chain.map((entry) => (
                <li key={entry.key} className={`room-lineage__step room-lineage__step--${entry.kind} rounded-control border border-border bg-surface-raised p-2`} aria-current={entry.kind === 'self' ? 'step' : undefined}>
                  <span className="block text-xs text-text-muted">{chainKindLabel(entry.kind)}</span>
                  {entry.taskId && entry.taskId !== task.id ? (
                    <button type="button" className="room-link text-left text-sm text-accent" onClick={() => onOpenTask(entry.taskId!)}>
                      {entry.label}
                    </button>
                  ) : (
                    <span className="text-sm text-text-strong">{entry.label}</span>
                  )}
                  {entry.state ? <span className="ml-2 text-xs text-text-muted">{entry.state}</span> : null}
                  {entry.ref ? (
                    <span className="block break-all font-mono text-xs text-text-muted" title={entry.ref}>
                      {entry.ref}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
          {!history ? (
            <EmptyState
              compact
              icon={<History className="size-5" />}
              title="No execution history recorded"
              message={
                state.status === 'unsupported'
                  ? 'This Studio release does not record execution history. The task itself is shown above.'
                  : 'This task ran before Studio and its agents recorded execution ancestry, so only what the task record says is shown.'
              }
            />
          ) : null}
          {lineage?.ardentUnavailable ? <p className="m-0 text-sm text-text-muted">{`Agent history unavailable: ${lineage.ardentUnavailable}`}</p> : null}
          {lineage?.ardent.map((attempt, index) => (
            <AttemptSection key={`${attempt.ardentTaskId}:${index}`} attempt={attempt} index={index} count={lineage.ardent.length} traces={traces} />
          ))}
          {lineage?.executionRoot ? (
            <p className="m-0 text-xs text-text-muted">
              Provider traffic of the whole request is filtered in Emberpath by its root, <span className="break-all font-mono">{lineage.executionRoot}</span>.
            </p>
          ) : null}
          {state.status === 'error' && lineage ? (
            <p className="m-0 text-xs text-warning" role="alert">
              The last refresh failed; this is the history read before it.{' '}
              <Button size="sm" variant="ghost" onClick={reload}>
                Retry
              </Button>
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function Collapsible({ title, count, children, open = false }: { title: string; count: number; children: ReactNode; open?: boolean }) {
  return (
    <details className="room-lineage__section rounded-control border border-border" open={open}>
      <summary className="cursor-pointer px-2 py-1 text-sm font-medium">
        {title} <span className="tab-count">{count}</span>
      </summary>
      <div className="px-2 pb-2">{children}</div>
    </details>
  );
}

function AttemptSection({ attempt: entry, index, count, traces }: { attempt: ArdentAttempt; index: number; count: number; traces: TraceState }) {
  const headingId = useId();
  const latest = entry.current || index === count - 1;
  const heading = (
    <h4 id={headingId} className="m-0 flex flex-wrap items-center gap-2 text-sm font-semibold text-text-strong">
      <GitBranch className="size-4" aria-hidden="true" />
      {count > 1 ? `Agent attempt ${index + 1} of ${count}${entry.current ? ' (current)' : ''}` : 'Agent run'}
      <span className="break-all font-mono text-xs font-normal text-text-muted">{entry.ref ? describeRef(entry.ref) : `Ardent task ${entry.ardentTaskId}`}</span>
    </h4>
  );
  const attempt = entry.lineage;
  if (!attempt)
    return (
      <section className="grid gap-2" aria-labelledby={headingId}>
        {heading}
        <p className="m-0 text-xs text-text-muted">{`This attempt's history could not be read${entry.error ? `: ${entry.error}` : '.'}`}</p>
      </section>
    );
  return (
    <section className="grid gap-2" aria-labelledby={headingId}>
      {heading}
      <Collapsible title="Model attempts" count={attempt.model_attempts.length} open={latest}>
        {attempt.model_attempts.length ? (
          <ul className="m-0 grid gap-2 p-0" aria-label="Model attempts">
            {attempt.model_attempts.map((item) => {
              const found = traces.status === 'ready' && item.ref ? traces.byRef.get(item.ref) ?? [] : [];
              const usage = formatUsage(item.usage);
              return (
                <li key={`${item.step}:${item.attempt}:${item.started_ms}`} className="list-none text-xs">
                  <span className="font-medium">{`Step ${item.step}, attempt ${item.attempt}`}</span>
                  {item.backend ? ` · ${item.backend}` : ''}
                  {item.repair ? ' · repair' : ''}
                  {usage ? ` · ${usage}` : ''}
                  {found.map((trace) => {
                    const outcome = traceOutcome(trace.outcome);
                    return (
                      <span key={trace.id} className="ml-1 inline-flex flex-wrap items-center gap-1">
                        <Badge tone={outcome.tone}>{outcome.label}</Badge>
                        {trace.provider?.name ?? trace.providerId ?? null}
                        {trace.attempts && trace.attempts.length > 1 ? ` · ${trace.attempts.length} provider attempts${trace.attempts.some((step) => step.failover) ? ', failover' : ''}` : ''}
                        <StudioLink href={linkTo('emberpath', 'traces', { trace: trace.id })}>Emberpath trace</StudioLink>
                      </span>
                    );
                  })}
                  {!found.length && item.request_id ? <span className="ml-1 font-mono text-text-muted">{`request ${item.request_id}`}</span> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="m-0 text-xs text-text-muted">No model call recorded.</p>
        )}
        {traces.status === 'unsupported' ? <p className="m-0 mt-1 text-xs text-text-muted">Emberpath 2.6.0 or later links provider traces to these attempts.</p> : null}
        {traces.status === 'unavailable' ? <p className="m-0 mt-1 text-xs text-text-muted">Emberpath traces could not be read with this sign-in.</p> : null}
      </Collapsible>
      <Collapsible title="Tools" count={attempt.tools.length}>
        {attempt.tools.length ? (
          <ul className="m-0 grid gap-1 p-0" aria-label="Tool calls">
            {attempt.tools.map((tool) => {
              const shown = toolState(tool.state);
              return (
                <li key={tool.call_id} className="flex list-none flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono">{tool.name || tool.call_id}</span>
                  {tool.effect ? <span className="text-text-muted">{`effect ${tool.effect}`}</span> : null}
                  <Badge tone={shown.tone}>{shown.label}</Badge>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="m-0 text-xs text-text-muted">No tool call recorded.</p>
        )}
      </Collapsible>
      <Collapsible title="Artifacts" count={attempt.artifacts.length}>
        {attempt.artifacts.length ? (
          <ul className="m-0 grid gap-1 p-0" aria-label="Artifacts">
            {attempt.artifacts.map((artifact) => (
              <li key={artifact.sha256} className="list-none text-xs">
                <span className="font-medium">{artifact.name || artifact.sha256.slice(0, 12)}</span>
                {artifact.mime ? ` · ${artifact.mime}` : ''}
                {artifact.size !== null ? ` · ${formatBytes(artifact.size)}` : ''}
                {artifact.rendition_of ? ` · rendition of ${artifact.rendition_of.slice(0, 12)}` : ''}
                {artifact.schema_version ? ` · manifest ${artifact.schema_version}` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-xs text-text-muted">No artifact registered.</p>
        )}
      </Collapsible>
    </section>
  );
}
