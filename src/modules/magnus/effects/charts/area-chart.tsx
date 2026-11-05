import { useId, useMemo } from 'react';
import { Area, AreaChart as RechartsAreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Tone } from '@ui';
import { useReducedMotion } from '../motion';
import { TONE_COLOR } from '../tones';

export interface AreaSeries {
  key: string;
  label: string;
  tone: Tone;
}
export interface AreaChartProps {
  data: Array<Record<string, number | string | null>>;
  xKey: string;
  series: AreaSeries[];
  height?: number;
  /** Fix the Y axis to 0-100 and add a % suffix. */
  percent?: boolean;
  formatX?: (value: string | number) => string;
  className?: string;
}

/** Themed area chart. Import it only through ./lazy-area-chart, which keeps recharts in its own chunk. */
export default function AreaChart({ data, xKey, series, height = 180, percent = false, formatX, className }: AreaChartProps) {
  const reduced = useReducedMotion();
  const base = useId().replace(/:/g, '');
  const tick = useMemo(() => ({ fill: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }), []);
  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsAreaChart data={data} margin={{ top: 8, right: 24, bottom: 0, left: -8 }}>
          <defs>
            {series.map((item) => (
              <linearGradient key={item.key} id={`${base}-${item.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={TONE_COLOR[item.tone]} stopOpacity={0.35} />
                <stop offset="100%" stopColor={TONE_COLOR[item.tone]} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey={xKey} tick={tick} tickLine={false} axisLine={{ stroke: 'var(--border)' }} {...(formatX ? { tickFormatter: formatX } : {})} minTickGap={24} />
          <YAxis tick={tick} tickLine={false} axisLine={false} domain={percent ? [0, 100] : ['auto', 'auto']} {...(percent ? { tickFormatter: (value: number) => `${value}%` } : {})} width={48} />
          <Tooltip
            cursor={{ stroke: 'var(--accent)', strokeOpacity: 0.4 }}
            contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border-strong)', borderRadius: 6, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12 }}
            labelStyle={{ color: 'var(--text-muted)' }}
            {...(formatX ? { labelFormatter: (value: unknown) => formatX(value as string | number) } : {})}
            formatter={(value, name) => [typeof value === 'number' ? `${value.toFixed(1)}${percent ? '%' : ''}` : String(value), name]}
          />
          {series.map((item) => (
            <Area key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={TONE_COLOR[item.tone]} strokeWidth={1.5} className="fx-chart-line" fill={`url(#${base}-${item.key})`} dot={false} activeDot={{ r: 3, strokeWidth: 0, fill: TONE_COLOR[item.tone] }} isAnimationActive={!reduced} animationDuration={800} connectNulls />
          ))}
        </RechartsAreaChart>
      </ResponsiveContainer>
    </div>
  );
}
