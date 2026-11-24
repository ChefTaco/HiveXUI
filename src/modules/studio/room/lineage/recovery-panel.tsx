// A task's execution recovery: why it stopped and the decisions the runtime accepts now. Only the
// actions the backend lists are offered, each behind a confirmation that says what it does; a Studio
// or profile without recovery sends no recovery, and the panel is not shown at all.
import { useId, useRef, useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { Badge, Button, ConfirmDialog } from '@ui';
import { errorMessage } from '../../../magnus/api/errors';
import { idempotencyKey } from '../../api/client';
import type { Task } from '../../api/endpoints';
import { decideTaskRecovery, type RecoveryAction } from '../../api/execution';
import { RECOVERY_ACTION_COPY, RECOVERY_STATUS_LABEL } from './logic';

const STATUS_TONE = { ready: 'accent', reconciling: 'accent', resumed: 'accent', awaiting_decision: 'warning', unsupported: 'danger', resolved: 'neutral' } as const;

export interface RecoveryPanelProps {
  task: Task;
  archived: boolean;
  /** The decision was recorded; `task` is Studio's updated record when it sent one. */
  onDecided?: ((task: Task | undefined) => void) | undefined;
  decide?: typeof decideTaskRecovery;
}

export function RecoveryPanel({ task, archived, onDecided, decide = decideTaskRecovery }: RecoveryPanelProps) {
  const recovery = task.recovery;
  const [asking, setAsking] = useState<RecoveryAction | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // One key per decision: a retry after a lost answer replays it instead of deciding twice.
  const keys = useRef(new Map<RecoveryAction, string>());
  const noteId = useId();
  const titleId = useId();
  if (!recovery) return null;

  const open = (action: RecoveryAction) => {
    setError(null);
    setNote('');
    setAsking(action);
  };
  async function confirm() {
    if (!asking) return;
    const action = asking;
    let key = keys.current.get(action);
    if (!key) {
      key = idempotencyKey();
      keys.current.set(action, key);
    }
    setBusy(true);
    setError(null);
    try {
      const answer = await decide(task.id, { action, note: note.trim() || undefined }, key);
      keys.current.delete(action);
      setAsking(null);
      setDone(`${RECOVERY_ACTION_COPY[action].label}: recorded.`);
      onDecided?.(answer.task);
    } catch (failure) {
      setError(errorMessage(failure, 'The decision could not be recorded'));
    } finally {
      setBusy(false);
    }
  }

  const pending = recovery.checkpoint?.pending_calls ?? [];
  const copy = asking ? RECOVERY_ACTION_COPY[asking] : null;
  return (
    <section className="room-recovery rounded-control border border-border bg-surface-sunken p-3" aria-labelledby={titleId} data-recovery={recovery.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={titleId} className="m-0 flex items-center gap-2 text-sm font-semibold text-text-strong">
          <LifeBuoy className="size-4" aria-hidden="true" />
          Recovery
        </h4>
        <Badge tone={STATUS_TONE[recovery.status]}>{RECOVERY_STATUS_LABEL[recovery.status]}</Badge>
      </div>
      <p className="m-0 mt-2 text-sm text-text">{recovery.reason.message}</p>
      <p className="m-0 mt-1 text-xs text-text-muted">
        {`Attempt ${recovery.attempt}`}
        {recovery.checkpoint ? ` · stopped at step ${recovery.checkpoint.step} after ${recovery.checkpoint.completed_calls} completed tool calls` : ''}
      </p>
      {pending.length ? (
        <ul className="m-0 mt-2 grid gap-1 pl-4 text-xs" aria-label="Interrupted tool calls">
          {pending.map((call) => (
            <li key={call.call_id}>
              <span className="font-mono">{call.tool}</span> · effect {call.effect}
              {call.reconcilable ? ' · can be checked with its service' : ' · cannot be checked automatically'}
            </li>
          ))}
        </ul>
      ) : null}
      {recovery.decided ? (
        <p className="m-0 mt-2 text-xs text-text-muted">
          {`Decided: ${RECOVERY_ACTION_COPY[recovery.decided.action as RecoveryAction]?.label ?? recovery.decided.action} by ${recovery.decided.by}`}
          {recovery.decided.note ? ` (“${recovery.decided.note}”)` : ''}
        </p>
      ) : null}
      {recovery.continuation_task_id ? <p className="m-0 mt-1 text-xs text-text-muted">{`Continued as Ardent task ${recovery.continuation_task_id}.`}</p> : null}
      {recovery.supported === false && (recovery.status === 'awaiting_decision' || recovery.status === 'unsupported') ? (
        <p className="m-0 mt-2 text-xs text-text-muted">This agent cannot take recovery decisions through Magnus (it needs Ardent 3.2.0 and Magnus 3.3.0). Reassign the task to run the work again.</p>
      ) : null}
      {done ? (
        <p className="m-0 mt-2 text-xs text-text" role="status">
          {done}
        </p>
      ) : null}
      {error && !asking ? (
        <p className="m-0 mt-2 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {!archived && recovery.actions.length ? (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Recovery decisions">
          {recovery.actions.map((action) => (
            <Button key={action} size="sm" variant={action === 'abandon' ? 'ghost' : 'default'} onClick={() => open(action)} aria-label={`${RECOVERY_ACTION_COPY[action].label}: ${task.title}`}>
              {RECOVERY_ACTION_COPY[action].label}
            </Button>
          ))}
        </div>
      ) : null}
      <ConfirmDialog
        open={copy !== null}
        title={copy?.title ?? ''}
        message={copy?.message ?? ''}
        confirmLabel={copy?.confirm ?? ''}
        tone={copy?.tone ?? 'primary'}
        loading={busy}
        onCancel={() => setAsking(null)}
        onConfirm={() => void confirm()}
      >
        <label className="field" htmlFor={noteId}>
          <span className="field-label">Note (optional)</span>
          <textarea id={noteId} rows={2} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What you checked, for the record" />
        </label>
        {error ? (
          <p className="m-0 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}
