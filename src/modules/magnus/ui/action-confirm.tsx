import type { ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmDialog } from '@ui';

/**
 * ConfirmDialog for an action that deletes nothing. Its button always carries a trash icon, which
 * would misdescribe running a canary or approving a plan, so that icon is hidden here. It renders on
 * the body, so an inner component can use it without being positioned inside an animated block, and
 * it keeps the message's line breaks, so a command can be shown exactly as it will run.
 */
export function ActionConfirm(props: ComponentProps<typeof ConfirmDialog>) {
  if (!props.open) return null;
  return createPortal(
    <div className="contents [&_.btn-ico]:hidden [&_p]:max-h-[50vh] [&_p]:overflow-auto [&_p]:break-words [&_p]:whitespace-pre-wrap">
      <ConfirmDialog {...props} />
    </div>,
    document.body,
  );
}
