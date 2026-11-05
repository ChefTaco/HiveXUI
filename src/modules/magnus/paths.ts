// Pure path mapping shared by the shell and the module. Imports nothing, so it adds next to
// nothing to the main chunk. The API and the old console speak console-relative paths ('/nodes');
// the browser address is under /fleet.
export const FLEET_PREFIX = '/fleet';
/** Paths the console serves outside this module. A link there stays as it is. */
const OTHER_MODULES = /^\/security-fusion(?:[/?#]|$)/;

export const isFleetPath = (pathname: string): boolean => pathname === FLEET_PREFIX || pathname.startsWith(FLEET_PREFIX + '/');

/** '/fleet/nodes/a' -> '/nodes/a'. The old console's page paths, which the route files use. */
export function toConsolePath(pathname: string): string {
  if (!isFleetPath(pathname)) return '/';
  const rest = pathname.slice(FLEET_PREFIX.length).replace(/\/+$/, '');
  return rest || '/';
}

/**
 * Map a console-relative href, including one sent by the API, into the browser address space.
 * Returns null for anything that is not a same-origin path, so a link from API data can never
 * lead out of the console, or run script. Render the text without a link in that case.
 */
export function toFleetHref(href: string | null | undefined): string | null {
  if (!href) return null;
  if (/[\\\s\u0000-\u001f]/.test(href)) return null;
  if (href.startsWith('?') || href.startsWith('#')) return href;
  if (!href.startsWith('/') || href.startsWith('//')) return null;
  const pathname = href.split(/[?#]/, 1)[0]!;
  for (const segment of pathname.split('/')) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (decoded === '.' || decoded === '..' || /[\\/]/.test(decoded)) return null;
  }
  if (isFleetPath(pathname) || OTHER_MODULES.test(href)) return href;
  return pathname === '/' ? FLEET_PREFIX + href.slice(1) : FLEET_PREFIX + href;
}
