import { lazy, Suspense } from 'react';
import { Skeleton } from '@ui';
import type { AreaChartProps } from './area-chart';

export type { AreaChartProps, AreaSeries } from './area-chart';
const Chart = lazy(() => import('./area-chart'));

/** recharts stays out of every chunk but its own until a chart actually renders. */
export function LazyAreaChart(props: AreaChartProps) {
  return (
    <Suspense fallback={<Skeleton className="h-44" />}>
      <Chart {...props} />
    </Suspense>
  );
}
