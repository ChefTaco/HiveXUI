// Tasks as the room lists them: grouped like the activity strip, each with its revision, source and
// deliverables and the controls its state allows. A control says what it asked for until the task's
// own state confirms it: "Pause requested…", then "Paused".
import { useId, useState } from 'react';
import { Pause, Play, Repeat, Square } from 'lucide-react';
import { Badge, Button, ConfirmDialog, EmptyState, type Tone } from '@ui';
import { cn } from '@lib/cn';
import { errorMessage } from '../../magnus/api/errors';
import { idempotencyKey } from '../api/client';
import { controlTask, reassignTask, type Deliverable, type Task, type TaskControl } from '../api/endpoints';
import type { ProjectStore } from '../state/project-store';
import type { Role } from './addressing';
import { controlFeedback, groupTasks, TASK_GROUP_EMPTY, TASK_GROUP_LABEL, TASK_GROUPS, TASK_STATE_LABEL, taskControls, type TaskGroup } from './tasks';

const TONE: Partial<Record<Task['state'], Tone>> = { running: 'info', completed: 'success', partial: 'warning', failed: 'danger', input_required: 'warning' };

function sourceText(task: Task, roles: readonly Role[], tasks: ReadonlyMap<string, Task>): string | null {
  const source = task.source;
  const role = (key: unknown) => (typeof key === 'string' ? (roles.find((item) => item.key === key)?.name ?? key) : null);
  if (task.reassigned_from) return `Reassigned from ${tasks.get(task.reassigned_from)?.title ?? 'an earlier task'}`;
  if (source.handoff_from) return `Hand-off from ${role(source.handoff_from)}`;
  if (source.answer_to) return 'Continues after an answer';
  if (source.follow_up_of) return 'Follow-up on a message';
  if (task.mode === 'discussion_turn') return 'Discussion turn';
  if (task.trigger_message_id) return 'From a room message';
  if (task.created_by && task.created_by !== 'conductor') return `Created by ${task.created_by}`;
  return null;
}

export interface TaskRowProps {
  task: Task;
  store: ProjectStore;
  roles: readonly Role[];
  tasks: ReadonlyMap<string, Task>;
  deliverables: readonly Deliverable[];
  archived: boolean;
  highlight?: boolean;
  onOpenMessage?: ((messageId: string, conversationId: string | null) => void) | undefined;
}

/** One task with its controls. */
export function TaskRow({ task, store, roles, tasks, deliverables, archived, highlight, onOpenMessage }: TaskRowProps) {
  const [requested, setRequested] = useState<TaskControl | null>(null);
  const [busy, setBusy] = useState<TaskControl | 'reassign' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [target, setTarget] = useState('');
  const selectId = useId();
  const controls = taskControls(task);
  const role = roles.find((item) => item.key === task.role_key);
  const feedback = controlFeedback(requested, task.state);
  const produced = deliverables.flatMap((deliverable) => deliverable.revisions.filter((revision) => revision.source_task_id === task.id).map((revision) => `${deliverable.name} rev ${revision.revision}`));
  const source = sourceText(task, roles, tasks);
  const others = roles.filter((item) => item.agent_ref && item.key !== task.role_key);

  async function control(kind: TaskControl) {
    setBusy(kind);
    setError(null);
    setRequested(kind);
    try {
      store.upsertRecord('tasks', await controlTask(task.id, kind, idempotencyKey()));
    } catch (failure) {
      setRequested(null);
      setError(errorMessage(failure, `The task could not be ${kind === 'pause' ? 'paused' : kind === 'resume' ? 'resumed' : 'cancelled'}`));
    } finally {
      setBusy(null);
      setConfirmCancel(false);
    }
  }
  async function reassign() {
    if (!target) return;
    setBusy('reassign');
    setError(null);
    try {
      store.upsertRecord('tasks', await reassignTask(task.id, target, idempotencyKey()));
      setReassigning(false);
    } catch (failure) {
      setError(errorMessage(failure, 'The task could not be reassigned'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className={cn('room-task rounded-control border bg-surface-raised', highlight ? 'border-accent' : 'border-border')} data-task={task.id} tabIndex={-1}>
      <div className="room-task__head">
        <span className="room-task__title text-sm text-text-strong">{task.title}</span>
        <Badge tone={TONE[task.state] ?? 'neutral'}>{TASK_STATE_LABEL[task.state]}</Badge>
      </div>
      <p className="room-task__meta m-0 text-xs text-text-muted">
        {[role?.name ?? task.role_key ?? 'No role', task.mode.replace('_', ' '), task.assignment_revision ? `team r${task.assignment_revision}` : null, source].filter(Boolean).join(' · ')}
      </p>
      {produced.length ? <p className="m-0 text-xs text-text">{`Delivered: ${produced.join(', ')}`}</p> : null}
      {task.trigger_message_id && onOpenMessage ? (
        <button type="button" className="room-link text-xs text-accent" onClick={() => onOpenMessage(task.trigger_message_id!, task.conversation_id)}>
          Open the message that started it
        </button>
      ) : null}
      {feedback ? (
        <p className="m-0 text-xs text-text" role="status">
          {feedback}
        </p>
      ) : null}
      {error ? (
        <p className="m-0 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {!archived && (controls.pause || controls.resume || controls.cancel || controls.reassign) ? (
        <div className="room-task__controls">
          {controls.pause ? (
            <Button size="sm" variant="ghost" icon={<Pause className="btn-ico" aria-hidden="true" />} loading={busy === 'pause'} onClick={() => void control('pause')} aria-label={`Pause ${task.title}`}>
              Pause
            </Button>
          ) : null}
          {controls.resume ? (
            <Button size="sm" variant="ghost" icon={<Play className="btn-ico" aria-hidden="true" />} loading={busy === 'resume'} onClick={() => void control('resume')} aria-label={`Resume ${task.title}`}>
              Resume
            </Button>
          ) : null}
          {controls.cancel ? (
            <Button size="sm" variant="ghost" icon={<Square className="btn-ico" aria-hidden="true" />} loading={busy === 'cancel'} onClick={() => setConfirmCancel(true)} aria-label={`Cancel ${task.title}`}>
              Cancel
            </Button>
          ) : null}
          {controls.reassign && others.length ? (
            <Button size="sm" variant="ghost" icon={<Repeat className="btn-ico" aria-hidden="true" />} aria-expanded={reassigning} onClick={() => setReassigning((value) => !value)} aria-label={`Reassign ${task.title}`}>
              Reassign
            </Button>
          ) : null}
        </div>
      ) : null}
      {reassigning ? (
        <div className="room-task__reassign">
          <label className="field" htmlFor={selectId}>
            <span className="field-label">Give this work to</span>
            <select id={selectId} value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">Choose a role</option>
              {others.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="primary" disabled={!target} loading={busy === 'reassign'} onClick={() => void reassign()}>
            Reassign
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmCancel}
        title={`Cancel ${task.title}?`}
        message="The agent stops at its next step. What it already delivered stays in the project."
        confirmLabel="Cancel task"
        tone="warning"
        loading={busy === 'cancel'}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => void control('cancel')}
      />
    </li>
  );
}

export interface TaskGroupsProps extends Omit<TaskRowProps, 'task' | 'highlight' | 'tasks'> {
  tasks: readonly Task[];
  focus?: TaskGroup | null;
  highlightTask?: string | null;
  error?: unknown;
  onRetry?: () => void;
}

/** The Tasks drawer body: every group, the focused one first. */
export function TaskGroups({ tasks, focus, highlightTask, error, onRetry, ...row }: TaskGroupsProps) {
  const groups = groupTasks(tasks);
  const byId = new Map(tasks.map((task) => [task.id, task] as const));
  const order = focus ? [focus, ...TASK_GROUPS.filter((group) => group !== focus)] : TASK_GROUPS;
  return (
    <div className="room-task-groups">
      {error ? (
        <EmptyState compact tone="warning" title="Older tasks could not be read" message="Live tasks are shown; finished ones may be missing." action={onRetry ? <Button size="sm" onClick={onRetry}>Retry</Button> : undefined} />
      ) : null}
      {order.map((group) => (
        <section key={group} className="room-task-group" aria-labelledby={`tasks-${group}`}>
          <h4 id={`tasks-${group}`} className="room-task-group__title stat-label">
            {TASK_GROUP_LABEL[group]}
            <span className="tab-count">{groups[group].length}</span>
          </h4>
          {groups[group].length ? (
            <ul className="room-task-list">
              {groups[group].map((task) => (
                <TaskRow key={task.id} task={task} tasks={byId} highlight={task.id === highlightTask} {...row} />
              ))}
            </ul>
          ) : (
            <p className="m-0 text-sm text-text-muted">{TASK_GROUP_EMPTY[group]}</p>
          )}
        </section>
      ))}
    </div>
  );
}

/** The strip under the room: one count per group, each opening the Tasks drawer there. */
export function ActivityStrip({ tasks, decisions, onOpen, onDecisions }: { tasks: readonly Task[]; decisions: number; onOpen: (group: TaskGroup) => void; onDecisions: () => void }) {
  const groups = groupTasks(tasks);
  return (
    <nav className="room-strip rounded-control border border-border bg-surface" aria-label="Activity">
      {TASK_GROUPS.map((group) => (
        <button key={group} type="button" className={cn('room-strip__item text-sm hover:text-text', group === 'blockers' && groups.blockers.length ? 'text-danger' : group === 'questions' && groups.questions.length ? 'text-warning' : 'text-text-muted')} onClick={() => onOpen(group)}>
          {TASK_GROUP_LABEL[group]}
          {group !== 'outcomes' ? <span className="room-strip__count data-figure text-text-strong">{groups[group].length}</span> : null}
        </button>
      ))}
      <button type="button" className="room-strip__item text-sm text-text-muted hover:text-text" onClick={onDecisions}>
        Decisions
        <span className="room-strip__count data-figure text-text-strong">{decisions}</span>
      </button>
    </nav>
  );
}
