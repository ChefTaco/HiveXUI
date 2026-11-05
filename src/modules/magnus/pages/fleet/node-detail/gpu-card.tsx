import { useId } from 'react';
import { z } from 'zod';
import { Fan, Gauge as GaugeIcon, Thermometer } from 'lucide-react';
import { gpuSnapshotPointSchema, nodeGpuResponseSchema } from '@contracts/magnus/browser';
import { Badge } from '@ui';
import { formatTime } from '@lib/format';
import { cn } from '@lib/cn';
import { FxMeter, FxPanel, TONE_COLOR } from '../../../effects';

type GpuTelemetry = z.output<typeof nodeGpuResponseSchema>['data'];
type GpuPoint = z.output<typeof gpuSnapshotPointSchema>;

/** Polyline points on a 600 by 112 chart, spread by time. Samples with no reading are skipped. */
export function chartPoints(history: readonly GpuPoint[], select: (point: GpuPoint) => number | null): string {
  const values = history.flatMap((point) => {
    const value = select(point);
    return value === null ? [] : [{ timestamp: new Date(point.sampledAt).getTime(), value }];
  });
  if (values.length === 0) return '';
  const start = values[0]!.timestamp;
  const span = Math.max(1, values.at(-1)!.timestamp - start);
  return values.map(({ timestamp, value }) => `${(((timestamp - start) / span) * 600).toFixed(1)},${(104 - Math.max(0, Math.min(100, value)) * 0.88).toFixed(1)}`).join(' ');
}

const metric = (value: number | null, suffix = '%') => (value === null ? 'not reported' : `${value.toFixed(1)}${suffix}`);

export function GpuTelemetryCard({ telemetry }: { telemetry: GpuTelemetry | null }) {
  const gradient = `gpu-load${useId().replace(/:/g, '')}`;
  const latest = telemetry?.latest ?? null;
  const devices = latest?.devices ?? [];
  const load = chartPoints(telemetry?.history ?? [], (point) => point.maxUtilizationPercent);
  const fan = chartPoints(telemetry?.history ?? [], (point) => point.maxFanPercent);
  return (
    <FxPanel title="GPU telemetry" description="30-second load and cooling history" actions={latest ? <Badge>sampled {formatTime(latest.sampledAt)}</Badge> : undefined}>
      {!latest || devices.length === 0 ? (
        <p className="m-0 rounded-panel border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
          {latest?.status === 'error' ? 'The GPU probe did not complete. Magnus will retry on the next heartbeat.' : 'No supported NVIDIA or AMD GPU was detected in the latest sample.'}
        </p>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {devices.map((device) => (
              <div key={`${device.vendor}-${device.uuid ?? device.index}`} className="glow-hover min-w-0 rounded-panel border border-border bg-surface-raised p-3 transition-colors hover:border-accent">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-medium">{device.name}</p>
                    <p className="m-0 mt-0.5 text-xs text-text-muted">{device.vendor} · gpu {device.index}</p>
                  </div>
                  {device.fanPercent === 100 ? <Badge tone="danger">fan saturated</Badge> : null}
                </div>
                <dl className="m-0 mt-3 grid grid-cols-3 gap-2">
                  <div><dt className="flex items-center gap-1 text-xs text-text-muted"><GaugeIcon aria-hidden="true" className="size-3" />Load</dt><dd className="num m-0 mt-1 text-sm text-accent">{metric(device.utilizationPercent)}</dd></div>
                  <div><dt className="flex items-center gap-1 text-xs text-text-muted"><Fan aria-hidden="true" className="size-3" />Fan</dt><dd className={cn('num m-0 mt-1 text-sm', device.fanPercent === 100 ? 'glow-text-danger text-danger' : 'text-warning')}>{metric(device.fanPercent)}</dd></div>
                  <div><dt className="flex items-center gap-1 text-xs text-text-muted"><Thermometer aria-hidden="true" className="size-3" />Temp</dt><dd className="num m-0 mt-1 text-sm">{metric(device.temperatureCelsius, '°C')}</dd></div>
                </dl>
                <div className="mt-2 grid gap-1">
                  <FxMeter value={device.utilizationPercent} tone="accent" label={`${device.name} load`} />
                  <FxMeter value={device.fanPercent} thresholds={{ warn: 80, crit: 100 }} label={`${device.name} fan`} />
                </div>
              </div>
            ))}
          </div>
          <div className="panel-corners rounded-panel border border-border bg-surface-sunken p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-xs font-medium text-text-muted">Host maximum · last 24 hours</p>
              <div className="flex items-center gap-3 text-xs text-text-muted">
                <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-accent shadow-[0_0_4px_var(--accent)]" />load</span>
                <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-warning" />fan</span>
              </div>
            </div>
            <svg viewBox="0 0 600 112" preserveAspectRatio="none" className="h-28 w-full text-text-muted" role="img" aria-label="GPU load and fan percentage over the last 24 hours">
              <line x1="0" y1="16" x2="600" y2="16" stroke={TONE_COLOR.danger} strokeOpacity="0.45" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
              <line x1="0" y1="60" x2="600" y2="60" stroke="currentColor" strokeOpacity="0.2" vectorEffect="non-scaling-stroke" />
              <line x1="0" y1="104" x2="600" y2="104" stroke="currentColor" strokeOpacity="0.3" vectorEffect="non-scaling-stroke" />
              <defs>
                <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={TONE_COLOR.accent} stopOpacity="0.35" />
                  <stop offset="100%" stopColor={TONE_COLOR.accent} stopOpacity="0" />
                </linearGradient>
              </defs>
              {load ? <polygon points={`0,104 ${load} 600,104`} fill={`url(#${gradient})`} /> : null}
              {load ? <polyline points={load} fill="none" stroke={TONE_COLOR.accent} strokeWidth="2" vectorEffect="non-scaling-stroke" /> : null}
              {fan ? <polyline points={fan} fill="none" stroke={TONE_COLOR.warning} strokeWidth="2" vectorEffect="non-scaling-stroke" /> : null}
            </svg>
            <div className="num mt-1 flex justify-between text-xs text-text-muted"><span>24h ago</span><span>100% saturation line</span><span>now</span></div>
          </div>
        </div>
      )}
    </FxPanel>
  );
}
