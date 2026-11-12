import { useState, type ReactNode } from 'react';
import type { z } from 'zod';
import { Clock, History } from 'lucide-react';
import type { timelineResponseSchema } from '@contracts/magnus/browser';
import { Badge, EmptyState, LoadingRows, ResourceError } from '@ui';
import { cn } from '@lib/cn';
import { formatTime } from '@lib/format';
import type { Resource } from '../../../api/use-resource';
import { errorMessage } from '../../../api/errors';
import { FxPanel } from '../../../effects';
import Link from '../../../navigation';
import { useMagnusSession } from '../../../session';
import { severityTone } from '../shared/severity';
import { useArrivals } from '../shared/sweep';
import { canFollow, countByType, keyedTimeline, TIMELINE_TYPES, type TimelineFilter } from './timeline-model';

/**
 * The fleet timeline: commands, deploys, Hermes jobs, logs, audit events and notifications in one stream,
 * filtered by type. Fleet readiness shows it in a scrolling panel; /fleet-timeline gives it the page.
 */
export function TimelinePanel({ resource, limit, full = false, actions }: {
  resource: Resource<z.output<typeof timelineResponseSchema>>;
  limit: number;
  /** On its own page the list runs the page's length instead of scrolling inside the panel. */
  full?: boolean;
  actions?: ReactNode;
}) {
  const session = useMagnusSession();
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const all = resource.data?.data;
  const items = all ? keyedTimeline(all, filter) : undefined;
  const counts = all ? countByType(all) : undefined;
  const arrival = useArrivals(all ? keyedTimeline(all).map(({ key }) => key) : undefined);
  return (
    <FxPanel
      id="fleet-timeline"
      title={<span className="flex items-center gap-2"><History className="size-4 text-accent" />Fleet timeline</span>}
      description="Recent commands, deploys, Hermes jobs, logs, audit events and notifications in one stream."
      interactive={false}
      className="scroll-mt-4"
      {...(actions ? { actions } : {})}
    >
      <div className="grid gap-3">
        <div className="segmented-tabs justify-self-start" role="group" aria-label="Filter the timeline by type">
          {(['all', ...TIMELINE_TYPES] as const).map((type) => (
            <button key={type} type="button" aria-pressed={filter === type} className={cn('tab-button capitalize', filter === type && 'tab-button--active')} onClick={() => setFilter(type)}>
              {type}
              {counts ? <span className="num ml-1.5 text-xs text-text-muted">{counts[type]}</span> : null}
            </button>
          ))}
        </div>
        {all && resource.error ? <p role="alert" className="m-0 text-sm text-warning">Showing the last good answer: {errorMessage(resource.error)}</p> : null}
        {!items ? (
          resource.loading ? <LoadingRows rows={6} /> : <ResourceError error={resource.error} title="Timeline data unavailable" onRetry={() => void resource.refresh()} />
        ) : items.length === 0 ? (
          <EmptyState compact icon={<Clock className="size-4" />} title={filter === 'all' ? 'Nothing on the timeline yet' : `No ${filter} events in the latest ${limit}`} />
        ) : (
          <ol className={cn('m-0 grid list-none grid-cols-1 gap-px p-0', !full && 'max-h-[32rem] overflow-y-auto')} {...(full ? {} : { tabIndex: 0 })} aria-label="Timeline events">
            {items.map((item) => (
              <li key={item.key} className={cn(arrival(item.key), 'fx-rail rounded-chip hover:bg-surface-hover')}>
                <div className="grid gap-x-3 gap-y-0.5 px-3 py-2 text-sm sm:grid-cols-[11rem_6rem_minmax(0,1fr)_5rem] sm:items-center">
                  <span className="num flex items-center gap-2 text-xs text-text-muted"><Clock className="size-3.5 shrink-0" aria-hidden="true" />{formatTime(item.timestamp)}</span>
                  <span className="text-xs font-medium capitalize text-accent">{item.type}</span>
                  <span className="min-w-0 break-words">
                    {canFollow(item.href, session) ? <Link href={item.href}>{item.title}</Link> : item.title}
                    {item.node ? <span className="block text-xs text-text-muted">{item.node}</span> : null}
                  </span>
                  <span><Badge tone={severityTone(item.severity)}>{item.severity}</Badge></span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </FxPanel>
  );
}
