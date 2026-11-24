// The lineage drawer and recovery panel without the DOM: the causal chain a task sits in, what each
// recovery action does, and how Emberpath provider traces line up with Ardent model attempts.
import { parseExecutionRef } from '@hivemagnus/hive-common/execution';
import type { Tone } from '@ui';
import type { Task } from '../../api/endpoints';
import type { ArdentAttempt, RecoveryAction, Related, TaskLineage, TaskRecovery } from '../../api/execution';
import { TASK_STATE_LABEL } from '../tasks';

export const RECOVERY_STATUS_LABEL: Record<TaskRecovery['status'], string> = {
  ready: 'Ready to resume',
  reconciling: 'Checking an interrupted call',
  resumed: 'Resumed',
  awaiting_decision: 'Needs a decision',
  unsupported: 'Cannot resume',
  resolved: 'Decided',
};

/**
 * What each decision does, said before it is made. Ardent never repeats an external effect on its own:
 * the decision is the person's statement of what happened, and the continuation acts on it.
 */
export const RECOVERY_ACTION_COPY: Record<RecoveryAction, { label: string; title: string; message: string; confirm: string; tone: 'primary' | 'warning' | 'danger' }> = {
  mark_applied: {
    label: 'It applied',
    title: 'Confirm the interrupted call took effect?',
    message:
      'Use this when you checked the outside system and the call did happen. The work continues as a linked continuation from the last checkpoint, with the call recorded as applied. It is not run again.',
    confirm: 'It applied',
    tone: 'primary',
  },
  mark_not_applied: {
    label: 'It did not apply',
    title: 'Confirm the interrupted call had no effect?',
    message:
      'Use this when you checked the outside system and the call did not happen. The work continues as a linked continuation, with the call recorded as not applied. It is not retried: the agent decides what to do next. If it did apply after all, the work may be done twice.',
    confirm: 'It did not apply',
    tone: 'warning',
  },
  retry_with_new_deadline: {
    label: 'Retry with a new deadline',
    title: 'Continue with a new deadline?',
    message:
      'The work continues as a linked continuation with a fresh deadline, and any interrupted call is sent again under its original idempotency key. Choose this only if repeating that call is safe.',
    confirm: 'Retry',
    tone: 'warning',
  },
  abandon: {
    label: 'Abandon',
    title: 'Abandon this work?',
    message: 'Only your decision is recorded. The task stays with an unknown outcome and nothing runs again. Reassign the task to start the work over.',
    confirm: 'Abandon',
    tone: 'danger',
  },
};

export const TOOL_STATE_LABEL: Record<string, { label: string; tone: Tone }> = {
  attempted: { label: 'Outcome unknown', tone: 'warning' },
  failed_unknown: { label: 'Failed, effect unknown', tone: 'warning' },
  succeeded: { label: 'Succeeded', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  denied: { label: 'Denied', tone: 'danger' },
  not_dispatched: { label: 'Not dispatched', tone: 'neutral' },
};
export const toolState = (state: string): { label: string; tone: Tone } => TOOL_STATE_LABEL[state] ?? { label: state.replaceAll('_', ' '), tone: 'neutral' };

/** A short, readable form of a qualified reference: its product, kind and id. */
export function describeRef(ref: string): string {
  const parts = parseExecutionRef(ref);
  if (!parts) return ref;
  const product = parts.product === 'studio' ? 'Studio' : parts.product === 'ardent' ? `Ardent ${parts.instance}` : parts.product.charAt(0).toUpperCase() + parts.product.slice(1);
  return `${product} ${parts.kind} ${parts.id}`;
}
/** The local Studio task id a reference names, when it is a Studio task. */
export function studioTaskOf(ref: string | undefined): string | undefined {
  const parts = ref ? parseExecutionRef(ref) : undefined;
  return parts?.product === 'studio' && parts.kind === 'task' ? parts.id : undefined;
}

export type ChainKind = 'root' | 'parent' | 'reassigned' | 'handoff' | 'workflow' | 'input' | 'self' | 'continuation' | 'handoff_to' | 'reassigned_to' | 'child';
export interface ChainEntry {
  key: string;
  kind: ChainKind;
  label: string;
  /** A Studio task this entry opens in the drawer, when it is one this project lists. */
  taskId?: string | undefined;
  ref?: string | undefined;
  state?: string | undefined;
}
const KIND_LABEL: Record<ChainKind, string> = {
  root: 'Originating request',
  parent: 'Caused by',
  reassigned: 'Reassigned from',
  handoff: 'Hand-off from',
  workflow: 'Workflow step',
  input: 'Input',
  self: 'This task',
  continuation: 'Continued by',
  handoff_to: 'Handed off to',
  reassigned_to: 'Reassigned to',
  child: 'Started',
};
export const chainKindLabel = (kind: ChainKind): string => KIND_LABEL[kind];

/**
 * The vertical chain: the root request, the tasks above this one, this task, then what it started and
 * what continued it. Studio's own records come first; Ardent adds the child and continuation tasks it
 * ran under each attempt.
 */
export function buildChain(task: Task, lineage: TaskLineage | null, tasks: ReadonlyMap<string, Task>): ChainEntry[] {
  const entries: ChainEntry[] = [];
  const seen = new Set<string>();
  const add = (kind: ChainKind, related: Related | null | undefined) => {
    if (!related) return;
    const taskId = related.taskId ?? studioTaskOf(related.ref);
    const key = `${kind}:${related.ref ?? taskId ?? related.title}`;
    if (seen.has(key)) return;
    seen.add(key);
    const known = taskId ? tasks.get(taskId) : undefined;
    entries.push({
      key,
      kind,
      label: known?.title ?? related.title ?? (related.ref ? describeRef(related.ref) : `Task ${taskId ?? ''}`.trim()),
      taskId: known ? taskId : undefined,
      ref: related.ref,
      state: known ? TASK_STATE_LABEL[known.state] : related.state,
    });
  };
  const studio = lineage?.studio;
  const rootRef = studio?.root ?? task.execution?.root;
  const selfRef = studio?.self ?? task.execution?.self;
  if (rootRef && rootRef !== selfRef) add('root', { ref: rootRef });
  const parentRef = studio?.parent ?? task.execution?.parent;
  if (parentRef && parentRef !== rootRef) add('parent', { ref: parentRef });
  add('reassigned', studio?.reassignedFrom ?? (task.reassigned_from ? { taskId: task.reassigned_from } : null));
  for (const item of studio?.handoffs ?? []) if (item.direction === 'from') add('handoff', item);
  if (studio?.workflow) add('workflow', { ref: studio.workflow.ref ?? undefined, taskId: undefined, title: `Workflow step ${studio.workflow.node_key}${studio.workflow.attempt > 1 ? `, attempt ${studio.workflow.attempt}` : ''}` });
  for (const ref of task.execution?.inputs ?? []) add('input', { ref });
  entries.push({ key: 'self', kind: 'self', label: task.title, state: TASK_STATE_LABEL[task.state], ref: selfRef ?? undefined });
  for (const attempt of lineage?.ardent ?? []) for (const item of attempt.lineage?.continuations ?? []) add('continuation', { ref: item.ref, kind: item.source });
  for (const item of studio?.handoffs ?? []) if (item.direction === 'to') add('handoff_to', item);
  for (const item of studio?.reassignedTo ?? []) add('reassigned_to', item);
  for (const item of studio?.children ?? []) add('child', item);
  for (const attempt of lineage?.ardent ?? []) for (const item of attempt.lineage?.children ?? []) add('child', { ref: item.ref, kind: item.source });
  return entries;
}

/** Whether there is anything to show beyond the task itself. Tasks from before ancestry have nothing. */
export function hasExecutionHistory(task: Task, lineage: TaskLineage | null): boolean {
  if (task.execution || task.ardent.attempts?.length) return true;
  if (!lineage) return false;
  const studio = lineage.studio;
  if (studio.root || studio.parent || studio.children.length || studio.handoffs.length || studio.reassignedTo.length || studio.workflow) return true;
  return lineage.ardent.some(({ lineage: item }) => item && (item.execution || item.model_attempts.length || item.tools.length || item.artifacts.length || item.children.length || item.continuations.length));
}

/** The Ardent task reference whose attempts Emberpath can list: `hx1:ardent:<instance>:task:<id>`. */
export function ardentTaskRef(attempt: ArdentAttempt): string | null {
  for (const ref of [attempt.ref, attempt.lineage?.execution?.self]) if (ref && parseExecutionRef(ref)?.kind === 'task') return ref;
  const fromAttempt = (attempt.lineage?.model_attempts ?? []).map((item) => (item.ref ? parseExecutionRef(item.ref) : undefined)).find((parts) => parts?.kind === 'attempt');
  if (!fromAttempt) return null;
  return `hx1:${fromAttempt.product}:${fromAttempt.instance}:task:${attempt.ardentTaskId}`;
}

export function formatUsage(usage: unknown): string | null {
  if (!usage || typeof usage !== 'object') return null;
  const record = usage as Record<string, unknown>;
  const number = (key: string) => (typeof record[key] === 'number' ? (record[key] as number) : undefined);
  const input = number('prompt_tokens') ?? number('input_tokens');
  const output = number('completion_tokens') ?? number('output_tokens');
  if (input === undefined && output === undefined) return null;
  return `${input ?? '?'} in · ${output ?? '?'} out`;
}
