// The header bell: the unread count across every product's feed, and a drawer with the newest
// events. The shell loads it lazily; the Inbox page shows the whole list.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCheck } from 'lucide-react';
import { Button, Drawer } from '@ui';
import { Icon } from '../../components/icons';
import { useToast } from '../../components/toast';
import { describeApiError } from '../../lib/api-error';
import { unreadLabel } from './feeds';
import { InboxBody } from './event-list';
import { inboxFor, useInbox, type InboxStore } from './store';

/** Events the drawer shows; the page has the rest. */
export const SHOWN = 8;

export default function InboxBell({ subject, onOpenInbox }: { subject: string; onOpenInbox: () => void }) {
  return <InboxBellView store={inboxFor(subject)} onOpenInbox={onOpenInbox} />;
}

export function InboxBellView({ store, onOpenInbox }: { store: InboxStore; onOpenInbox: () => void }) {
  const inbox = useInbox(store);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const count = inbox.unread;

  async function markAll() {
    setBusy(true);
    try {
      await store.markAllRead();
    } catch (error) {
      toast.error('Magnus did not mark its notifications read', describeApiError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="topbar-icon"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={count > 0 ? `Inbox, ${count} unread` : 'Inbox'}
        title="Inbox"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon.Bell aria-hidden="true" />
        {count > 0 ? <span className="topbar-icon__count" aria-hidden="true">{unreadLabel(count)}</span> : null}
      </button>
      {/* The top bar blurs what is behind it, which would hold a fixed drawer inside it. */}
      {createPortal(
        <Drawer
          open={open}
          title="Inbox"
          eyebrow={count > 0 ? `${count} unread` : 'All caught up'}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="ghost" icon={<CheckCheck className="size-4" />} loading={busy} disabled={count === 0} onClick={() => void markAll()}>
                Mark all read
              </Button>
              <Button
                onClick={() => {
                  setOpen(false);
                  onOpenInbox();
                }}
              >
                Open inbox
              </Button>
            </>
          }
        >
          <InboxBody inbox={inbox} events={inbox.events.slice(0, SHOWN)} label="Newest events" onRetry={() => void store.refresh()} onFollow={() => setOpen(false)} />
        </Drawer>,
        document.body,
      )}
    </>
  );
}
