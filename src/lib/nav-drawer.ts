import { useEffect, type RefObject } from 'react';

/** The width at and below which the sidebar is a drawer over the page (`app.css`). */
export const NAV_DRAWER_QUERY = '(max-width: 920px)';

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]';

/**
 * The mobile navigation drawer while it is open: focus moves into it, Tab and Shift+Tab stay in it,
 * and Escape closes it and returns focus to the toggle. On a wide screen the sidebar is part of
 * the page, so only Escape applies.
 */
export function useNavigationDrawer(open: boolean, close: () => void, drawer: RefObject<HTMLElement | null>, toggle: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return undefined;
    const narrow = matchMedia(NAV_DRAWER_QUERY).matches;
    const focusable = () => [...(drawer.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((element) => element.getClientRects().length > 0);
    if (narrow) drawer.current?.querySelector<HTMLElement>('nav button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        toggle.current?.focus();
        return;
      }
      if (event.key !== 'Tab' || !narrow) return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) return;
      const inside = drawer.current?.contains(document.activeElement) ?? false;
      if (event.shiftKey && (document.activeElement === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, drawer, toggle]);
}
