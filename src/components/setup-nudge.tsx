// The header nudge toward the Setup page: shown to administrators while the Hive Registry's setup
// checklist has a pending item, and hidden when it has none or the Registry records no checklist.
import { ClipboardList } from 'lucide-react';
import { isAdministrator } from '../lib/permissions';
import { pendingSetupItems, useRegistry } from '../lib/registry';
import type { AdminUser } from '../lib/types';

export function SetupNudge({ user, onOpen }: { user: AdminUser | null; onOpen: () => void }) {
  const pending = pendingSetupItems(useRegistry()).length;
  if (!isAdministrator(user) || pending === 0) return null;
  // The visible words lead the accessible name: "Setup 2 steps pending".
  return (
    <button type="button" className="topbar-search setup-nudge" onClick={onOpen} title="Open the setup checklist">
      <ClipboardList aria-hidden="true" />
      <span>Setup</span> <span className="setup-nudge__count">{pending}</span>
      <span className="sr-only"> {pending === 1 ? 'step' : 'steps'} pending</span>
    </button>
  );
}
