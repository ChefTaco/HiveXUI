import type { Tone } from '@ui';

export const todayKey = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/** Today is always offered, even before the day has a file. */
export const dayOptions = (days: readonly string[], today: string = todayKey()): string[] => (days.includes(today) ? [...days] : [today, ...days]);

/** Rows are raw JSONL, so details can be a JSON string, a value, or missing. */
export function parseDetails(details: unknown): Record<string, unknown> {
  if (details === undefined || details === null) return {};
  let value = details;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { raw: details };
    }
  }
  if (value === null || value === undefined) return {};
  return typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : { raw: value };
}

export function actionTone(action: string): Tone {
  if (action.includes('delete') || action.includes('decommission') || action.includes('cancel')) return 'danger';
  if (action.includes('create') || action.includes('register') || action.includes('deploy') || action.includes('push')) return 'success';
  if (action.includes('update') || action.includes('assign')) return 'warning';
  return 'info';
}

export const INTEGRITY_TONE: Record<string, Tone> = { verified: 'success', 'legacy-partial': 'warning', invalid: 'danger' };
export const integrityTone = (state: string): Tone => INTEGRITY_TONE[state] ?? 'neutral';

export const detailText = (value: unknown): string => (typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : String(value));
