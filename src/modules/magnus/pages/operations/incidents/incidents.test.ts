import { describe, expect, it } from 'vitest';
import { lessonExpiry, severityTone, windowHours } from './incident-model';

describe('incident helpers', () => {
  it('defaults the window to a day, and never sends a value the API answers with a 500', () => {
    expect(windowHours(null)).toBe(24);
    expect(windowHours('abc')).toBe(24);
    expect(windowHours('-3')).toBe(24);
    expect(windowHours('48')).toBe(48);
  });
  it('expires a reviewed lesson in 30 days', () => {
    expect(lessonExpiry(Date.UTC(2026, 0, 1))).toBe('2026-01-31T00:00:00.000Z');
  });
  it('colors a free-form severity', () => {
    expect(severityTone('ERROR')).toBe('danger');
    expect(severityTone('warning')).toBe('warning');
    expect(severityTone('info')).toBe('info');
    expect(severityTone('other')).toBe('neutral');
  });
});
