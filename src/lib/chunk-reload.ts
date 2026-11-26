// After an image upgrade the old hashed chunks are gone (nginx answers them with 404), so a tab
// opened before the upgrade fails on its next lazy page. One reload fetches the new index.html and
// its chunks. The guard makes that reload happen once: if the fresh page fails the same way, the
// console shows a "reload" message instead of reloading forever.

const KEY = 'hivexui:chunk-reload';
/** A second failure this soon after the guarded reload is the new build failing, not a stale tab. */
const WINDOW_MS = 2 * 60 * 1000;

/** Whether an error is a failed dynamic import or CSS preload, as browsers and Vite word it. */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'ChunkLoadError') return true;
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (CSS )?chunk [\w-]+ failed/i.test(error.message);
}

let reloading = false;
/** Whether a guarded reload has started, so a page can say so instead of showing an error. */
export const reloadStarted = () => reloading;

function lastReload(): number {
  try {
    const value = Number(sessionStorage.getItem(KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * Reload the page once to pick up a new build. Answers false, and does nothing, when the page was
 * already reloaded for this reason a moment ago, or when the reload cannot be recorded (without
 * storage a guard cannot hold, so no automatic reload happens at all).
 */
export function reloadOnceForNewVersion(reload: () => void = () => location.reload(), now = Date.now()): boolean {
  if (now - lastReload() < WINDOW_MS) return false;
  try {
    sessionStorage.setItem(KEY, String(now));
  } catch {
    return false;
  }
  reloading = true;
  reload();
  return true;
}

/** A reload the operator asked for: always reloads, and lets the next stale chunk reload once again. */
export function reloadConsole(reload: () => void = () => location.reload()): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing recorded, nothing to clear.
  }
  reload();
}

/**
 * Vite fires `vite:preloadError` when a chunk or its CSS cannot be preloaded. Reload once; past the
 * guard, let the error reach the page's error boundary, which offers the reload instead.
 */
export function installChunkReload(target: Window = window, reload?: () => void): () => void {
  const listener = (event: Event) => {
    if (reloadOnceForNewVersion(reload)) event.preventDefault();
  };
  target.addEventListener('vite:preloadError', listener);
  return () => target.removeEventListener('vite:preloadError', listener);
}
