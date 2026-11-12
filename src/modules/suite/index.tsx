import { useEffect, useRef, useState } from 'react';
import { Activity, CheckCircle2, Clock, TriangleAlert } from 'lucide-react';
import { Panel, Button, Badge, StatCard, StatusDot, PageHeader, type Tone } from '../../components/ui';
import { Gauge } from '../../components/gauge';
import { Radar, radarRandom, type RadarBlip } from '../../components/radar';
import { Sparkline, TileTrend } from '../../components/sparkline';
import { latencyTone } from '../../components/tones';
import { series, useSessionSamples } from '../../lib/session-samples';
import { refreshRegistry, registryWarning, useRegistry } from '../../lib/registry';
import { readSuiteHealth } from '../../lib/suite-health';
import { RegistryProducts } from '../../components/registry-products';
import { UpgradesPanel } from '../../components/upgrades';
type Status = Awaited<ReturnType<typeof readSuiteHealth>>;
const POLL_MS = 30_000;
const stateTone = (state: Status[number]['state']): Tone => (state === 'ready' ? 'success' : state === 'denied' ? 'warning' : 'danger');

export default function SuiteOverview() {
  const [rows, setRows] = useState<Status>([]),
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
      setRows(health);
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
  const ready = rows.filter((row) => row.state === 'ready').length;
  const attention = rows.length - ready;
  const latencies = rows.flatMap((row) => (row.latencyMs !== undefined ? [row.latencyMs] : []));
  const average = latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null;
  const slowest = rows.reduce<Status[number] | undefined>((worst, row) => ((row.latencyMs ?? -1) > (worst?.latencyMs ?? -1) ? row : worst), undefined);
  const samples = useSessionSamples('hive:readiness', checked ? { ready, attention, average, slowest: slowest?.latencyMs ?? null } : null, rows);
  const blips: RadarBlip[] = rows.map((row, index) => ({
    key: row.product,
    tone: row.state === 'ready' ? 'success' : row.state === 'denied' ? 'warning' : 'danger',
    distance: row.state === 'ready' ? 0.5 + radarRandom(index + 1) * 0.42 : 0.2 + radarRandom(index + 1) * 0.3,
    angle: (index * 360) / Math.max(1, rows.length) + radarRandom(index + 40) * 25,
  }));
  const posture = !checked ? { label: 'Checking', tone: 'neutral' as const } : attention === 0 ? { label: 'All products ready', tone: 'success' as const } : { label: `${attention} need attention`, tone: 'warning' as const };
  return (
    <>
      <PageHeader
        eyebrow="Hive · installation"
        title="Installation overview"
        status={<Badge tone={posture.tone} dot>{posture.label}</Badge>}
        description={
          <>
            Independent products connected through your Oathweave identity.
            {registry.status === 'ready' ? <> Installation <code className="font-mono text-text-strong">{registry.installationId}</code></> : null}
          </>
        }
        actions={
          <Button loading={busy} onClick={() => void refresh()}>
            Check readiness
          </Button>
        }
      />
      {registryProblem ? <p role="status" className="warning-banner">{registryProblem}</p> : null}
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
              <div className={`product-tile product-tile--${tone}`} key={row.product}>
                <div className="product-tile__row">
                  <span className="product-tile__name">{row.name}</span>
                  <Badge tone={tone} dot>{row.state}</Badge>
                </div>
                <span className="text-sm text-text-muted">{row.message}</span>
                <div className="product-tile__row">
                  {row.latencyMs !== undefined ? <span className="num data-figure text-xs text-text-muted">{row.latencyMs} ms</span> : <span />}
                  {row.required ? <Badge>Required</Badge> : null}
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
      <RegistryProducts title="Installed products" />
      <UpgradesPanel canUpgrade={false} />
    </>
  );
}
