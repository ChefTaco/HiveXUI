// The room's task groups and task controls. Pure: the Tasks drawer, the activity strip and the
// avatar popover read the same groups, and the words a control shows follow the task's real state.
import type { Task, TaskControl } from '../api/endpoints';

export const TASK_GROUPS = ['assignments', 'blockers', 'questions', 'reviews', 'outcomes'] as const;
export type TaskGroup = (typeof TASK_GROUPS)[number];
export const TASK_GROUP_LABEL: Record<TaskGroup, string> = {
  assignments: 'Assignments',
  blockers: 'Blockers',
  questions: 'Questions',
  reviews: 'Review requests',
  outcomes: 'Recent outcomes',
};
export const TASK_GROUP_EMPTY: Record<TaskGroup, string> = {
  assignments: 'No agent is working on anything right now.',
  blockers: 'Nothing is blocked or failed.',
  questions: 'No agent is waiting for an answer.',
  reviews: 'No review or revision is in progress.',
  outcomes: 'No task has finished yet.',
};

const ACTIVE: ReadonlySet<Task['state']> = new Set(['queued', 'running', 'pausing', 'paused']);
const DONE: ReadonlySet<Task['state']> = new Set(['completed', 'partial', 'cancelled']);
const RECENT_OUTCOMES = 12;

export const isActive = (task: Task): boolean => ACTIVE.has(task.state) || task.state === 'input_required';
const outcomeOf = (task: Task): string | null => {
  const outcome = task.outcome && typeof task.outcome === 'object' ? (task.outcome as Record<string, unknown>) : {};
  const team = outcome.team_result && typeof outcome.team_result === 'object' ? (outcome.team_result as Record<string, unknown>) : {};
  return typeof team.outcome === 'string' ? team.outcome : null;
};

/** The group a task belongs to, or null for an old outcome the drawer no longer lists. */
export function taskGroup(task: Task): TaskGroup {
  if (task.state === 'input_required') return 'questions';
  if (task.state === 'failed' || task.state === 'unknown' || outcomeOf(task) === 'blocked') return 'blockers';
  if (ACTIVE.has(task.state)) return task.mode === 'review' || task.mode === 'revision' ? 'reviews' : 'assignments';
  return 'outcomes';
}

const newest = (a: Task, b: Task) => (b.updated_at > a.updated_at ? 1 : b.updated_at < a.updated_at ? -1 : 0);

/**
 * Tasks by group. A blocker that was reassigned is resolved, so it leaves the list; outcomes keep the
 * newest dozen.
 */
export function groupTasks(tasks: readonly Task[]): Record<TaskGroup, Task[]> {
  const reassigned = new Set(tasks.map((task) => task.reassigned_from).filter((id): id is string => Boolean(id)));
  const groups: Record<TaskGroup, Task[]> = { assignments: [], blockers: [], questions: [], reviews: [], outcomes: [] };
  for (const task of [...tasks].sort(newest)) {
    const group = taskGroup(task);
    if (group === 'blockers' && reassigned.has(task.id)) continue;
    groups[group].push(task);
  }
  groups.outcomes = groups.outcomes.filter((task) => DONE.has(task.state)).slice(0, RECENT_OUTCOMES);
  return groups;
}

/** Which controls a task offers in its current state. */
export function taskControls(task: Task): { pause: boolean; resume: boolean; cancel: boolean; reassign: boolean } {
  const active = isActive(task);
  return {
    pause: task.state === 'queued' || task.state === 'running',
    resume: task.state === 'paused' || task.state === 'pausing',
    cancel: active,
    reassign: active || task.state === 'failed' || task.state === 'unknown',
  };
}

export const TASK_STATE_LABEL: Record<Task['state'], string> = {
  queued: 'Queued',
  running: 'Running',
  input_required: 'Waiting for an answer',
  pausing: 'Pause requested…',
  paused: 'Paused',
  completed: 'Completed',
  partial: 'Partly completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  unknown: 'Unknown',
};

/**
 * The words a control shows after a person used it: requested until the task's own state confirms
 * it, then the confirmed state. Null once there is nothing to say beyond the task's state.
 */
export function controlFeedback(requested: TaskControl | null, state: Task['state']): string | null {
  switch (requested) {
    case 'pause':
      if (state === 'paused') return 'Paused';
      return state === 'queued' || state === 'running' || state === 'pausing' ? 'Pause requested…' : null;
    case 'resume':
      if (state === 'paused' || state === 'pausing') return 'Resume requested…';
      return state === 'running' || state === 'queued' ? 'Resumed' : null;
    case 'cancel':
      if (state === 'cancelled') return 'Cancelled';
      return isActive({ state } as Task) ? 'Cancel requested…' : null;
    default:
      return state === 'pausing' ? 'Pause requested…' : null;
  }
}
