import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { Tone } from '@ui';
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

const MARGIN = { top: 8, right: 24, bottom: 22, left: 40 };
const X_TICKS = 5;

const numeric = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Round axis bounds and up to five evenly spaced ticks between them. */
export function axisTicks(min: number, max: number, percent: boolean): number[] {
  if (percent) return [0, 25, 50, 75, 100];
  if (!(max > min)) return [min - 1, min, min + 1];
  const raw = (max - min) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw) ?? raw;
  const ticks: number[] = [];
  for (let tick = Math.floor(min / step) * step; tick <= Math.ceil(max / step) * step + step / 2; tick += step) ticks.push(Number(tick.toFixed(10)));
  return ticks;
}

/**
 * Themed area chart in plain SVG: a dashed grid, an axis on each side, one fading area and glowing
 * line per series (gaps in a series are joined), and a tooltip that follows the pointer. The
 * summary of the latest values is its accessible name, since the shape itself is not readable.
 */
export default function AreaChart({ data, xKey, series, height = 180, percent = false, formatX, className }: AreaChartProps) {
  const base = useId().replace(/:/g, '');
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const element = box.current;
    if (!element) return undefined;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const label = (value: string | number | null | undefined) => (value === null || value === undefined ? '' : formatX ? formatX(value) : String(value));
  const format = (value: number) => `${value.toFixed(1)}${percent ? '%' : ''}`;

  const geometry = useMemo(() => {
    const values = data.flatMap((row) => series.map((item) => numeric(row[item.key])).filter((value): value is number => value !== null));
    const ticks = axisTicks(values.length ? Math.min(...values) : 0, values.length ? Math.max(...values) : 1, percent);
    const low = ticks[0]!;
    const high = ticks.at(-1)!;
    const plotWidth = Math.max(1, width - MARGIN.left - MARGIN.right);
    const plotHeight = Math.max(1, height - MARGIN.top - MARGIN.bottom);
    const x = (index: number) => MARGIN.left + (data.length > 1 ? (index / (data.length - 1)) * plotWidth : plotWidth / 2);
    const y = (value: number) => MARGIN.top + plotHeight - ((value - low) / (high - low || 1)) * plotHeight;
    const paths = series.map((item) => {
      const points = data.flatMap((row, index) => {
        const value = numeric(row[item.key]);
        return value === null ? [] : [[x(index), y(value)] as const];
      });
      const line = points.map(([px, py], index) => `${index ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
      const floor = (MARGIN.top + plotHeight).toFixed(1);
      const area = points.length ? `${line}L${points.at(-1)![0].toFixed(1)},${floor}L${points[0]![0].toFixed(1)},${floor}Z` : '';
      return { item, line, area };
    });
    const xTicks = data.length ? [...new Set(Array.from({ length: Math.min(X_TICKS, data.length) }, (_, index) => Math.round((index * (data.length - 1)) / Math.max(1, Math.min(X_TICKS, data.length) - 1))))] : [];
    return { ticks, x, y, paths, xTicks, plotHeight };
  }, [data, series, percent, width, height]);

  const latest = data.at(-1);
  const summary = latest
    ? `${series.map((item) => `${item.label} ${numeric(latest[item.key]) === null ? 'no value' : format(numeric(latest[item.key])!)}`).join(', ')} at ${label(latest[xKey] ?? null)}`
    : 'No data';

  function track(event: PointerEvent<SVGSVGElement>) {
    if (data.length === 0 || width === 0) return;
    const left = event.currentTarget.getBoundingClientRect().left;
    const plotWidth = Math.max(1, width - MARGIN.left - MARGIN.right);
    const ratio = (event.clientX - left - MARGIN.left) / plotWidth;
    setHover(Math.min(data.length - 1, Math.max(0, Math.round(ratio * (data.length - 1)))));
  }

  const row = hover === null ? undefined : data[hover];
  return (
    <div ref={box} className={className} style={{ height, position: 'relative' }}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={summary} className="block overflow-visible" onPointerMove={track} onPointerLeave={() => setHover(null)}>
          <defs>
            {series.map((item) => (
              <linearGradient key={item.key} id={`${base}-${item.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={TONE_COLOR[item.tone]} stopOpacity={0.35} />
                <stop offset="100%" stopColor={TONE_COLOR[item.tone]} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <g aria-hidden="true" fontFamily="var(--font-mono)" fontSize={12} fill="var(--text-muted)">
            {geometry.ticks.map((tick) => (
              <g key={tick}>
                <line x1={MARGIN.left} x2={width - MARGIN.right} y1={geometry.y(tick)} y2={geometry.y(tick)} stroke="var(--border)" strokeDasharray="2 4" />
                <text x={MARGIN.left - 6} y={geometry.y(tick)} textAnchor="end" dominantBaseline="middle">
                  {percent ? `${tick}%` : tick}
                </text>
              </g>
            ))}
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={MARGIN.top + geometry.plotHeight} y2={MARGIN.top + geometry.plotHeight} stroke="var(--border)" />
            {geometry.xTicks.map((index) => (
              <text key={index} x={geometry.x(index)} y={height - 6} textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}>
                {label(data[index]?.[xKey] ?? null)}
              </text>
            ))}
          </g>
          {geometry.paths.map(({ item, line, area }) => (
            <g key={item.key} className="fx-chart-line">
              <path d={area} fill={`url(#${base}-${item.key})`} />
              <path className="fx-chart-curve" d={line} fill="none" stroke={TONE_COLOR[item.tone]} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          ))}
          {hover !== null ? (
            <g aria-hidden="true">
              <line x1={geometry.x(hover)} x2={geometry.x(hover)} y1={MARGIN.top} y2={MARGIN.top + geometry.plotHeight} stroke="var(--accent)" strokeOpacity={0.4} />
              {series.map((item) => {
                const value = numeric(row?.[item.key]);
                return value === null ? null : <circle key={item.key} cx={geometry.x(hover)} cy={geometry.y(value)} r={3} fill={TONE_COLOR[item.tone]} />;
              })}
            </g>
          ) : null}
        </svg>
      ) : null}
      {row ? (
        <div
          className="fx-chart-tooltip"
          aria-hidden="true"
          style={{ left: Math.min(Math.max(geometry.x(hover!) + 8, 0), Math.max(0, width - 160)), top: MARGIN.top }}
        >
          <div className="fx-chart-tooltip__label">{label(row[xKey] ?? null)}</div>
          {series.map((item) => {
            const value = numeric(row[item.key]);
            return (
              <div key={item.key} style={{ color: TONE_COLOR[item.tone] }}>
                {item.label}: {value === null ? '—' : format(value)}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
