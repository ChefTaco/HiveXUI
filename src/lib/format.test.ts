import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { relativeTime } from './format';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-10T00:00:00Z'));
});
afterEach(() => vi.useRealTimers());

it('describes past times as ages', () => {
  expect(relativeTime('2026-01-09T23:59:30Z')).toBe('30s ago');
  expect(relativeTime('2026-01-08T00:00:00Z')).toBe('2d ago');
});
it('describes future expiries without a negative age', () => {
  expect(relativeTime('2026-01-17T00:00:00Z')).toBe('in 7d');
  expect(relativeTime('2026-01-10T00:00:30Z')).toBe('in 30s');
});
