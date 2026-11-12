import type { AnchorHTMLAttributes } from 'react';
import { navigateTo } from '../lib/routes';

/**
 * A link to an address inside HiveXUI, usually from `linkTo`. A plain click moves without a reload;
 * a modified click, or any other target, behaves as an ordinary link.
 */
export function RouteLink({ href, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target) return;
        if (!href.startsWith('/') || href.startsWith('//')) return;
        event.preventDefault();
        navigateTo(href);
      }}
    />
  );
}
