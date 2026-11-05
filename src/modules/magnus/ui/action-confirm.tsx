import type { ComponentProps } from 'react';
import { ConfirmDialog } from '@ui';

/**
 * ConfirmDialog for an action that deletes nothing. Its button always carries a trash icon, which
 * would misdescribe running a canary or approving a plan, so that icon is hidden here.
 */
export function ActionConfirm(props: ComponentProps<typeof ConfirmDialog>) {
  return (
    <div className="contents [&_.btn-ico]:hidden">
      <ConfirmDialog {...props} />
    </div>
  );
}
