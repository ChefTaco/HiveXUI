import { useState } from 'react';
import { IconButton } from '@ui';
import { Sparkles, ZapOff } from 'lucide-react';
import { cn } from '@lib/cn';
import { HaloDot, MagnusMark, Ticker, toggleFxLevel, type TickerItem } from '../effects';
import type { FeedSeverity, LiveStatus } from './feed';
import { eventTime } from './live-list';
import { useEventFeed } from './use-live-events';

const SEVERITY_TEXT: Record<FeedSeverity, string> = { info: 'text-accent', success: 'text-success', warning: 'text-warning', error: 'text-danger' };
const SEVERITY_DOT: Record<FeedSeverity, string> = { info: 'bg-accent', success: 'bg-success', warning: 'bg-warning', error: 'bg-danger' };

const STATUS: Record<LiveStatus, { label: string; title: string; text: string; tone: 'success' | 'warning' | 'info' | 'danger' }> = {
  waiting: { label: 'Recent', title: 'Showing recent activity. The live stream opens in a moment.', text: 'text-text-muted', tone: 'info' },
  connecting: { label: 'Connecting', title: 'Opening the live event stream', text: 'text-warning', tone: 'warning' },
  live: { label: 'Live', title: 'Live event stream connected', text: 'text-success', tone: 'success' },
  retrying: { label: 'Reconnecting', title: 'The live event stream dropped. Reconnecting.', text: 'text-warning', tone: 'warning' },
  stopped: { label: 'Not live', title: 'The live event stream is off', text: 'text-danger', tone: 'danger' },
};

/** The band above every Magnus page: the mark, the connection light and a marquee of fleet events. */
export function LiveBand() {
  const { status, detail, entries } = useEventFeed();
  const look = STATUS[status];
  const [low, setLow] = useState(() => document.documentElement.dataset.fx === 'low');
  const items: TickerItem[] = entries.slice(0, 12).map((entry) => ({
    key: entry.id,
    content: (
      <>
        <span aria-hidden="true" className={cn('size-1.5 rounded-full', SEVERITY_DOT[entry.severity])} />
        <span className="num text-text-muted">{eventTime(entry.at)}</span>
        <span className={SEVERITY_TEXT[entry.severity]}>{entry.title}</span>
        {entry.message ? <span className="text-text-muted">{entry.message}</span> : null}
      </>
    ),
  }));
  return (
    <div className="fx-live-band">
      <MagnusMark />
      <span className="flex shrink-0 items-center gap-1.5" title={detail ?? look.title}>
        <HaloDot tone={look.tone} active={status === 'live'} />
        <span className={cn('stat-label', look.text)}>{look.label}</span>
      </span>
      {items.length ? (
        <Ticker items={items} label="Recent fleet events" className="flex-1" />
      ) : (
        <span className="flex-1 truncate text-text-muted">
          Waiting for fleet events<span className="fx-cursor" aria-hidden="true" />
        </span>
      )}
      <IconButton
        label={low ? 'Turn visual effects on' : 'Reduce visual effects'}
        icon={low ? <ZapOff className="size-4" /> : <Sparkles className="size-4" />}
        onClick={() => setLow(toggleFxLevel() === 'low')}
      />
    </div>
  );
}
