import { useState } from 'react';
import { IconButton } from '@ui';
import { Sparkles, ZapOff } from 'lucide-react';
import { cn } from '@lib/cn';
import { HaloDot, MagnusMark, Ticker, toggleFxLevel, type TickerItem } from '../effects';
import type { FeedSeverity } from './feed';
import { eventTime } from './live-list';
import { useEventFeed } from './use-live-events';

const SEVERITY_TEXT: Record<FeedSeverity, string> = { info: 'text-accent', success: 'text-success', warning: 'text-warning', error: 'text-danger' };
const SEVERITY_DOT: Record<FeedSeverity, string> = { info: 'bg-accent', success: 'bg-success', warning: 'bg-warning', error: 'bg-danger' };

/** The band above every Magnus page: the mark, the connection light and a marquee of fleet events. */
export function LiveBand() {
  const { connected, entries } = useEventFeed();
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
    <div className="flex min-w-0 items-center gap-3 rounded-panel border border-border bg-surface px-3 py-1.5 text-xs">
      <MagnusMark />
      <span className="flex shrink-0 items-center gap-1.5" title={connected ? 'Live event stream connected' : 'Live event stream connecting'}>
        <HaloDot tone={connected ? 'success' : 'info'} active={connected} />
        <span className={connected ? 'text-success' : 'text-text-muted'}>{connected ? 'Live' : 'Connecting'}</span>
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
