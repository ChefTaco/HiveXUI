import { useEffect, useRef, useState } from 'react';
import { cn } from '@lib/cn';
import { prefersReducedMotion } from './motion';

export const easeOutExpo = (t: number): number => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** A number that tweens when its value changes. The first render shows the final value. */
export function AnimatedNumber({ value, decimals = 0, prefix = '', suffix = '', duration = 600, className }: { value: number | null | undefined; decimals?: number; prefix?: string; suffix?: string; duration?: number; className?: string }) {
  const known = typeof value === 'number' && Number.isFinite(value);
  const [shown, setShown] = useState<number | null>(known ? value : null);
  const from = useRef<number | null>(known ? value : null);
  useEffect(() => {
    if (!known) {
      from.current = null;
      setShown(null);
      return;
    }
    const start = from.current;
    from.current = value;
    if (start === null || start === value || prefersReducedMotion()) {
      setShown(value);
      return;
    }
    let frame = 0;
    const begun = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - begun) / duration);
      setShown(start + (value - start) * easeOutExpo(t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [known, value, duration]);
  return <span className={cn('num', className)}>{shown === null ? '—' : `${prefix}${shown.toFixed(decimals)}${suffix}`}</span>;
}
