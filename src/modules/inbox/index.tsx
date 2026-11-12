// The Inbox page: every installed product's notable events, merged, with filters by product,
// severity and read state. The header bell shows the newest of the same list.
import { useMemo, useState } from 'react';
import { CheckCheck, RefreshCw } from 'lucide-react';
import { Button, FilterBar, PageHeader, Panel, Select, Toggle } from '@ui';
import type { ScreenProps } from '../../lib/routes';
import { useToast } from '../../components/toast';
import { describeApiError } from '../../lib/api-error';
import { filterEvents, HIVE_SEVERITIES, NO_FILTER, type InboxFilter } from './feeds';
import { InboxBody, SEVERITY_LABEL } from './event-list';
import { inboxFor, useInbox, type InboxStore } from './store';

export const inboxSubject = (user: ScreenProps['currentUser']): string => user?.id || 'operator';

export default function InboxScreen({ currentUser }: Pick<ScreenProps, 'currentUser'>) {
  return <InboxPage store={inboxFor(inboxSubject(currentUser))} />;
}

export function InboxPage({ store }: { store: InboxStore }) {
  const inbox = useInbox(store);
  const toast = useToast();
  const [filter, setFilter] = useState<InboxFilter>(NO_FILTER);
  const [busy, setBusy] = useState<'refresh' | 'read' | null>(null);
  const events = useMemo(() => filterEvents(inbox.events, filter, inbox.read), [inbox.events, inbox.read, filter]);
  const filtered = filter.product !== 'all' || filter.severity !== 'all' || filter.unreadOnly;

  async function run(kind: 'refresh' | 'read') {
    setBusy(kind);
    try {
      if (kind === 'refresh') await store.refresh();
      else await store.markAllRead();
    } catch (error) {
      toast.error('Magnus did not mark its notifications read', describeApiError(error));
    } finally {
      setBusy(null);
    }
  }

  const productOptions = [{ value: 'all', label: 'All products' }, ...inbox.sources.map((source) => ({ value: source.product, label: source.name }))];
  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Hive"
        title="Inbox"
        description="Notable events from every installed product that serves an event feed, newest first."
        actions={
          <>
            <Button variant="ghost" icon={<RefreshCw className="size-4" />} loading={busy === 'refresh'} onClick={() => void run('refresh')}>
              Refresh
            </Button>
            <Button icon={<CheckCheck className="size-4" />} loading={busy === 'read'} disabled={inbox.unread === 0} onClick={() => void run('read')}>
              Mark all read
            </Button>
          </>
        }
      />
      <Panel padding="sm">
        <div className="grid gap-4">
          <FilterBar label="Inbox filters" actions={<span className="text-sm text-text-muted">{inbox.unread} unread</span>}>
            <Select aria-label="Product" value={filter.product} options={productOptions} onChange={(product) => setFilter((current) => ({ ...current, product }))} />
            <Select
              aria-label="Severity"
              value={filter.severity}
              options={[{ value: 'all', label: 'All severities' }, ...HIVE_SEVERITIES.map((value) => ({ value, label: SEVERITY_LABEL[value] }))]}
              onChange={(severity) => setFilter((current) => ({ ...current, severity: severity as InboxFilter['severity'] }))}
            />
            <Toggle label="Unread only" checked={filter.unreadOnly} onChange={(unreadOnly) => setFilter((current) => ({ ...current, unreadOnly }))} />
          </FilterBar>
          <InboxBody inbox={inbox} events={events} filtered={filtered} label="Events" onRetry={() => void run('refresh')} onClearFilters={() => setFilter(NO_FILTER)} />
        </div>
      </Panel>
    </div>
  );
}
