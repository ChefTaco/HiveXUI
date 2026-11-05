import type { ReactNode } from 'react';
import { z } from 'zod';
import { Power, RefreshCcwDot } from 'lucide-react';
import { diskForecastSchema } from '@contracts/magnus/browser';
import { Badge, Button, statusTone, type Tone } from '@ui';
import { FxMeter, FxPanel } from '../../../effects';
import { parseDisks } from '../nodes/nodes-api';
import { formatBytes, type ServiceInfo, type SystemUpdates, type WazuhAgent } from './node-data';

export function Row({ label, children, mono }: { label: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className={mono ? 'font-mono text-xs text-text-muted' : 'text-text-muted'}>{label}</dt>
      <dd className={mono ? 'm-0 min-w-0 text-right font-mono text-xs break-all' : 'm-0 min-w-0 text-right font-medium break-words'}>{children}</dd>
    </div>
  );
}

export function SystemUpdatesCard({ updates, canEnable, online, enabling, error, onEnable }: { updates: SystemUpdates | null; canEnable: boolean; online: boolean; enabling: boolean; error: string | null; onEnable: () => void }) {
  return (
    <FxPanel
      fxTone={updates?.rebootRequired ? 'danger' : 'accent'}
      title="System update readiness"
      description="Automatic apt policy and reboot state from the latest heartbeat"
      actions={updates ? <Badge tone={updates.rebootRequired ? 'danger' : updates.automaticUpdates === 'enabled' ? 'success' : 'warning'}>{updates.rebootRequired ? 'reboot required' : updates.automaticUpdates}</Badge> : undefined}
    >
      {updates ? (
        <div className="grid gap-4">
          {updates.rebootRequired ? (
            <div className="flex gap-3 rounded-control border border-danger bg-danger-soft p-3">
              <Power aria-hidden="true" className="fx-pulse mt-0.5 size-4 shrink-0 text-danger" />
              <div className="min-w-0">
                <p className="m-0 text-sm font-medium text-danger">Restart needed to finish installed updates</p>
                <p className="m-0 mt-1 text-xs break-words text-text-muted">{updates.rebootRequiredPackages.length ? updates.rebootRequiredPackages.slice(0, 5).join(', ') : 'The operating system has set the reboot-required marker.'}</p>
              </div>
            </div>
          ) : null}
          <dl className="m-0 grid gap-2 text-sm">
            <Row label="Platform"><span className="font-mono text-xs">{updates.platform}</span></Row>
            <Row label="Automatic updates"><Badge tone={updates.automaticUpdates === 'enabled' ? 'success' : 'warning'}>{updates.automaticUpdates}</Badge></Row>
            <Row label="unattended-upgrades">{updates.unattendedUpgradesInstalled ? 'installed' : 'not installed'}</Row>
            <Row label="Full apt upgrade policy">{updates.fullUpgradePolicyEnabled ? 'enabled' : 'not enabled'}</Row>
            {updates.timers.map((timer) => <Row key={timer.name} label={timer.name} mono>{timer.state}</Row>)}
          </dl>
          {updates.supported && updates.automaticUpdates !== 'enabled' && canEnable ? (
            <Button size="sm" variant="primary" className="justify-self-start" disabled={!online} loading={enabling} icon={<RefreshCcwDot className="size-4" />} onClick={onEnable}>
              {enabling ? 'Enabling…' : 'Enable automatic updates'}
            </Button>
          ) : null}
          {error ? <p role="alert" className="m-0 text-sm text-danger">{error}</p> : null}
        </div>
      ) : (
        <p className="m-0 text-sm text-text-muted">Update posture will appear after agent v1.6.0 reports its first heartbeat.</p>
      )}
    </FxPanel>
  );
}

const WAZUH_TONE: Record<WazuhAgent['serviceStatus'], Tone> = { active: 'success', failed: 'danger', inactive: 'warning', not_installed: 'neutral', unknown: 'neutral' };

export function WazuhCard({ wazuh }: { wazuh: WazuhAgent | null }) {
  return (
    <FxPanel title="Wazuh agent" description="Endpoint-security posture from the latest node heartbeat" actions={wazuh ? <Badge tone={WAZUH_TONE[wazuh.serviceStatus]}>{wazuh.serviceStatus.replace('_', ' ')}</Badge> : undefined}>
      {wazuh ? (
        <dl className="m-0 grid gap-2 text-sm">
          <Row label="Installation"><Badge tone={wazuh.installed ? 'success' : 'neutral'}>{wazuh.installed ? 'installed' : 'not installed'}</Badge></Row>
          <Row label="Startup">{wazuh.enabled}</Row>
          <Row label="Version"><span className="font-mono text-xs">{wazuh.version ?? '—'}</span></Row>
          <Row label="Managers"><span className="font-mono text-xs break-all">{wazuh.managerAddresses.length ? wazuh.managerAddresses.join(', ') : '—'}</span></Row>
        </dl>
      ) : (
        <p className="m-0 text-sm text-text-muted">Wazuh posture will appear after this host reports a current Magnus agent heartbeat.</p>
      )}
    </FxPanel>
  );
}

export function DiskCard({ disks }: { disks: string | null | undefined }) {
  const parsed = parseDisks(disks);
  return (
    <FxPanel title="Disk usage">
      {parsed.length ? (
        <div className="grid gap-3">
          {parsed.map((disk) => (
            <div key={disk.mountPoint} className="min-w-0 text-sm">
              <div className="flex flex-wrap justify-between gap-x-2 text-xs">
                <span className="min-w-0 break-all text-text-muted">{disk.mountPoint}</span>
                <span className="num">{formatBytes(disk.usedBytes)} / {formatBytes(disk.totalBytes)}</span>
              </div>
              <FxMeter value={disk.usagePercent} thresholds={{ warn: 80, crit: 90 }} label={`${disk.mountPoint} disk usage`} className="mt-1" />
            </div>
          ))}
        </div>
      ) : (
        <p className="m-0 text-sm text-text-muted">No disk data available</p>
      )}
    </FxPanel>
  );
}

type DiskForecast = z.output<typeof diskForecastSchema>;
export const forecastTone = (days: number | null): Tone => (days !== null && days <= 14 ? 'danger' : days !== null && days <= 30 ? 'warning' : 'neutral');
export function forecastLabel(forecast: Pick<DiskForecast, 'daysUntilFull' | 'growthRatePerDay'>): string {
  if (forecast.daysUntilFull === null) return forecast.growthRatePerDay > 0 ? 'trend uncertain' : 'stable/shrinking';
  return `${forecast.daysUntilFull}d to full`;
}

export function ForecastCard({ forecasts }: { forecasts: readonly DiskForecast[] }) {
  return (
    <FxPanel title="Capacity forecast" description="Per-volume 30-day growth trend and estimated time to full">
      {forecasts.length ? (
        <div className="grid gap-3">
          {forecasts.map((forecast) => (
            <div key={forecast.mountPoint} className="min-w-0 rounded-control border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 font-mono text-xs break-all">{forecast.mountPoint}</span>
                <Badge tone={forecastTone(forecast.daysUntilFull)}>{forecastLabel(forecast)}</Badge>
              </div>
              <p className="num m-0 mt-2 text-xs text-text-muted">
                {forecast.currentUsagePercent.toFixed(1)}% used · {formatBytes(Math.abs(forecast.growthRatePerDay))}/day {forecast.growthRatePerDay >= 0 ? 'growth' : 'reclaimed'} · confidence {(forecast.confidence * 100).toFixed(0)}%
              </p>
              <p className="m-0 mt-2 text-xs text-text-muted">{forecast.recommendation}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="m-0 text-sm text-text-muted">At least three retained samples are needed for a capacity forecast.</p>
      )}
    </FxPanel>
  );
}

export function ServiceChecksCard({ services }: { services: readonly ServiceInfo[] }) {
  return (
    <FxPanel title="Service checks">
      {services.length ? (
        <div className="grid gap-2 text-sm">
          {services.slice(0, 8).map((service) => (
            <div key={service.name} className="fx-rail flex items-center justify-between gap-3 rounded-control border border-border px-2 py-1.5">
              <span className="min-w-0 font-medium break-all">{service.name}</span>
              <Badge tone={service.status === 'active' ? 'success' : service.status === 'failed' ? 'danger' : statusTone(service.status)}>{service.status}</Badge>
            </div>
          ))}
        </div>
      ) : (
        <p className="m-0 text-sm text-text-muted">No service checks available from this node yet.</p>
      )}
    </FxPanel>
  );
}
