import AreaChart, { type AreaChartProps } from './area-chart';

export type { AreaChartProps, AreaSeries } from './area-chart';

/**
 * The fleet area chart. It is plain SVG now, small enough to ship with the pages that use it; the
 * name stays from when it loaded a charting library on demand.
 */
export function LazyAreaChart(props: AreaChartProps) {
  return <AreaChart {...props} />;
}
