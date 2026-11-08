// Pure path handling shared by the shell and the Studio module. Imports nothing, so it adds next to
// nothing to the main chunk. Studio is a fullscreen page under /studio that the console opens and
// closes; the console page it was opened from travels with it in history.state.
export const STUDIO_PREFIX = '/studio';
/** The history.state key that holds the console address Studio was opened from. */
const ORIGIN_KEY = 'studioOrigin';

export const isStudioPath = (pathname: string): boolean => pathname === STUDIO_PREFIX || pathname.startsWith(STUDIO_PREFIX + '/');

/** A console address Studio may return to: same-origin, outside Studio, nothing that could run script. */
export function safeOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\s\u0000-\u001f]/.test(value)) return null;
  const pathname = value.split(/[?#]/, 1)[0]!;
  return isStudioPath(pathname) ? null : value;
}

/** Where ✕ goes: the stored console page, or the suite home. */
export function studioOrigin(state: unknown = history.state): string {
  const stored = state && typeof state === 'object' ? (state as Record<string, unknown>)[ORIGIN_KEY] : undefined;
  return safeOrigin(stored) ?? '/';
}

const announce = () => window.dispatchEvent(new PopStateEvent('popstate'));

/** Opens Studio from a console page, remembering that page for ✕. */
export function openStudio(path: string = STUDIO_PREFIX): void {
  if (!isStudioPath(path.split(/[?#]/, 1)[0]!)) throw new Error('Not a Studio address');
  history.pushState({ [ORIGIN_KEY]: safeOrigin(location.pathname + location.search + location.hash) ?? '/' }, '', path);
  announce();
}

/** Moves within Studio. The origin stays with every entry, so ✕ works after a reload or Back. */
export function goStudio(path: string, mode: 'push' | 'replace' = 'push'): void {
  if (!isStudioPath(path.split(/[?#]/, 1)[0]!)) throw new Error('Not a Studio address');
  const state = { [ORIGIN_KEY]: studioOrigin() };
  if (mode === 'push') history.pushState(state, '', path);
  else history.replaceState(state, '', path);
  announce();
}

/** Leaves Studio for a console address: ✕, or a link to a console page. */
export function leaveStudio(target: string = studioOrigin()): void {
  history.pushState(null, '', safeOrigin(target) ?? '/');
  announce();
}
