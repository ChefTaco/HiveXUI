import type { Tone } from '@ui';

/** The tone of a severity or log level from the API, which are free strings. */
export function severityTone(severity: string): Tone {
  switch (severity.toLowerCase()) {
    case 'critical':
    case 'error':
    case 'fatal':
      return 'danger';
    case 'warning':
    case 'warn':
      return 'warning';
    case 'info':
      return 'info';
    default:
      return 'neutral';
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** power;
  return `${power === 0 ? value : value.toFixed(value >= 100 ? 0 : 1)} ${units[power]}`;
}
