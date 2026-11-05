import type { CSSProperties, ReactNode } from 'react';
import type { Tone } from './ui';
import { cn } from '@lib/cn';
import { DEFAULT_THRESHOLDS, GLOW_TEXT, thresholdTone, TONE_COLOR, TONE_TEXT, type Thresholds } from './tones';

const SWEEP = 0.75;

/** A 270 degree arc gauge that lights up and sweeps to its value. */
export function Gauge({ value, max = 100, label, sublabel, tone, thresholds = DEFAULT_THRESHOLDS, higherIsBetter = false, size = 140, display, ticks = true, hideLabel = false, className }: {
  value: number | null | undefined;
  max?: number;
  label: string;
  sublabel?: ReactNode;
  /** Fixed tone. Otherwise it follows thresholds. */
  tone?: Tone | undefined;
  thresholds?: Thresholds;
  higherIsBetter?: boolean;
  size?: number;
  display?: string | undefined;
  ticks?: boolean;
  hideLabel?: boolean;
  className?: string;
}) {
  const known = typeof value === 'number' && Number.isFinite(value);
  const percent = known ? Math.max(0, Math.min(100, (value / (max || 1)) * 100)) : 0;
  const resolved: Tone = tone ?? (!known ? 'neutral' : thresholdTone(higherIsBetter ? 100 - percent : percent, thresholds));
  const stroke = Math.max(4, Math.round(size / 16));
  const radius = 50 - stroke / 2 - 4;
  const circumference = 2 * Math.PI * radius;
  const track = circumference * SWEEP;
  const fill = (track * percent) / 100;
  const hero = size >= 140;
  const text = display ?? (known ? `${Math.round(percent)}%` : '—');
  return (
    <div role="img" aria-label={`${label}: ${text}`} className={cn('relative inline-flex flex-col items-center', className)} style={{ width: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" className="overflow-visible">
        {ticks &&
          Array.from({ length: 11 }, (_, index) => {
            const angle = ((135 + (270 * index) / 10) * Math.PI) / 180;
            const outer = 48.5;
            const inner = 50 - (index % 5 === 0 ? 4 : 2.5);
            return <line key={index} x1={50 + outer * Math.cos(angle)} y1={50 + outer * Math.sin(angle)} x2={50 + inner * Math.cos(angle)} y2={50 + inner * Math.sin(angle)} stroke="var(--border-strong)" strokeWidth={0.8} />;
          })}
        <circle cx={50} cy={50} r={radius} fill="none" stroke="var(--border)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${track} ${circumference}`} transform="rotate(135 50 50)" />
        <circle cx={50} cy={50} r={radius} fill="none" stroke={TONE_COLOR[resolved]} strokeWidth={stroke} strokeLinecap="round" transform="rotate(135 50 50)" className={cn('fx-gauge__value', TONE_TEXT[resolved])} style={{ '--fx-dash': `${fill} ${circumference}` } as CSSProperties} />
      </svg>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center justify-center" style={{ height: size }}>
        <span className={cn('num data-figure font-bold leading-none', hero ? 'text-3xl' : 'text-sm', TONE_TEXT[resolved], hero && GLOW_TEXT[resolved])}>{text}</span>
        {sublabel ? <span className="num mt-1 text-xs text-text-muted">{sublabel}</span> : null}
      </div>
      {!hideLabel && <span className="stat-label -mt-[10%] text-center">{label}</span>}
    </div>
  );
}
