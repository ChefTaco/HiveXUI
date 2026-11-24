// Workflow runs in the room: each node of a branch-and-join workflow with what it needs, why it is
// waiting or blocked, and the actions Studio offers for it now (retry, skip, cancel the run). Live
// from the project stream; a node's task opens in the lineage drawer.
import { useRef, useState } from 'react';
import { Workflow } from 'lucide-react';
import { Badge, Button, ConfirmDialog, EmptyState, LoadingRows, ResourceError, type Tone } from '@ui';
import { errorMessage } from '../../../magnus/api/errors';
import { idempotencyKey } from '../../api/client';
import { workflowNodeAction, type WorkflowAction, type WorkflowNode, type WorkflowRun } from '../../api/execution';
import type { Role } from '../addressing';
import type { WorkflowsState } from './use-workflows';

export const RUN_STATE: Record<WorkflowRun['state'], { label: string; tone: Tone }> = {
  running: { label: 'Running', tone: 'info' },
  blocked: { label: 'Blocked', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};
export const NODE_STATE: Record<WorkflowNode['state'], { label: string; tone: Tone }> = {
  waiting: { label: 'Waiting', tone: 'neutral' },
  ready: { label: 'Ready', tone: 'info' },
  running: { label: 'Running', tone: 'info' },
  done: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  blocked: { label: 'Blocked', tone: 'warning' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};
const ACTION: Record<WorkflowAction, { label: string; confirm?: { title: string; message: string; label: string } }> = {
  retry: { label: 'Retry' },
  skip: { label: 'Skip', confirm: { title: 'Skip this step?', message: 'The step is not required, so the steps after it go on without its result. A task it is running is cancelled.', label: 'Skip step' } },
  cancel_run: { label: 'Cancel run', confirm: { title: 'Cancel this workflow run?', message: 'Every step still running is cancelled, and nothing more starts. Results already delivered stay in the project.', label: 'Cancel run' } },
};

/** Why a node has not started: the needs that are not done yet, or what blocks it. Null when nothing holds it. */
export function waitingReason(node: WorkflowNode, run: WorkflowRun): string | null {
  const title = (key: string) => run.nodes.find((item) => item.key === key)?.title || key;
  if (node.state === 'blocked') return node.blocked_by.length ? `Blocked by ${node.blocked_by.map(title).join(', ')}` : 'Blocked';
  if (node.state !== 'waiting') return null;
  const open = node.needs.filter((key) => {
    const need = run.nodes.find((item) => item.key === key);
    return need && need.state !== 'done' && need.state !== 'skipped';
  });
  return open.length ? `Waiting for ${open.map(title).join(', ')}` : 'Waiting to start';
}

export interface WorkflowPanelProps {
  projectId: string;
  state: WorkflowsState;
  roles: readonly Role[];
  archived: boolean;
  onRetry: () => void;
  onChanged: (run: WorkflowRun) => void;
  onOpenTask?: ((taskId: string) => void) | undefined;
  act?: typeof workflowNodeAction;
}

export function WorkflowPanel({ projectId, state, roles, archived, onRetry, onChanged, onOpenTask, act = workflowNodeAction }: WorkflowPanelProps) {
  const [asking, setAsking] = useState<{ run: WorkflowRun; node: WorkflowNode; action: WorkflowAction } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ node: string; message: string } | null>(null);
  const keys = useRef(new Map<string, string>());
  if (state.status === 'loading') return <LoadingRows rows={3} />;
  if (state.status === 'unsupported') return <EmptyState compact title="Workflows need a newer Studio" message="Ardent Project Studio 0.5.0 or later runs branch-and-join workflows." />;
  if (state.status === 'error') return <ResourceError error={state.error} title="Workflow runs could not be read" onRetry={onRetry} />;
  if (!state.runs.length) return <EmptyState compact icon={<Workflow className="size-5" />} title="No workflow has run in this project" message="A team template or the API starts one; each step then runs as an ordinary task of its role." />;

  async function run(target: { run: WorkflowRun; node: WorkflowNode; action: WorkflowAction }) {
    const id = `${target.run.id}:${target.node.key}:${target.action}:${target.node.attempt}`;
    let key = keys.current.get(id);
    if (!key) {
      key = idempotencyKey();
      keys.current.set(id, key);
    }
    setBusy(id);
    setError(null);
    try {
      onChanged(await act(projectId, target.run.id, target.node.key, target.action, key));
      keys.current.delete(id);
      setAsking(null);
    } catch (failure) {
      setError({ node: `${target.run.id}:${target.node.key}`, message: errorMessage(failure, `${ACTION[target.action].label} did not go through`) });
    } finally {
      setBusy(null);
    }
  }
  const roleName = (key: string) => roles.find((role) => role.key === key)?.name ?? key;
  return (
    <div className="room-workflows grid gap-4">
      {state.runs.map((item) => (
        <section key={item.id} className="room-workflow rounded-control border border-border bg-surface-raised p-3" aria-labelledby={`workflow-${item.id}`} data-workflow={item.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 id={`workflow-${item.id}`} className="m-0 text-sm font-semibold text-text-strong">
              {item.name ?? item.source_template?.workflow ?? 'Workflow'}
            </h4>
            <Badge tone={RUN_STATE[item.state].tone}>{RUN_STATE[item.state].label}</Badge>
          </div>
          <ol className="m-0 mt-2 grid gap-2 p-0" aria-label="Steps">
            {item.nodes.map((node) => {
              const reason = waitingReason(node, item);
              const nodeError = error?.node === `${item.id}:${node.key}` ? error.message : null;
              return (
                <li key={node.key} className="list-none rounded-control border border-border bg-surface-sunken p-2" data-node={node.key}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-text-strong">
                      {node.title || node.key}
                      {item.output === node.key ? <span className="ml-2 text-xs text-text-muted">result</span> : null}
                    </span>
                    <Badge tone={NODE_STATE[node.state].tone}>{NODE_STATE[node.state].label}</Badge>
                  </div>
                  <p className="m-0 text-xs text-text-muted">
                    {[roleName(node.role), node.attempt > 1 ? `attempt ${node.attempt}` : null, node.needs.length ? `needs ${node.needs.map((key) => item.nodes.find((other) => other.key === key)?.title || key).join(', ')}` : null, node.required ? null : 'optional'].filter(Boolean).join(' · ')}
                  </p>
                  {reason ? <p className="m-0 text-xs text-text">{reason}</p> : null}
                  {node.error ? <p className="m-0 text-xs text-danger">{node.error}</p> : null}
                  {nodeError ? (
                    <p className="m-0 text-xs text-danger" role="alert">
                      {nodeError}
                    </p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap gap-2">
                    {node.task_id && onOpenTask ? (
                      <Button size="sm" variant="ghost" onClick={() => onOpenTask(node.task_id!)} aria-label={`Execution history of ${node.title || node.key}`}>
                        History
                      </Button>
                    ) : null}
                    {!archived
                      ? node.actions.map((action) => {
                          const target = { run: item, node, action };
                          const id = `${item.id}:${node.key}:${action}:${node.attempt}`;
                          return (
                            <Button key={action} size="sm" variant={action === 'cancel_run' ? 'warning' : 'default'} loading={busy === id} onClick={() => (ACTION[action].confirm ? setAsking(target) : void run(target))} aria-label={`${ACTION[action].label}: ${node.title || node.key}`}>
                              {ACTION[action].label}
                            </Button>
                          );
                        })
                      : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      <ConfirmDialog
        open={asking !== null}
        title={asking ? ACTION[asking.action].confirm?.title ?? '' : ''}
        message={asking ? ACTION[asking.action].confirm?.message ?? '' : ''}
        confirmLabel={asking ? ACTION[asking.action].confirm?.label ?? '' : ''}
        tone="warning"
        loading={busy !== null}
        onCancel={() => setAsking(null)}
        onConfirm={() => asking && void run(asking)}
      />
    </div>
  );
}
