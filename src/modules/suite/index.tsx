import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Activity, CheckCircle2, Clock, TriangleAlert } from 'lucide-react';
import { Panel, Button, Badge, StatCard, StatusDot, PageHeader, buttonClass, type Tone } from '../../components/ui';
import { Gauge } from '../../components/gauge';
import { Radar, radarRandom, type RadarBlip } from '../../components/radar';
import { Sparkline, TileTrend } from '../../components/sparkline';
import { latencyTone } from '../../components/tones';
import { series, useSessionSamples } from '../../lib/session-samples';
import { refreshRegistry, registryWarning, useRegistry } from '../../lib/registry';
import { readSuiteHealth } from '../../lib/suite-health';
import { browserIdentity } from '../../lib/runtime';
import { useStore } from '../../lib/store';
import { RegistryProducts } from '../../components/registry-products';
import { UpgradesPanel } from '../../components/upgrades';
import { LegacyDetails, legacyRows } from './legacy';

/** One product's answer, whichever way the installation reports it. */
export interface OverviewRow {
  key: string;
  name: string;
  state: 'ready' | 'degraded' | 'denied' | 'unavailable';
  message: string;
  latencyMs?: number | undefined;
  required?: boolean | undefined;
  /** A legacy installation's own console for the product. */
  href?: string | undefined;
}
const POLL_MS = 30_000;
const stateTone = (state: OverviewRow['state']): Tone => (state === 'ready' ? 'success' : state === 'denied' || state === 'degraded' ? 'warning' : 'danger');

/**
 * The installation overview. A suite installation probes each product's readiness and reads the
 * Registry; a legacy recovery installation reports the same through its native status API.
 */
export default function SuiteOverview() {
  return browserIdentity() ? <SuiteReadiness /> : <LegacyReadiness />;
}

function SuiteReadiness() {
  const [rows, setRows] = useState<OverviewRow[]>([]),
    [busy, setBusy] = useState(false),
    [checked, setChecked] = useState(false);
  const registry = useRegistry();
  const registryProblem = registryWarning(registry);
  const running = useRef(false);
  async function refresh() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const [health] = await Promise.all([readSuiteHealth(), refreshRegistry()]);
      setRows(health.map((row) => ({ key: row.product, name: row.name, state: row.state, message: row.message, latencyMs: row.latencyMs, required: row.required })));
      setChecked(true);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, []);
  return (
    <Overview
      rows={rows}
      checked={checked}
      busy={busy}
      onRefresh={() => void refresh()}
      description={
        <>
          Independent products connected through your Oathweave identity.
          {registry.status === 'ready' ? <> Installation <code className="font-mono text-text-strong">{registry.installationId}</code></> : null}
        </>
      }
      notice={registryProblem ? <p role="status" className="warning-banner">{registryProblem}</p> : null}
    >
      <RegistryProducts title="Installed products" />
      <UpgradesPanel canUpgrade={false} />
    </Overview>
  );
}

function LegacyReadiness() {
  const { data, refresh, refreshing } = useStore();
  const status = data.hiveStatus;
  const rows = useMemo(() => legacyRows(status), [status]);
  return (
    <Overview
      rows={rows}
      checked={status !== null}
      busy={refreshing}
      onRefresh={() => void refresh()}
      description="Products reported by this installation's native status API."
    >
      <LegacyDetails status={status} />
    </Overview>
  );
}

function Overview({ rows, checked, busy, onRefresh, description, notice, children }: {
  rows: readonly OverviewRow[];
  checked: boolean;
  busy: boolean;
  onRefresh: () => void;
  description: ReactNode;
  notice?: ReactNode;
  children?: ReactNode;
}) {
  const ready = rows.filter((row) => row.state === 'ready').length;
  const attention = rows.length - ready;
  const latencies = rows.flatMap((row) => (row.latencyMs !== undefined ? [row.latencyMs] : []));
  const average = latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null;
  const slowest = rows.reduce<OverviewRow | undefined>((worst, row) => ((row.latencyMs ?? -1) > (worst?.latencyMs ?? -1) ? row : worst), undefined);
  const samples = useSessionSamples('hive:readiness', checked ? { ready, attention, average, slowest: slowest?.latencyMs ?? null } : null, rows);
  const blips: RadarBlip[] = rows.map((row, index) => ({
    key: row.key,
    tone: row.state === 'ready' ? 'success' : row.state === 'unavailable' ? 'danger' : 'warning',
    distance: row.state === 'ready' ? 0.5 + radarRandom(index + 1) * 0.42 : 0.2 + radarRandom(index + 1) * 0.3,
    angle: (index * 360) / Math.max(1, rows.length) + radarRandom(index + 40) * 25,
  }));
  const posture = !checked ? { label: 'Checking', tone: 'neutral' as const } : rows.length === 0 ? { label: 'No products reported', tone: 'neutral' as const } : attention === 0 ? { label: 'All products ready', tone: 'success' as const } : { label: `${attention} need attention`, tone: 'warning' as const };
  return (
    <>
      <PageHeader
        eyebrow="Hive · installation"
        title="Installation overview"
        status={<Badge tone={posture.tone} dot>{posture.label}</Badge>}
        description={description}
        actions={
          <Button loading={busy} onClick={onRefresh}>
            Check readiness
          </Button>
        }
      />
      {notice}
      <Panel className="grid-bg" aria-label="Installation status">
        <div className="hero-row">
          <Radar blips={blips} value={rows.length} unit="products" label={`Product radar: ${ready} ready of ${rows.length}`} />
          <Gauge value={rows.length ? (ready / rows.length) * 100 : null} label="Products ready" display={rows.length ? `${ready}/${rows.length}` : undefined} tone={!rows.length ? 'neutral' : attention ? 'warning' : 'success'} size={150} />
          <Gauge value={average === null ? null : Math.min(100, average / 5)} label="Avg response" display={average === null ? undefined : `${average}ms`} tone={average === null ? 'neutral' : latencyTone(average)} size={150} />
          <div className="hero-trend">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="stat-label">Response time, this session</span>
              <span className="flex items-center gap-3 text-xs text-text-muted">
                <span className="flex items-center gap-1.5"><StatusDot status="ONLINE" pulse={false} />{ready} ready</span>
                <span className="flex items-center gap-1.5"><StatusDot status={attention ? 'DEGRADED' : 'UNKNOWN'} pulse={false} />{attention} attention</span>
              </span>
            </div>
            <Sparkline values={series(samples, 'average')} tone="accent" width={480} height={96} stretch label="Average product response time this session" emptyLabel="The trend appears after the next check." />
          </div>
        </div>
      </Panel>
      <div className="stats-grid">
        <StatCard label="Products ready" tone={attention ? 'warning' : 'success'} icon={<CheckCircle2 />} value={`${ready}/${rows.length}`} sub="answering their readiness check" footer={<TileTrend values={series(samples, 'ready')} tone={attention ? 'warning' : 'success'} />} />
        <StatCard label="Need attention" tone={attention ? 'danger' : 'neutral'} icon={<TriangleAlert />} value={attention} sub={attention ? 'denied or unavailable' : 'nothing is waiting on you'} footer={<TileTrend values={series(samples, 'attention')} tone={attention ? 'danger' : 'neutral'} />} />
        <StatCard label="Avg response" tone="accent" icon={<Activity />} value={average === null ? '—' : `${average} ms`} sub="across product readiness checks" footer={<Sparkline values={series(samples, 'average')} tone="accent" width={240} height={30} stretch live={false} emptyLabel="" />} />
        <StatCard label="Slowest" tone="signal" icon={<Clock />} value={slowest?.latencyMs !== undefined ? `${slowest.latencyMs} ms` : '—'} sub={slowest?.name ?? 'No answers yet'} footer={<Sparkline values={series(samples, 'slowest')} tone="signal" width={240} height={30} stretch live={false} emptyLabel="" />} />
      </div>
      <Panel title="Products" eyebrow="Readiness">
        <div className="product-grid">
          {rows.map((row) => {
            const tone = stateTone(row.state);
            return (
              <div className={`product-tile product-tile--${tone}`} key={row.key}>
                <div className="product-tile__row">
                  <span className="product-tile__name">{row.name}</span>
                  <Badge tone={tone} dot>{row.state}</Badge>
                </div>
                <span className="text-sm text-text-muted">{row.message}</span>
                <div className="product-tile__row">
                  {row.latencyMs !== undefined ? <span className="num data-figure text-xs text-text-muted">{row.latencyMs} ms</span> : <span />}
                  {row.required ? <Badge>Required</Badge> : null}
                  {row.href ? <a className={buttonClass({ variant: 'ghost', size: 'sm' })} href={row.href} target="_blank" rel="noreferrer">Open native<span className="sr-only"> for {row.name}</span></a> : null}
                </div>
              </div>
            );
          })}
        </div>
        <p>
          Readiness checks verify service availability. Migration and workflow
          acceptance are recorded separately by the Hive controller.
        </p>
      </Panel>
      {children}
    </>
  );
}
