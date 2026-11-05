import { useEffect, useRef, useState } from 'react';
import { watchAuthLimits } from '../lib/auth-limits';
import { productPrefix } from '../lib/transport';
import { Icon } from './icons';

export const AUTH_LIMITS_MESSAGE = 'Sign-in limits are relaxed for testing. Do not use this installation for real accounts.';

/** The permanent notice. It has no close control on purpose: this mode must never be silently on. */
export function AuthLimitsNotice() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    // The sticky top bar sits below the strip, however many lines it wraps to.
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty('--shell-strip-height', `${element.offsetHeight}px`));
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--shell-strip-height');
    };
  }, []);
  return (
    <div ref={ref} role="status" data-testid="auth-limits-relaxed" className="sticky top-0 z-[85] flex items-center justify-center gap-2 bg-warning px-4 py-1.5 text-center text-sm font-semibold text-on-warning">
      <Icon.Alert aria-hidden="true" className="size-4 shrink-0" />
      <span>{AUTH_LIMITS_MESSAGE}</span>
    </div>
  );
}

/** Shown wherever Oathweave reports the mode, including before sign-in, where it matters most. */
export function AuthLimitsStrip() {
  const [relaxed, setRelaxed] = useState(false);
  useEffect(() => {
    const prefix = productPrefix('oathweave');
    return prefix ? watchAuthLimits(prefix, setRelaxed) : undefined;
  }, []);
  return relaxed ? <AuthLimitsNotice /> : null;
}
