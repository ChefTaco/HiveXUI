import { useState } from 'react';
import { AlertCircle, AlertTriangle, Bell, Check, CheckCheck, Info } from 'lucide-react';
import { Badge, Button, EmptyState, IconButton } from '@ui';
import { cn } from '@lib/cn';
import { formatTime, relativeTime } from '@lib/format';
import { useToast } from '../../../../../components/toast';
import { magnus } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel } from '../../../effects';
import { LoadingRows, ResourceError } from '../../../ui/resource-state';
import { severityTone } from '../shared/severity';
import { useArrivals } from '../shared/sweep';
import { notificationListResponseSchema, notificationMarkedResponseSchema, notificationUnreadResponseSchema, type NotificationItem } from './schemas';

const PAGE_SIZE = 20;
const POLL_MS = 30_000;

function SeverityIcon({ severity }: { severity: string }) {
  const tone = severityTone(severity);
  if (tone === 'danger') return <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />;
  if (tone === 'warning') return <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />;
  return <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />;
}

/** The old console's header bell. Read state is shared by the whole installation, as the API keeps it. */
export function InboxPanel() {
  const toast = useToast();
  const list = useMagnusResource((signal) => magnus.get('/notifications', notificationListResponseSchema, { query: { pageSize: PAGE_SIZE }, signal }), [], { pollMs: POLL_MS });
  const unread = useMagnusResource((signal) => magnus.get('/notifications/unread-count', notificationUnreadResponseSchema, { signal }), [], { pollMs: POLL_MS });
  const [busy, setBusy] = useState('');
  async function mark(path: '/notifications/read' | '/notifications/read-all', key: string, body?: { ids: string[] }) {
    setBusy(key);
    try {
      await magnus.post(path, notificationMarkedResponseSchema, body ? { body } : {});
      await Promise.all([list.refresh(), unread.refresh()]);
    } catch (error) {
      toast.error('Notifications could not be marked read', errorMessage(error));
    } finally {
      setBusy('');
    }
  }
  const items = list.data?.data.notifications;
  const arrival = useArrivals(items?.map(({ id }) => id));
  const count = unread.data?.data.count ?? 0;
  return (
    <FxPanel
      title={<span className="flex items-center gap-2"><Bell className="size-4 text-accent" />Recent<span className="num text-sm font-normal text-text-muted">{count ? `${count} unread` : ''}</span></span>}
      interactive={false}
      actions={count > 0 ? <Button size="sm" icon={<CheckCheck className="size-4" />} loading={busy === 'all'} onClick={() => void mark('/notifications/read-all', 'all')}>Mark all read</Button> : undefined}
    >
      {!items ? (
        list.loading ? <LoadingRows rows={3} /> : <ResourceError error={list.error} title="Notifications could not be loaded" onRetry={() => void list.refresh()} />
      ) : items.length === 0 ? (
        <EmptyState compact icon={<Bell className="size-4" />} title="No notifications yet" />
      ) : (
        <>
          <ul className="m-0 grid max-h-96 list-none grid-cols-1 gap-1.5 overflow-y-auto p-0" tabIndex={0} aria-label="Recent notifications">
            {items.map((item) => <InboxRow key={item.id} item={item} sweep={arrival(item.id)} busy={busy === item.id} onRead={() => void mark('/notifications/read', item.id, { ids: [item.id] })} />)}
          </ul>
          {(list.data?.data.total ?? 0) > items.length ? <p className="m-0 mt-2 text-sm text-text-muted">Showing the newest {items.length} of {list.data?.data.total}.</p> : null}
        </>
      )}
    </FxPanel>
  );
}

function InboxRow({ item, sweep, busy, onRead }: { item: NotificationItem; sweep: string; busy: boolean; onRead: () => void }) {
  return (
    <li className={cn(sweep, 'flex items-start gap-3 rounded-chip border border-border px-3 py-2', item.isRead ? 'bg-surface-raised' : 'bg-accent-soft')}>
      <SeverityIcon severity={item.severity} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2">
          <span className={cn('font-semibold', item.isRead && 'text-text-muted')}>{item.title}</span>
          <Badge>{item.type}</Badge>
        </div>
        <p className="m-0 mt-0.5 break-words text-sm text-text-muted">{item.message}</p>
        <span className="text-xs text-text-muted" title={formatTime(item.createdAt)}>{item.nodeName ? `${item.nodeName} · ` : ''}{relativeTime(item.createdAt)}</span>
      </div>
      {!item.isRead ? <IconButton label={`Mark "${item.title}" read`} icon={<Check className="size-4" />} disabled={busy} onClick={onRead} /> : null}
    </li>
  );
}
