// Execution ancestry, recovery, workflow runs and artifact delivery on the Studio service (Studio
// 0.5.0 with agents on Ardent 3.2.0). Shapes come from the vendored contract. A Studio before 0.5.0
// does not send the fields 0.5.0 added to tasks, revisions and imports, so those are read as optional
// here and the UI shows nothing new for it; its routes for recovery, lineage and workflow runs answer
// 404, which reads as unsupported. Every field is attribution only; nothing here grants access.
import { z } from 'zod';
import {
  artifactImportSchema,
  deliverableRevisionSchema,
  deliverableSchema,
  listWorkflowRunsResponseSchema,
  postMessageResponseSchema,
  revisionRequestResponseSchema,
  revisionDetailResponseSchema,
  snapshotResponseSchema,
  taskLineageResponseSchema,
  taskRecoveryDecisionResponseSchema,
  taskRecoveryResponseSchema,
  taskSchema,
  workflowRunResponseSchema,
  type recoveryActionSchema,
  type taskRecoverySchema,
  type workflowActionSchema,
} from '@contracts/ardentstudio.generated';
import { executionRefsSchema } from '../../../lib/execution';
import { segment, studio, StudioApiError } from './client';

export { RECOVERY_ACTIONS } from '@contracts/ardentstudio.generated';
export type RecoveryAction = z.output<typeof recoveryActionSchema>;
export type TaskRecovery = z.output<typeof taskRecoverySchema>;

// ── Tasks ──

/** A Studio task. `recovery`, `execution` and `ardent.attempts` are absent from a Studio before 0.5.0. */
const { recovery, execution, ardent } = taskSchema.shape;
export const studioTaskSchema = taskSchema.extend({
  recovery: recovery.optional(),
  execution: execution.optional(),
  ardent: ardent.extend({ attempts: ardent.shape.attempts.optional() }),
});
export type StudioTask = z.output<typeof studioTaskSchema>;
export const studioTaskListSchema = z.object({ tasks: z.array(studioTaskSchema) });
export const studioSnapshotSchema = snapshotResponseSchema.extend({ tasks: z.array(studioTaskSchema) });
export const studioPostMessageSchema = postMessageResponseSchema.extend({ tasks: z.array(studioTaskSchema) });
export const studioRevisionRequestSchema = revisionRequestResponseSchema.extend({ task: studioTaskSchema });

/** Whether this Studio reports execution ancestry and recovery: 0.5.0 sends both on every task (null when there is nothing). */
export const executionReported = (task: StudioTask): boolean => task.recovery !== undefined || task.execution !== undefined;
export const rootRefOf = (task: StudioTask): string | null => task.execution?.root ?? null;

// ── Recovery routes ──

export type RecoveryAnswer = z.output<typeof taskRecoveryResponseSchema>;
/**
 * The task's recovery, read now through Magnus (source live) or as last recorded (stored), with
 * whether decisions can be sent. Null from a Studio without recovery (404).
 */
export async function getTaskRecovery(taskId: string, signal?: AbortSignal): Promise<RecoveryAnswer | null> {
  try {
    return await studio.get(`/tasks/${segment(taskId)}/recovery`, taskRecoveryResponseSchema, { signal });
  } catch (error) {
    if (error instanceof StudioApiError && error.notFound) return null;
    throw error;
  }
}

export interface RecoveryDecision {
  action: RecoveryAction;
  note?: string | undefined;
  call_id?: string | undefined;
}
/**
 * Decide a held task (`{ task, recovery }` back). The key goes in the idempotency header, so a retried
 * click replays the first decision instead of making a second one.
 */
export const decideTaskRecovery = (taskId: string, decision: RecoveryDecision, idempotencyKey: string) =>
  studio.post(`/tasks/${segment(taskId)}/recovery`, taskRecoveryDecisionResponseSchema, {
    body: { action: decision.action, ...(decision.note ? { note: decision.note } : {}), ...(decision.call_id ? { call_id: decision.call_id } : {}) },
    idempotencyKey,
  });

// ── Lineage ──

/*
 * Ardent's GET /tasks/{id}/lineage (ChefTaco/Ardent src/lineage.ts). Studio relays it as-is (a record in
 * its contract) and no browser contract describes it, so it is read here, leniently.
 */
const optional = <S extends z.ZodType>(schema: S) => schema.optional().catch(undefined);
const text = z.string().nullable().catch(null);
const count = z.number().int().nullable().catch(null);
/** Ardent's `GET /tasks/{id}/lineage` (ChefTaco/Ardent src/lineage.ts), passed through Magnus and Studio. */
export const ardentLineageSchema = z.object({
  task_id: z.string(),
  execution: executionRefsSchema.optional(),
  parent: optional(z.object({ ref: z.string(), local_task_id: z.string().optional() })),
  children: z.array(z.object({ ref: z.string(), local_task_id: z.string(), source: z.string().catch('') })).catch([]),
  continuations: z.array(z.object({ ref: z.string(), local_task_id: z.string(), source: z.string().catch('') })).catch([]),
  model_attempts: z
    .array(z.object({ step: z.number().int(), attempt: z.number().int(), backend: text, request_id: text, ref: text, started_ms: z.number().catch(0), usage: z.unknown().optional(), repair: z.boolean().optional() }))
    .catch([]),
  tools: z.array(z.object({ call_id: z.string(), name: z.string(), effect: text, state: z.string() })).catch([]),
  artifacts: z
    .array(
      z.object({
        sha256: z.string(),
        name: z.string(),
        mime: text,
        size: count,
        source: z.string().catch(''),
        schema_version: z.string().optional(),
        execution: optional(z.object({ root: z.string(), task: z.string().optional(), step: z.string().optional() })),
        rendition_of: z.string().optional(),
      }),
    )
    .catch([]),
});
export type ArdentLineage = z.output<typeof ardentLineageSchema>;

/** A Studio task in the chain. */
export interface Related {
  ref?: string | undefined;
  taskId?: string | undefined;
  title?: string | undefined;
  state?: string | undefined;
  kind?: string | undefined;
}
type LineageTask = { task_id: string; ref: string | null; state: string; mode: string };
const related = (item: LineageTask): Related => ({ taskId: item.task_id, ref: item.ref ?? undefined, state: item.state, kind: item.mode });

/** One Ardent task the Studio task ran as: the first submission, then each recovery continuation. */
export interface ArdentAttempt {
  ardentTaskId: string;
  ref: string | null;
  current: boolean;
  lineage: ArdentLineage | null;
  /** Why this attempt's lineage could not be read. */
  error: string | null;
}

/** Studio's `GET /tasks/{id}/lineage`, with each Ardent attempt's lineage read. */
export const taskLineageSchema = taskLineageResponseSchema.transform((value) => {
  const attempts: ArdentAttempt[] = (value.ardent?.attempts ?? []).map((attempt) => {
    const lineage = attempt.lineage ? ardentLineageSchema.safeParse(attempt.lineage) : null;
    return {
      ardentTaskId: attempt.ardent_task_id,
      ref: attempt.ref,
      current: attempt.current,
      lineage: lineage?.success ? lineage.data : null,
      error: attempt.error?.message ?? (lineage && !lineage.success ? 'The agent answered in a shape this console does not know' : null),
    };
  });
  const { studio: own } = value;
  return {
    studio: {
      self: own.self,
      root: own.root,
      parent: own.parent,
      children: own.children.map(related),
      reassignedFrom: own.reassigned_from ? related(own.reassigned_from) : null,
      reassignedTo: own.reassigned_to.map(related),
      handoffs: own.handoffs.map((item) => ({ ...related(item), direction: item.direction })),
      revisions: own.revisions,
      workflow: own.workflow,
    },
    agentRef: value.ardent?.agent_ref ?? null,
    ardent: attempts,
    ardentUnavailable: value.ardent_unavailable?.message ?? null,
    executionRoot: value.emberpath.filter.executionRoot,
  };
});
export type TaskLineage = z.output<typeof taskLineageSchema>;

/** The lineage, or null when this Studio does not serve lineage (404). */
export async function getTaskLineage(taskId: string, signal?: AbortSignal): Promise<TaskLineage | null> {
  try {
    return await studio.get(`/tasks/${segment(taskId)}/lineage`, taskLineageSchema, { signal });
  } catch (error) {
    if (error instanceof StudioApiError && error.notFound) return null;
    throw error;
  }
}

// ── Workflow runs (Studio 0.5.0 STUDIO-02, in the vendored contract) ──

export type WorkflowRun = z.output<typeof workflowRunResponseSchema>;
export type WorkflowNode = WorkflowRun['nodes'][number];
export type WorkflowAction = z.output<typeof workflowActionSchema>;
const project = (id: string, rest: string) => `/projects/${segment(id)}${rest}`;
/** Newest first. Null when this Studio has no workflow runs (404). */
export async function listWorkflowRuns(projectId: string, signal?: AbortSignal): Promise<WorkflowRun[] | null> {
  try {
    return (await studio.get(project(projectId, '/workflow-runs'), listWorkflowRunsResponseSchema, { query: { state: 'all' }, signal })).runs;
  } catch (error) {
    if (error instanceof StudioApiError && error.notFound) return null;
    throw error;
  }
}
export const getWorkflowRun = (projectId: string, runId: string, signal?: AbortSignal) => studio.get(project(projectId, `/workflow-runs/${segment(runId)}`), workflowRunResponseSchema, { signal });
export const workflowNodeAction = (projectId: string, runId: string, nodeKey: string, action: WorkflowAction, idempotencyKey: string) =>
  studio.post(project(projectId, `/workflow-runs/${segment(runId)}/nodes/${segment(nodeKey)}/actions`), workflowRunResponseSchema, { body: { action }, idempotencyKey });

// ── Deliverables: renditions and import progress (STUDIO-03) ──

/** Renditions are absent from a Studio before 0.5.0; transfer progress from its imports. */
export const studioRevisionSchema = deliverableRevisionSchema.extend({ renditions: deliverableRevisionSchema.shape.renditions.optional() });
export type StudioRendition = NonNullable<z.output<typeof studioRevisionSchema>['renditions']>[number];
export const studioDeliverableSchema = deliverableSchema.extend({ revisions: z.array(studioRevisionSchema) });
const imports = artifactImportSchema.shape;
export const studioImportSchema = artifactImportSchema.extend({
  error_code: imports.error_code.optional(),
  received_bytes: imports.received_bytes.optional(),
  transfer: imports.transfer.optional(),
  resumes: imports.resumes.optional(),
});
export const studioDeliverablesSchema = z.object({ deliverables: z.array(studioDeliverableSchema), imports: z.array(studioImportSchema) });
export const studioRevisionDetailSchema = revisionDetailResponseSchema.extend({ revision: studioRevisionSchema, deliverable: studioDeliverableSchema });
