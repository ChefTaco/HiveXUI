import { EmptyState } from '@ui';
import { Radio } from 'lucide-react';
import { cn } from '@lib/cn';
import { HaloDot } from '../effects';
import type { FeedSeverity } from './feed';
import { useEventFeed } from './use-live-events';

const SEVERITY_TONE: Record<FeedSeverity, 'accent' | 'success' | 'warning' | 'danger'> = { info: 'accent', success: 'success', warning: 'warning', error: 'danger' };
const SEVERITY_TEXT: Record<FeedSeverity, string> = { info: 'text-accent', success: 'text-success', warning: 'text-warning', error: 'text-danger' };
export const eventTime = (at: number): string => new Date(at).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** The newest fleet events, each sweeping in as it arrives. For a dashboard panel. */
export function LiveEventList({ limit = 8, className }: { limit?: number; className?: string }) {
  const { entries, connected } = useEventFeed();
  if (entries.length === 0) return <EmptyState compact icon={<Radio className="size-4" />} title={connected ? 'Listening for fleet events' : 'Event stream connecting'} message="Deploys, upgrades, command results and alerts appear here as they happen." {...(className ? { className } : {})} />;
  return (
    <ul className={cn('m-0 grid list-none grid-cols-1 gap-1.5 p-0', className)} aria-live="off">
      {entries.slice(0, limit).map((entry) => (
        <li key={entry.id} className="scan-sweep flex items-center gap-2.5 rounded-chip border border-border bg-surface-raised px-3 py-2 text-sm">
          <HaloDot tone={SEVERITY_TONE[entry.severity]} active={false} />
          <span className={cn('min-w-0 flex-1 truncate', SEVERITY_TEXT[entry.severity])}>
            {entry.title}
            {entry.message ? <span className="ml-2 text-text-muted">{entry.message}</span> : null}
          </span>
          <span className="num shrink-0 text-xs text-text-muted">{eventTime(entry.at)}</span>
        </li>
      ))}
    </ul>
  );
}
