// The parts the Inbox page and the header drawer share: one event, the "couldn't reach" rows, and
// the loading, error and empty states.
import { AlertTriangle, Inbox as InboxIcon } from 'lucide-react';
import { Badge, Button, EmptyState, LoadingRows, ResourceError, StatusDot, type Tone } from '@ui';
import { relativeTime, formatTime } from '@lib/format';
import { cn } from '@lib/cn';
import { knownAddress } from '../../lib/navigation';
import { productInstalled } from '../../lib/runtime';
import { RouteLink } from '../../components/route-link';
import { isUnread, type HiveEvent, type HiveEventSeverity, type ReadState } from './feeds';
import type { InboxSnapshot, SourceStatus } from './store';

const DOT: Record<HiveEventSeverity, string> = { critical: 'CRITICAL', warning: 'DEGRADED', info: 'PROVISIONING' };
const TONE: Record<HiveEventSeverity, Tone> = { critical: 'danger', warning: 'warning', info: 'info' };
export const SEVERITY_LABEL: Record<HiveEventSeverity, string> = { critical: 'Critical', warning: 'Warning', info: 'Info' };

export const productName = (sources: readonly SourceStatus[], product: string): string => sources.find((source) => source.product === product)?.name ?? product;

export function EventItem({ event, read, name, onFollow }: { event: HiveEvent; read: ReadState; name: string; onFollow?: () => void }) {
  const unread = isUnread(event, read);
  // An event's link is a HiveXUI path; only a page the route table knows becomes a link.
  const href = knownAddress(event.link.path, productInstalled);
  return (
    <li className={cn('inbox-item', unread && 'inbox-item--unread')}>
      <StatusDot status={DOT[event.severity]} pulse={false} className="inbox-item__dot" />
      <div className="inbox-item__body">
        <p className="inbox-item__title">
          {href ? (
            <RouteLink href={href} onClick={() => onFollow?.()}>
              {event.title}
            </RouteLink>
          ) : (
            event.title
          )}
          {unread ? <span className="sr-only"> (unread)</span> : null}
        </p>
        {event.summary ? <p className="inbox-item__summary">{event.summary}</p> : null}
        <p className="inbox-item__meta">
          <Badge>{name}</Badge>
          <Badge tone={TONE[event.severity]}>{SEVERITY_LABEL[event.severity]}</Badge>
          <time dateTime={event.occurredAt} title={formatTime(event.occurredAt)}>
            {relativeTime(event.occurredAt)}
          </time>
          {href ? null : <span className="inbox-item__path">{event.link.path}</span>}
        </p>
      </div>
    </li>
  );
}

/** One row per product whose last read failed. It never hides the other products' events. */
export function FailedSources({ sources }: { sources: readonly SourceStatus[] }) {
  const failed = sources.filter((source) => source.state === 'failed');
  if (failed.length === 0) return null;
  return (
    <ul className="inbox-failures" aria-label="Products that did not answer">
      {failed.map((source) => (
        <li key={source.product} className="inbox-failure">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <span>
            Couldn't reach {source.name}. {source.error}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The list, or the state that stands for it: loading before the first round, the Registry's error,
 * no product with a feed, or nothing to show.
 */
export function InboxBody({
  inbox,
  events,
  filtered,
  onRetry,
  onFollow,
  onClearFilters,
  label,
}: {
  inbox: InboxSnapshot;
  /** What to list, newest first. */
  events: readonly HiveEvent[];
  /** Filters are on, so an empty list says so. */
  filtered?: boolean;
  onRetry: () => void;
  onFollow?: () => void;
  onClearFilters?: () => void;
  label: string;
}) {
  if (inbox.phase === 'loading' && inbox.events.length === 0)
    return (
      <div className="grid gap-3">
        <p role="status" className="text-sm text-text-muted">
          Loading the inbox…
        </p>
        <LoadingRows rows={4} />
      </div>
    );
  if (inbox.phase === 'error')
    return <ResourceError title="The inbox could not read the Hive Registry" error={new Error(`It lists which products serve events. ${inbox.registryError ?? ''}`.trim())} onRetry={onRetry} />;
  if (inbox.sources.length === 0)
    return (
      <EmptyState
        icon={<InboxIcon className="size-5" />}
        title="No product announces an event feed yet"
        message="Products list their event feed in the Hive Registry. When an installed product does, its events appear here."
      />
    );
  return (
    <div className="grid gap-3">
      <FailedSources sources={inbox.sources} />
      {events.length === 0 ? (
        <EmptyState
          compact
          icon={<InboxIcon className="size-5" />}
          title={filtered ? 'No events match these filters' : 'Nothing new'}
          message={filtered ? undefined : 'Notable events from the last 14 days appear here.'}
          action={filtered && onClearFilters ? <Button size="sm" variant="ghost" onClick={onClearFilters}>Clear filters</Button> : undefined}
        />
      ) : (
        <ul className="inbox-list" aria-label={label}>
          {events.map((event) => (
            <EventItem key={event.id} event={event} read={inbox.read} name={productName(inbox.sources, event.product)} {...(onFollow ? { onFollow } : {})} />
          ))}
        </ul>
      )}
    </div>
  );
}
