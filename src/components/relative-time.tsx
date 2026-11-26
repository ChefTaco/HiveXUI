import { useEffect, useState } from 'react';
import { relativeTime } from '../lib/format';

/** How often a shown age is read again. */
export const RELATIVE_TIME_TICK_MS = 10_000;

/** Re-renders every `intervalMs`, so a value derived from the clock stays current. */
export function useNow(intervalMs = RELATIVE_TIME_TICK_MS): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** "12s ago" that keeps counting while it is on screen, instead of the age when it was drawn. */
export function RelativeTime({ value, prefix = '' }: { value: string | Date | null | undefined; prefix?: string }) {
  useNow();
  const text = relativeTime(value instanceof Date ? value.toISOString() : value);
  return <>{prefix}{text}</>;
}
