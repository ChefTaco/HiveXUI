import type { Tone } from '@ui';

/** The API answers a non-numeric hours value with a 500, so an address like ?hours=abc falls back to a day. */
export function windowHours(raw: string | null): number {
  const hours = Number(raw);
  return raw !== null && Number.isFinite(hours) && hours > 0 ? hours : 24;
}

export const lessonExpiry = (now: number = Date.now()): string => new Date(now + 30 * 86_400_000).toISOString();

export const CHECK_TONE: Record<'pass' | 'warn' | 'fail' | 'skip', Tone> = { pass: 'success', warn: 'warning', fail: 'danger', skip: 'neutral' };
export const HEALTH_TONE: Record<'healthy' | 'degraded' | 'unhealthy', Tone> = { healthy: 'success', degraded: 'warning', unhealthy: 'danger' };
export const severityTone = (severity: string): Tone => {
  switch (severity.toLowerCase()) {
    case 'error':
    case 'critical':
    case 'fatal':
      return 'danger';
    case 'warn':
    case 'warning':
      return 'warning';
    case 'success':
      return 'success';
    case 'info':
      return 'info';
    default:
      return 'neutral';
  }
};
