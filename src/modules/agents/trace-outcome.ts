// How an Emberpath trace ended, as its outcome enum says (SUCCEEDED, FAILED, DENIED, STREAM_FAILED).
// Releases before the enum wrote lowercase words, which read the same way.
import type { Tone } from '@ui';

const OUTCOMES: Readonly<Record<string, { label: string; tone: Tone }>> = {
  succeeded: { label: 'Succeeded', tone: 'success' },
  success: { label: 'Succeeded', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  failure: { label: 'Failed', tone: 'danger' },
  denied: { label: 'Denied', tone: 'warning' },
  stream_failed: { label: 'Stream failed', tone: 'danger' },
};

export function traceOutcome(outcome: string | null | undefined): { label: string; tone: Tone } {
  const known = outcome ? OUTCOMES[outcome.toLowerCase()] : undefined;
  return known ?? { label: outcome || 'Unknown', tone: 'neutral' };
}
