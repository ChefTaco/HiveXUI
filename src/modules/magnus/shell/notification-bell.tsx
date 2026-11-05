// The top bar's bell. The shell loads this lazily and only with a Magnus session, so the module's
// client and contracts stay out of the main chunk.
import { useEffect, useRef, useState } from 'react';
import { CheckCheck } from 'lucide-react';
import { Button, StatusDot } from '@ui';
import { relativeTime } from '@lib/format';
import { cn } from '@lib/cn';
import { Icon } from '../../../components/icons';
import { useToast } from '../../../components/toast';
import { magnus } from '../api/client';
import { errorMessage } from '../api/errors';
import { useMagnusResource } from '../api/use-resource';
import { notificationListResponseSchema, notificationMarkedResponseSchema, notificationUnreadResponseSchema } from '../pages/fleet/notifications/schemas';

const POLL_MS = 30_000;
const SHOWN = 6;
const STATUS: Record<string, string> = { critical: 'FAILED', error: 'FAILED', warning: 'DEGRADED', info: 'PROVISIONING' };

export const unreadLabel = (count: number): string => (count > 99 ? '99+' : String(count));

export default function NotificationBell({ onOpenInbox }: { onOpenInbox: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const unread = useMagnusResource((signal) => magnus.get('/notifications/unread-count', notificationUnreadResponseSchema, { signal }), [], { pollMs: POLL_MS });
  const list = useMagnusResource((signal) => magnus.get('/notifications', notificationListResponseSchema, { query: { pageSize: SHOWN }, signal }), [open], { enabled: open });
  const count = unread.data?.data.count ?? 0;
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | globalThis.KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  async function markAll() {
    setBusy(true);
    try {
      await magnus.post('/notifications/read-all', notificationMarkedResponseSchema);
      await Promise.all([unread.refresh(), list.refresh()]);
    } catch (error) {
      toast.error('Notifications could not be marked read', errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  const items = list.data?.data.notifications ?? [];
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className="topbar-icon"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        title="Notifications"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon.Bell aria-hidden="true" />
        {count > 0 ? <span className="topbar-icon__count" aria-hidden="true">{unreadLabel(count)}</span> : null}
      </button>
      {open ? (
        <div className="bell-menu panel-corners" role="group" aria-label="Recent notifications">
          <div className="bell-menu__head">
            <span className="stat-label">Notifications</span>
            {count > 0 ? <Button size="sm" variant="ghost" icon={<CheckCheck className="size-4" />} loading={busy} onClick={() => void markAll()}>Mark all read</Button> : null}
          </div>
          {list.loading && items.length === 0 ? <p className="bell-item text-text-muted" role="status">Loading notifications…</p> : null}
          {!list.loading && items.length === 0 ? <p className="bell-item text-text-muted">Nothing yet. Fleet alerts appear here.</p> : null}
          {items.map((item) => (
            <div key={item.id} className={cn('bell-item', !item.isRead && 'bell-item--unread')}>
              <span className="flex items-center gap-2 font-medium"><StatusDot status={STATUS[item.severity] ?? 'UNKNOWN'} pulse={false} />{item.title}</span>
              <small>{item.nodeName ? `${item.nodeName} · ` : ''}{relativeTime(item.createdAt)}</small>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => { setOpen(false); onOpenInbox(); }}>Open inbox</Button>
        </div>
      ) : null}
    </div>
  );
}
