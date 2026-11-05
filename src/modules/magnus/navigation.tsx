// Stands in for next/link and next/navigation in pages ported from the Magnus console. Paths stay
// console-relative in page code ('/nodes'), and this file maps them under /fleet.
import { useContext, useMemo, useSyncExternalStore, createContext, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { toConsolePath, toFleetHref } from './paths';

export { toFleetHref } from './paths';

const subscribe = (listener: () => void) => {
  window.addEventListener('popstate', listener);
  window.addEventListener('magnus-location', listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener('magnus-location', listener);
  };
};

/** The page path without /fleet, as next/navigation gave the old console. */
export function usePathname(): string {
  return toConsolePath(useSyncExternalStore(subscribe, () => location.pathname));
}
export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, () => location.search);
  return useMemo(() => new URLSearchParams(search), [search]);
}

export const RouteParams = createContext<Record<string, string>>({});
export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return useContext(RouteParams) as T;
}

function go(href: string, mode: 'push' | 'replace'): void {
  const target = toFleetHref(href);
  if (!target) throw new Error('Invalid Magnus route');
  if (mode === 'push') history.pushState(null, '', target);
  else history.replaceState(null, '', target);
  // The shell and every usePathname listen for this, as they do for browser back and forward.
  window.dispatchEvent(new PopStateEvent('popstate'));
  if (mode === 'push' && !target.includes('#')) window.scrollTo?.(0, 0);
  requestAnimationFrame(() => document.querySelector<HTMLElement>('.topbar .title')?.focus({ preventScroll: true }));
}

const refreshEvent = 'magnus-refresh';
export function useRouter() {
  return useMemo(
    () => ({
      push: (href: string) => go(href, 'push'),
      replace: (href: string) => go(href, 'replace'),
      back: () => history.back(),
      forward: () => history.forward(),
      /** useMagnusResource reloads on this. */
      refresh: () => window.dispatchEvent(new Event(refreshEvent)),
    }),
    [],
  );
}
export const onMagnusRefresh = (listener: () => void): (() => void) => {
  window.addEventListener(refreshEvent, listener);
  return () => window.removeEventListener(refreshEvent, listener);
};

export class MagnusNotFound extends Error {
  constructor() {
    super('This page or record does not exist');
  }
}
export function notFound(): never {
  throw new MagnusNotFound();
}
export function redirect(href: string): never {
  go(href, 'replace');
  throw new MagnusNotFound();
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string; prefetch?: boolean; replace?: boolean; children?: ReactNode };

/** A link to a console-relative path, for example from API data. An unsafe href renders as text. */
export default function Link({ href, onClick, prefetch: _prefetch, replace, children, ...props }: LinkProps) {
  const target = toFleetHref(href);
  if (!target) return <span className={props.className}>{children}</span>;
  return (
    <a
      {...props}
      href={target}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target) return;
        event.preventDefault();
        go(href, replace ? 'replace' : 'push');
      }}
    >
      {children}
    </a>
  );
}
