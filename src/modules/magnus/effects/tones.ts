import type { Tone } from '@ui';

/** CSS color for SVG and chart attributes, which cannot use classes. Always a theme token. */
export const TONE_COLOR: Record<Tone, string> = {
  neutral: 'var(--text-muted)',
  accent: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
};
export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-text-muted',
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
};

export interface Thresholds {
  warn: number;
  crit: number;
}
export const DEFAULT_THRESHOLDS: Thresholds = { warn: 70, crit: 90 };
export const thresholdTone = (percent: number, { warn, crit }: Thresholds = DEFAULT_THRESHOLDS): Tone => (percent >= crit ? 'danger' : percent >= warn ? 'warning' : 'success');
/** Latency in milliseconds, as the old console colored dependency checks. */
export const latencyTone = (ms: number): Tone => (ms >= 500 ? 'danger' : ms >= 150 ? 'warning' : 'success');
