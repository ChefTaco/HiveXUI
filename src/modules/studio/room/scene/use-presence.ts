// The room's clock for held states: re-renders when "Replied", a delivery or an arc runs out, and
// not otherwise, so the scene needs no ticking timer.
import { useEffect, useMemo, useState } from 'react';
import { nextPresenceChange, type PresenceState } from './presence';

/** The time to read presence at. It moves forward when presence changes or a held state or arc expires. */
export function usePresenceNow(state: PresenceState, clock: () => number = Date.now): number {
  const [tick, setTick] = useState(0);
  const now = useMemo(() => clock(), [state, tick, clock]);
  useEffect(() => {
    const next = nextPresenceChange(state, now);
    if (next === null) return;
    const timer = setTimeout(() => setTick((value) => value + 1), Math.max(0, next - now));
    return () => clearTimeout(timer);
  }, [state, now]);
  return now;
}
