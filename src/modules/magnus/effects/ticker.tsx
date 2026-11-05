import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@lib/cn';
import { useReducedMotion } from './motion';

export interface TickerItem {
  key: string | number;
  content: ReactNode;
}

/**
 * A marquee of real items. Pauses on hover and focus, and shows only the newest item when motion is
 * reduced or there is nothing to scroll. The track is CSS, so it costs no timers or requests.
 */
export function Ticker({ items, label, secondsPerItem = 5, className }: { items: readonly TickerItem[]; label: string; secondsPerItem?: number; className?: string }) {
  const reduced = useReducedMotion();
  if (items.length === 0) return null;
  const latest = items[0]!;
  const moving = !reduced && items.length > 1;
  const style = { '--fx-ticker-duration': `${Math.max(20, items.length * secondsPerItem)}s` } as CSSProperties;
  return (
    <div className={cn('fx-ticker', className)} role="group" aria-label={label}>
      {moving ? (
        // The second copy makes the loop seamless and is hidden from assistive technology.
        <div className="fx-ticker__track" style={style}>
          <div className="flex shrink-0">{items.map((item) => <span key={item.key} className="inline-flex shrink-0 items-center gap-2 px-4">{item.content}</span>)}</div>
          <div className="flex shrink-0" aria-hidden="true">{items.map((item) => <span key={item.key} className="inline-flex shrink-0 items-center gap-2 px-4">{item.content}</span>)}</div>
        </div>
      ) : (
        <span className="inline-flex max-w-full items-center gap-2 truncate px-4">{latest.content}</span>
      )}
    </div>
  );
}
