import { useState } from 'react';
import { LineChart } from 'lucide-react';
import { nodeHealthTimeseriesResponseSchema } from '@contracts/magnus/browser';
import { EmptyState, Skeleton } from '@ui';
import { cn } from '@lib/cn';
import { magnus, segment } from '../../../api/client';
import { useMagnusResource } from '../../../api/use-resource';
import { LazyAreaChart } from '../../../effects';

const PERIODS = ['1h', '6h', '24h'] as const;
type Period = (typeof PERIODS)[number];
const REFRESH_MS = 60_000;

export interface MetricRow {
  [key: string]: number | null;
  t: number;
  cpu: number | null;
  mem: number | null;
}

/** One row per sample, in time order. CPU and memory come from separate reads. */
export function mergeSeries(cpu: { timestamps: readonly string[]; values: readonly number[] }, memory: { timestamps: readonly string[]; values: readonly number[] }): MetricRow[] {
  const rows = new Map<number, MetricRow>();
  cpu.timestamps.forEach((timestamp, index) => {
    const t = Date.parse(timestamp);
    rows.set(t, { t, cpu: cpu.values[index] ?? null, mem: null });
  });
  memory.timestamps.forEach((timestamp, index) => {
    const t = Date.parse(timestamp);
    const row = rows.get(t) ?? { t, cpu: null, mem: null };
    row.mem = memory.values[index] ?? null;
    rows.set(t, row);
  });
  return [...rows.values()].sort((left, right) => left.t - right.t);
}

const clock = (value: string | number) => new Date(Number(value)).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit' });

/** CPU and memory history for one node. */
export function NodeMetricsChart({ nodeId, height = 180 }: { nodeId: string; height?: number }) {
  const [period, setPeriod] = useState<Period>('1h');
  const series = useMagnusResource(
    async (signal) => {
      const read = (metric: 'cpu' | 'memory') => magnus.get(`/nodes/${segment(nodeId)}/health/timeseries`, nodeHealthTimeseriesResponseSchema, { query: { metric, period }, signal });
      const [cpu, memory] = await Promise.all([read('cpu'), read('memory')]);
      return { period, rows: mergeSeries(cpu.data, memory.data) };
    },
    [nodeId, period],
    { pollMs: REFRESH_MS },
  );
  // The last answer stays until the next one, so changing the period does not blank the chart.
  const rows = series.data?.rows;
  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-text-muted">CPU / memory history</span>
        <div role="group" aria-label="History period" className="segmented-tabs">
          {PERIODS.map((option) => (
            <button key={option} type="button" aria-pressed={period === option} onClick={() => setPeriod(option)} className={cn('tab-button', period === option && 'tab-button--active glow-accent')}>{option}</button>
          ))}
        </div>
      </div>
      {!rows && series.loading ? (
        <Skeleton className="w-full" />
      ) : !rows || rows.length < 2 ? (
        <EmptyState
          compact
          icon={<LineChart className="size-4" />}
          title={series.error ? 'History unavailable' : 'Not enough samples yet'}
          message={series.error ? 'The health timeseries endpoint did not answer.' : `No health snapshots in the last ${series.data?.period ?? period}.`}
          tone={series.error ? 'warning' : 'neutral'}
          className="flex-1"
        />
      ) : (
        <LazyAreaChart data={rows} xKey="t" percent height={height} formatX={clock} series={[{ key: 'cpu', label: 'CPU', tone: 'accent' }, { key: 'mem', label: 'Memory', tone: 'info' }]} />
      )}
    </div>
  );
}
