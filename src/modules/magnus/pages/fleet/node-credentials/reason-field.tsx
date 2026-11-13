import { useId } from 'react';
import { TextArea } from '@ui';
import { REASON_MAX } from './api';

/**
 * An optional reason for a key decision, recorded in Magnus's audit log with the acting user. Bounded to
 * what Magnus accepts, with the count shown, so nothing is cut off without the operator seeing it.
 */
export function ReasonField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="field mb-5">
      <label className="field-label" htmlFor={id}>Reason (optional)</label>
      <TextArea id={id} value={value} onChange={onChange} rows={2} maxLength={REASON_MAX} aria-describedby={hintId} />
      <span id={hintId} className="field-hint">
        <span className="num">{value.length}/{REASON_MAX}</span> characters. Magnus records it in the audit log with your name.
      </span>
    </div>
  );
}
