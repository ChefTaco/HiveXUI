import { useId } from 'react';
import type { Tone } from './ui';
import { cn } from '@lib/cn';
import { TONE_COLOR } from './tones';

/** A small trend line with a fading fill, an optional threshold and a pulsing latest point. */
export function Sparkline({ values, tone = 'accent', width = 160, height = 32, area = true, max, percent = false, threshold, live = true, emptyLabel = 'Not enough data yet', label, stretch = false, className }: {
  values: readonly number[];
  tone?: Tone;
  width?: number;
  height?: number;
  area?: boolean;
  max?: number;
  percent?: boolean;
  threshold?: number;
  live?: boolean;
  emptyLabel?: string;
  label?: string;
  stretch?: boolean;
  className?: string;
}) {
  const gradient = `fx-spark${useId().replace(/:/g, '')}`;
  if (values.length < 2) return <div className={cn('flex h-8 items-center text-xs text-text-muted', className)}>{emptyLabel}</div>;
  const color = TONE_COLOR[tone];
  const top = max ?? (percent ? Math.max(100, ...values) : Math.max(...values, threshold ?? 0) || 1);
  const pad = 2;
  const inner = height - pad * 2;
  const step = width / (values.length - 1);
  const y = (value: number) => pad + inner - (Math.max(0, value) / top) * inner;
  const points = values.map((value, index) => [index * step, y(value)] as const);
  const line = points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const last = points.at(-1)!;
  return (
    <svg width={stretch ? '100%' : width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio={stretch ? 'none' : undefined} className={cn('block overflow-visible', className)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {area && (
        <>
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <polygon points={`0,${height} ${line} ${width},${height}`} fill={`url(#${gradient})`} />
        </>
      )}
      {threshold !== undefined && <line x1={0} x2={width} y1={y(threshold)} y2={y(threshold)} stroke="var(--warning)" strokeOpacity={0.5} strokeDasharray="3 3" strokeWidth={1} />}
      <polyline fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" points={line} />
      {live && !stretch && (
        <>
          <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} className="origin-center animate-halo [transform-box:fill-box]" />
          <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
        </>
      )}
    </svg>
  );
}

/**
 * A stat tile's footer: the trend, edge to edge. A series with nothing to show renders nothing, which
 * leaves the tile's plain gradient: a flat line over a fading fill would look the same.
 */
export function TileTrend({ values, tone = 'accent' }: { values: readonly number[]; tone?: Tone }) {
  if (values.length < 2 || values.every((value) => value === values[0])) return null;
  return <Sparkline values={values} tone={tone} width={240} height={30} stretch live={false} />;
}
