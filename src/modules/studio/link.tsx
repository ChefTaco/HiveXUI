import { useSyncExternalStore, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { goStudio, isStudioPath, leaveStudio, safeOrigin } from './paths';

const subscribe = (listener: () => void) => {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
};
/** The browser path, kept current through Studio's own moves and Back and Forward. */
export const useStudioPathname = (): string => useSyncExternalStore(subscribe, () => location.pathname);

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string; children?: ReactNode };

/**
 * A link inside Studio, or out of it to a console page. Studio links keep the console page Studio
 * was opened from; a console link leaves Studio. Anything else renders as text.
 */
export function StudioLink({ href, onClick, children, ...props }: LinkProps) {
  const pathname = href.split(/[?#]/, 1)[0]!;
  const inside = isStudioPath(pathname);
  if (!inside && !safeOrigin(href)) return <span className={props.className}>{children}</span>;
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target) return;
        event.preventDefault();
        if (inside) goStudio(href);
        else leaveStudio(href);
      }}
    >
      {children}
    </a>
  );
}
