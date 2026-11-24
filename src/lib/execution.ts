// Execution context and recovery as Ardent reports them through Magnus: HiveCommon execution context
// v1 references and Ardent's recovery object (C3). The Magnus browser contract does not describe
// Ardent's task list, recovery or lineage, so they are read here, leniently (Studio's copies come from
// its own vendored contract). Attribution only: nothing here grants access.
import { z } from 'zod';
import { parseExecutionContext, parseExecutionRef } from '@hivemagnus/hive-common/execution';

/** A field a newer release adds: absent on older ones, and dropped when its shape is not one this console knows. */
const optional = <S extends z.ZodType>(schema: S) => schema.optional().catch(undefined);

// ── Recovery (Ardent's C3 shape, as Magnus relays it) ──

export const RECOVERY_ACTIONS = ['mark_applied', 'mark_not_applied', 'retry_with_new_deadline', 'abandon'] as const;
export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];
const isRecoveryAction = (value: unknown): value is RecoveryAction => (RECOVERY_ACTIONS as readonly unknown[]).includes(value);
export const RECOVERY_STATUSES = ['ready', 'reconciling', 'resumed', 'awaiting_decision', 'unsupported', 'resolved'] as const;

export const taskRecoverySchema = z.object({
  status: z.enum(RECOVERY_STATUSES),
  reason: z.object({ code: z.string(), message: z.string() }),
  attempt: z.number().int().min(1).catch(1),
  checkpoint: optional(
    z.object({
      step: z.number().int(),
      completed_calls: z.number().int().min(0),
      pending_calls: z.array(z.object({ call_id: z.string(), tool: z.string(), effect: z.string(), dispatched_at: z.string().nullable().catch(null), reconcilable: z.boolean() })),
    }),
  ),
  /** Only the actions valid now. An action this console does not know is never offered. */
  actions: z.array(z.unknown()).transform((values) => values.filter(isRecoveryAction)),
  continuation_task_id: optional(z.string()),
  decided: optional(z.object({ action: z.string(), by: z.string(), at: z.string(), note: z.string().optional() })),
});
export type TaskRecovery = z.output<typeof taskRecoverySchema>;

// ── Execution references on a task ──

/** The causal references a Studio task carries: its root request, its parent and itself, plus join inputs. */
export interface ExecutionRefs {
  root: string;
  parent?: string | undefined;
  self?: string | undefined;
  inputs?: readonly string[] | undefined;
}
/** A full execution context v1, or just its references. Anything else reads as absent. */
export const executionRefsSchema = z.unknown().transform((value): ExecutionRefs | undefined => {
  const context = parseExecutionContext(value);
  if (context) return { root: context.root, parent: context.parent, self: context.self, inputs: context.inputs };
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const ref = (item: unknown) => (typeof item === 'string' && parseExecutionRef(item) ? item : undefined);
  const root = ref(record.root);
  const inputs = Array.isArray(record.inputs) ? record.inputs.map(ref).filter((item): item is string => Boolean(item)) : [];
  return root ? { root, parent: ref(record.parent), self: ref(record.self), ...(inputs.length ? { inputs } : {}) } : undefined;
});


const RECOVERING: ReadonlySet<string> = new Set(['ready', 'reconciling', 'resumed']);
/**
 * The words for a task a restart interrupted, from its state and recovery status, or null when the
 * state says it all. A recovering task keeps running under the same id; a held one is unknown, and
 * its recovery says whether a person must decide what an interrupted call did, or whether the
 * runtime cannot resume it at all.
 */
export function recoveryChip(state: string, status: string | undefined): { label: string; tone: 'accent' | 'warning' | 'danger'; kind: 'recovering' | 'needs_decision' | 'unknown_outcome' } | null {
  if ((state === 'running' || state === 'queued') && status && RECOVERING.has(status)) return { label: 'Recovering', tone: 'accent', kind: 'recovering' };
  if (state === 'unknown' && status === 'awaiting_decision') return { label: 'Needs decision (effect unknown)', tone: 'warning', kind: 'needs_decision' };
  if (state === 'unknown' && status === 'unsupported') return { label: 'Unknown outcome', tone: 'danger', kind: 'unknown_outcome' };
  return null;
}
