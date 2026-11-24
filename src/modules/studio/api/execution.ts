// Execution ancestry, recovery and artifact delivery on the Studio service (Studio 0.5.0 and Ardent
// 3.2.0). The vendored contract does not describe these fields and routes yet, so they are read here
// as optional extensions of the released shapes, the way agents/api.ts reads newer HiveSkills fields:
// a Studio that does not send them, or sends a shape this console does not know, simply shows nothing
// new. Every field is attribution only; nothing here grants access to anything.
import { z } from 'zod';
import { parseExecutionRef } from '@hivemagnus/hive-common/execution';
import { executionRefsSchema, taskRecoverySchema, type ExecutionRefs, type RecoveryAction, type TaskRecovery } from '../../../lib/execution';
import {
  artifactImportSchema,
  deliverableRevisionSchema,
  deliverableSchema,
  listWorkflowRunsResponseSchema,
  revisionDetailResponseSchema,
  snapshotResponseSchema,
  taskSchema,
  workflowRunResponseSchema,
  type workflowActionSchema,
} from '@contracts/ardentstudio.generated';
import { segment, studio, StudioApiError } from './client';

export { RECOVERY_ACTIONS, type ExecutionRefs, type RecoveryAction, type TaskRecovery } from '../../../lib/execution';

const optional = <S extends z.ZodType>(schema: S) => schema.optional().catch(undefined);

// ── Execution references and recovery on a task ──

/**
 * A Studio task, with the recovery and ancestry Studio 0.5.0 adds. `recovery` is null for a task never
 * interrupted; `ardent.attempts` names the earlier Ardent tasks (recovery continuations), oldest first.
 */
export const studioTaskSchema = taskSchema.extend({
  ardent: taskSchema.shape.ardent.extend({ attempts: optional(z.array(z.string())) }),
  recovery: optional(taskRecoverySchema.nullable()),
  execution: executionRefsSchema.optional(),
});
export type StudioTask = z.output<typeof studioTaskSchema>;
export const studioTaskListSchema = z.object({ tasks: z.array(studioTaskSchema) });
export const studioSnapshotSchema = snapshotResponseSchema.extend({ tasks: z.array(studioTaskSchema) });

/**
 * Whether this Studio reports execution ancestry and recovery at all. A Studio that does sends the
 * fields on every task (null when there is nothing), so their presence is the capability.
 */
export const executionReported = (task: StudioTask): boolean => task.recovery !== undefined || task.execution !== undefined;
export const rootRefOf = (task: StudioTask): string | null => task.execution?.root ?? null;

// ── Recovery routes ──

/**
 * Studio's `GET /tasks/{id}/recovery`: the recovery read now through Magnus (source live) or as last
 * recorded (stored), and whether decisions can be sent (`unavailable` says why not).
 */
const recoveryAnswerSchema = z.object({
  task: studioTaskSchema,
  recovery: taskRecoverySchema.nullable(),
  supported: z.boolean(),
  source: z.string().catch('stored'),
  unavailable: z.object({ code: z.string(), message: z.string() }).nullable().catch(null),
});
export type RecoveryAnswer = z.output<typeof recoveryAnswerSchema>;
/** The task's recovery, or null from a Studio without recovery (404). */
export async function getTaskRecovery(taskId: string, signal?: AbortSignal): Promise<RecoveryAnswer | null> {
  try {
    return await studio.get(`/tasks/${segment(taskId)}/recovery`, recoveryAnswerSchema, { signal });
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
const decisionAnswerSchema = z.object({ task: studioTaskSchema.optional(), recovery: taskRecoverySchema.nullable().optional() });
/**
 * Decide a held task (`{ task, recovery }` back). The key goes in the idempotency header, so a retried
 * click replays the first decision instead of making a second one.
 */
export const decideTaskRecovery = (taskId: string, decision: RecoveryDecision, idempotencyKey: string) =>
  studio.post(`/tasks/${segment(taskId)}/recovery`, decisionAnswerSchema, {
    body: { action: decision.action, ...(decision.note ? { note: decision.note } : {}), ...(decision.call_id ? { call_id: decision.call_id } : {}) },
    idempotencyKey,
  });

// ── Lineage ──

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

/** A Studio task in a lineage listing (`{ task_id, ref, role_key, state, mode }`). */
export interface Related {
  ref?: string | undefined;
  taskId?: string | undefined;
  title?: string | undefined;
  state?: string | undefined;
  kind?: string | undefined;
}
const relatedSchema = z.record(z.string(), z.unknown()).transform((value): Related | null => {
  const pick = (...keys: string[]) => keys.map((key) => value[key]).find((item): item is string => typeof item === 'string' && item.length > 0);
  const related: Related = { ref: pick('ref'), taskId: pick('task_id'), state: pick('state'), kind: pick('direction', 'relationship', 'mode') };
  return related.ref || related.taskId ? related : null;
});
const present = (items: Array<Related | null>): Related[] => items.filter((item): item is Related => item !== null);
const relatedList = z.array(relatedSchema).catch([]).transform(present);
const handoffList = z
  .array(z.record(z.string(), z.unknown()))
  .catch([])
  .transform((items) => items.flatMap((item) => {
    const related = relatedSchema.parse(item);
    return related ? [{ ...related, direction: item.direction === 'to' ? ('to' as const) : ('from' as const) }] : [];
  }));
const refText = z.string().nullable().catch(null);
const problem = z.object({ code: z.string(), message: z.string() }).nullable().catch(null);

/** One Ardent task the Studio task ran as: the first submission, then each recovery continuation. */
export interface ArdentAttempt {
  ardentTaskId: string;
  ref: string | null;
  current: boolean;
  lineage: ArdentLineage | null;
  /** Why this attempt's lineage could not be read. */
  error: string | null;
}

/**
 * Studio's `GET /tasks/{id}/lineage` (Studio 0.5.0): its own relationships, each Ardent attempt's
 * lineage as the profile records it (oldest first, current last), and the Emberpath trace filter.
 */
export const taskLineageSchema = z
  .object({
    studio: z
      .object({
        self: refText,
        root: refText,
        parent: refText,
        children: relatedList,
        reassigned_from: relatedSchema.nullable().catch(null),
        reassigned_to: relatedList,
        handoffs: handoffList,
        revisions: z.array(z.object({ revision_id: z.string(), deliverable_id: z.string(), revision: z.number().int(), blob_sha256: z.string() })).catch([]),
        workflow: z.object({ run_id: z.string(), node_key: z.string(), attempt: z.number().int(), ref: z.string().nullable() }).nullable().catch(null),
      })
      .partial()
      .catch({}),
    ardent: z
      .object({
        agent_ref: z.string().catch(''),
        attempts: z
          .array(z.object({ ardent_task_id: z.string(), ref: refText, current: z.boolean().catch(false), lineage: z.unknown(), error: problem }))
          .catch([]),
      })
      .nullable()
      .catch(null),
    ardent_unavailable: problem.optional(),
    emberpath: optional(z.object({ filter: z.object({ executionRoot: z.string().nullable().catch(null) }) })),
  })
  .transform((value) => {
    const studioPart = value.studio;
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
    return {
      studio: {
        self: studioPart.self ?? null,
        root: studioPart.root ?? null,
        parent: studioPart.parent ?? null,
        children: studioPart.children ?? [],
        reassignedFrom: studioPart.reassigned_from ?? null,
        reassignedTo: studioPart.reassigned_to ?? [],
        handoffs: studioPart.handoffs ?? [],
        revisions: studioPart.revisions ?? [],
        workflow: studioPart.workflow ?? null,
      },
      agentRef: value.ardent?.agent_ref || null,
      ardent: attempts,
      ardentUnavailable: value.ardent_unavailable?.message ?? null,
      executionRoot: value.emberpath?.filter.executionRoot ?? null,
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

// ── Deliverables: renditions, provenance and import progress (STUDIO-03) ──

/** One available form of a revision's artifact, the original first (HiveCommon `Rendition` plus its purpose). */
export const renditionSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  role: z.enum(['original', 'preview', 'model_input']),
  mime: z.string(),
  size: z.number().int().min(0),
  purpose: z.string().nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  has_alpha: z.boolean().nullable().optional(),
});
export type StudioRendition = z.output<typeof renditionSchema>;
const renditionList = z
  .array(z.unknown())
  .transform((items) => items.flatMap((item) => {
    const parsed = renditionSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  }));
export const studioRevisionSchema = deliverableRevisionSchema.extend({ renditions: optional(renditionList) });
export const studioDeliverableSchema = deliverableSchema.extend({ revisions: z.array(studioRevisionSchema) });
/**
 * An artifact import with the progress Studio 0.5.0 adds. `state` is read as text, so a newer state
 * (transferring, resuming) never makes the whole deliverable list unreadable.
 */
export const studioImportSchema = artifactImportSchema.extend({
  state: z.string(),
  received_bytes: optional(z.number().int().min(0)),
  /** A stable outcome code: DIGEST_MISMATCH, TOO_LARGE, MAGNUS_REFUSED, TRANSFER_FAILED or TRANSFER_REQUIRES_V2. */
  error_code: optional(z.string().nullable()),
  /** range: artifact transfer v2 with Range and resume; whole: the v1 download. Null until it starts. */
  transfer: optional(z.string().nullable()),
  /** How often the transfer continued from a partial file. */
  resumes: optional(z.number().int().min(0)),
});
export const studioDeliverablesSchema = z.object({ deliverables: z.array(studioDeliverableSchema), imports: z.array(studioImportSchema) });
export const studioRevisionDetailSchema = revisionDetailResponseSchema.extend({ revision: studioRevisionSchema, deliverable: studioDeliverableSchema });
