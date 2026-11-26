/**
 * "Skip to content" (WCAG 2.4.1): the first stop for the keyboard, shown when focused. It moves
 * focus to the main region without touching the address, which the console's routing owns.
 */
export function SkipLink({ target = 'main-content' }: { target?: string }) {
  return (
    <a
      className="skip-link"
      href={`#${target}`}
      onClick={(event) => {
        event.preventDefault();
        const main = document.getElementById(target);
        main?.focus();
        main?.scrollIntoView?.({ block: 'start' });
      }}
    >
      Skip to content
    </a>
  );
}
