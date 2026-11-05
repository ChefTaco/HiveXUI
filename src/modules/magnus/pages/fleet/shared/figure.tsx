import type { ElementType, ReactNode } from 'react';
import type { Tone } from '@ui';
import { cn } from '@lib/cn';
import { AnimatedNumber, GLOW_TEXT, TONE_TEXT } from '../../../effects';

/** A headline figure in a lit tile. A number tweens when it changes; the color still carries the meaning. */
export function Figure({ label, value, sublabel, tone = 'accent', icon: Icon, className }: {
  label: string;
  value: number | string | null | undefined;
  sublabel?: ReactNode;
  tone?: Tone;
  icon?: ElementType;
  className?: string;
}) {
  return (
    <div className={cn('glow-hover relative min-w-0 rounded-panel border border-border bg-surface-raised p-3 hover:border-accent', className)}>
      <div className="flex items-center gap-2 text-xs font-medium text-text-muted">
        {Icon ? <Icon className="size-4 shrink-0" aria-hidden="true" /> : null}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn('num mt-1 truncate text-2xl font-bold', TONE_TEXT[tone], GLOW_TEXT[tone])}>
        {typeof value === 'number' ? <AnimatedNumber value={value} /> : value ?? '—'}
      </div>
      {sublabel ? <div className="mt-0.5 truncate text-xs text-text-muted">{sublabel}</div> : null}
    </div>
  );
}
