import type { ReactNode } from 'react';
import type { Tone } from '@ui';
import { cn } from '@lib/cn';
import { AnimatedNumber, FxPanel, Gauge, GLOW_TEXT, TONE_TEXT } from '../../../effects';

type FxTone = 'accent' | 'success' | 'warning' | 'danger' | 'info';

/** A label above its value, as the old console's detail grids had. */
export function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <span className="block text-xs text-text-muted">{label}</span>
      <span className="mt-0.5 block min-w-0 break-words text-sm text-text">{children}</span>
    </div>
  );
}

/** A counted figure that glows by meaning. `value` is null while it is unknown. */
export function StatTile({ icon, label, value, tone = 'accent' }: { icon: ReactNode; label: string; value: number | null; tone?: FxTone }) {
  // A zero is nothing to shout about, whatever the tile's color would mean.
  const lit = value !== null && value > 0;
  return (
    <FxPanel padding="sm" hero fxTone={tone}>
      <span className="flex items-center gap-2 text-xs text-text-muted"><span className={TONE_TEXT[tone]}>{icon}</span>{label}</span>
      <AnimatedNumber value={value} className={cn('mt-2 block text-2xl font-bold', lit ? [TONE_TEXT[tone], GLOW_TEXT[tone]] : 'text-text')} />
    </FxPanel>
  );
}

/** The hero of an overview: a real ratio on a lit gauge, beside its figures. An empty fleet shows a dash. */
export function PostureHero({ label, sublabel, value, max, children }: { label: string; sublabel: string; value: number | null; max: number; children: ReactNode }) {
  const empty = value === null || max === 0;
  const tone: Tone | undefined = empty ? 'neutral' : undefined;
  return (
    <FxPanel hero interactive={false}>
      <div className="flex flex-wrap items-center gap-6">
        <Gauge value={empty ? null : value} max={max || 1} higherIsBetter label={label} sublabel={sublabel} tone={tone} {...(empty ? {} : { display: `${value}/${max}` })} />
        <div className="grid min-w-0 flex-1 basis-64 grid-cols-2 gap-3 lg:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">{children}</div>
      </div>
    </FxPanel>
  );
}
