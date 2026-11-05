import { useRef } from 'react';
import { useReducedMotion } from '../../../effects';

/**
 * scan-sweep paints its band as a background and moves it away by animation. With motion reduced the
 * animation is removed but the band stays, so a row must not carry the class at all.
 */
export const useSweep = (): string => (useReducedMotion() ? '' : 'scan-sweep');

/** Adds to `fresh` every key not seen before, except on the first answer. */
export function trackArrivals(seen: Set<string>, fresh: Set<string>, keys: readonly string[]): void {
  const first = seen.size === 0;
  for (const key of keys) {
    if (!first && !seen.has(key)) fresh.add(key);
    seen.add(key);
  }
}

/** The sweep class for a long, polled list: only rows that arrive after the first load light up. */
export function useArrivals(keys: readonly string[] | undefined): (key: string) => string {
  const sweep = useSweep();
  const seen = useRef(new Set<string>());
  const fresh = useRef(new Set<string>());
  if (keys) trackArrivals(seen.current, fresh.current, keys);
  return (key) => (fresh.current.has(key) ? sweep : '');
}
