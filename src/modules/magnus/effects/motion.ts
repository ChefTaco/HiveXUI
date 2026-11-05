import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';
const STORAGE_KEY = 'magnus:fx';

/** True when the viewer asked for reduced motion or switched effects to low. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.(QUERY).matches || document.documentElement.dataset.fx === 'low';
}
function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-fx'] });
  return () => {
    media.removeEventListener('change', onChange);
    observer.disconnect();
  };
}
/** For effects driven from script (counters, canvas, the marquee). CSS effects are switched off by CSS. */
export const useReducedMotion = (): boolean => useSyncExternalStore(subscribe, prefersReducedMotion, () => false);

export function applyStoredFxLevel(): void {
  try {
    if (localStorage.getItem(STORAGE_KEY) === 'low') document.documentElement.dataset.fx = 'low';
    else delete document.documentElement.dataset.fx;
  } catch {
    // Storage blocked: keep the default.
  }
}
export function toggleFxLevel(): 'low' | 'normal' {
  const next = document.documentElement.dataset.fx === 'low' ? 'normal' : 'low';
  if (next === 'low') document.documentElement.dataset.fx = 'low';
  else delete document.documentElement.dataset.fx;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage blocked: it still applies to this page view.
  }
  return next;
}
