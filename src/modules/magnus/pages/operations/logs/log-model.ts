import { logStreamEntrySchema } from '@contracts/magnus/browser';
import type { Tone } from '@ui';

export interface LogRow {
  key: string;
  source: string;
  level: string;
  message: string;
  timestamp: string;
}

export const MAX_LIVE_LOGS = 500;
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;

/** One `log` event from GET /logs/stream. A stream entry has an empty id, so the caller gives it a key. */
export function parseStreamLog(data: string, key: string): LogRow | null {
  let body: unknown;
  try {
    body = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = logStreamEntrySchema.safeParse(body);
  if (!parsed.success) return null;
  const { source, level, message, timestamp } = parsed.data;
  return { key, source, level, message, timestamp };
}

/** The newest first, keeping the page to a bounded number of rows. */
export const prependLog = (rows: readonly LogRow[], row: LogRow): LogRow[] => [row, ...rows].slice(0, MAX_LIVE_LOGS);

export const levelTone = (level: string): Tone => {
  switch (level.toLowerCase()) {
    case 'error':
    case 'fatal':
      return 'danger';
    case 'warn':
      return 'warning';
    case 'info':
      return 'info';
    default:
      return 'neutral';
  }
};
export const LEVEL_EDGE: Record<Tone, string> = {
  danger: 'border-l-danger',
  warning: 'border-l-warning',
  info: 'border-l-info',
  neutral: 'border-l-border',
  accent: 'border-l-accent',
  signal: 'border-l-signal',
  success: 'border-l-success',
};
