import { useMemo } from 'react';
import { Badge, EmptyState, HealthBadge, JsonBlock, Panel, StatCard, StatusDot, Button } from '../components/ui';
import { Gauge } from '../components/gauge';
import { Icon } from '../components/icons';
import { Radar, radarRandom, type RadarBlip } from '../components/radar';
import { Sparkline } from '../components/sparkline';
import { compactNumber, relativeTime } from '../lib/format';
import { series, useSessionSamples } from '../lib/session-samples';
import { useStore } from '../lib/store';

export function RoutersPage({ onNavigate }: { onNavigate: (view: string) => void }) {
  const { data } = useStore();
  const app = data.hiveStatus?.apps.find((entry) => entry.key === 'router');
  const healthy = useMemo(
    () => data.providers.filter((provider) => (provider.lastHealthStatus ?? '').toLowerCase() === 'healthy').length,
    [data.providers],
  );
  const enabledProviders = data.providers.filter((provider) => provider.enabled).length;
  const totals = data.telemetry?.totals ?? { traces: 0, failures: 0, failovers: 0 };
  const successRate = totals.traces > 0 ? Math.round(((totals.traces - totals.failures) / totals.traces) * 100) : 100;
  const samples = useSessionSamples('emberpath:routers', { traces: totals.traces, failures: totals.failures, providers: data.providers.length, rules: data.routeRules.length, success: successRate }, data.telemetry);
  const unhealthy = data.providers.length - healthy;
  const blips: RadarBlip[] = data.providers.map((provider, index) => {
    const status = (provider.lastHealthStatus ?? 'unknown').toLowerCase();
    const known = status === 'healthy';
    return {
      key: provider.id,
      tone: !provider.enabled ? 'neutral' : known ? 'success' : status === 'unknown' ? 'info' : 'danger',
      distance: known ? 0.5 + radarRandom(index + 1) * 0.42 : 0.2 + radarRandom(index + 1) * 0.3,
      angle: radarRandom(index + 60) * 360,
    };
  });

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Emberpath · routing</p>
          <h2>Routers</h2>
          <p>Provider fleet, route policy, health, and trace evidence in one operations page.</p>
        </div>
        {app ? (
          <Badge tone={app.status === 'online' ? 'success' : app.status === 'degraded' ? 'warning' : 'danger'} dot>
            {app.status}
          </Badge>
        ) : null}
      </div>

      <Panel className="grid-bg" aria-label="Routing status">
        <div className="hero-row">
          <Radar blips={blips} value={data.providers.length} unit="providers" label={`Provider radar: ${healthy} healthy of ${data.providers.length}`} />
          <Gauge value={totals.traces > 0 ? successRate : null} label="Requests succeeded" higherIsBetter size={150} sublabel={`${compactNumber(totals.traces)} traces`} />
          <Gauge value={data.providers.length ? (healthy / data.providers.length) * 100 : null} label="Providers healthy" higherIsBetter display={data.providers.length ? `${healthy}/${data.providers.length}` : undefined} size={150} />
          <div className="hero-trend">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="stat-label">Traces, this session</span>
              <span className="flex items-center gap-3 text-xs text-text-muted">
                <span className="flex items-center gap-1.5"><StatusDot status="ONLINE" pulse={false} />{healthy} healthy</span>
                <span className="flex items-center gap-1.5"><StatusDot status={unhealthy ? 'FAILED' : 'UNKNOWN'} pulse={false} />{unhealthy} unhealthy</span>
              </span>
            </div>
            <Sparkline values={series(samples, 'traces')} tone="accent" width={480} height={96} stretch label="Traces recorded this session" emptyLabel="The trend appears after the next sync." />
          </div>
        </div>
      </Panel>

      <div className="stats-grid">
        <StatCard label="Providers" value={data.providers.length} sub={`${enabledProviders} enabled / ${healthy} healthy`} tone="accent" icon={<Icon.Server />} footer={<Sparkline values={series(samples, 'providers')} tone="accent" width={240} height={30} stretch live={false} emptyLabel="" />} />
        <StatCard label="Route Rules" value={data.routeRules.length} sub={`${data.heuristics.length} heuristics`} tone="signal" icon={<Icon.Workflow />} footer={<Sparkline values={series(samples, 'rules')} tone="signal" width={240} height={30} stretch live={false} emptyLabel="" />} />
        <StatCard label="Traces" value={compactNumber(totals.traces)} sub={`${successRate}% succeeded`} tone="accent" icon={<Icon.Activity />} footer={<Sparkline values={series(samples, 'traces')} tone="accent" width={240} height={30} stretch live={false} emptyLabel="" />} />
        <StatCard label="Failures" value={compactNumber(totals.failures)} sub={`${totals.failovers} failovers`} tone={totals.failures > 0 ? 'danger' : 'success'} icon={<Icon.Alert />} footer={<Sparkline values={series(samples, 'failures')} tone={totals.failures > 0 ? 'danger' : 'success'} width={240} height={30} stretch live={false} emptyLabel="" />} />
      </div>

      <div className="page-grid page-grid--2">
        <Panel title="Router Workbench" eyebrow="Controls">
          <div className="workbench-actions">
            <Button variant="ghost" onClick={() => onNavigate('providers')}>
              <Icon.Server className="btn-ico" />
              Providers
            </Button>
            <Button variant="ghost" onClick={() => onNavigate('routing')}>
              <Icon.Route className="btn-ico" />
              Routing
            </Button>
            <Button variant="ghost" onClick={() => onNavigate('testing')}>
              <Icon.Hexagon className="btn-ico" />
              Testing
            </Button>
            <Button variant="ghost" onClick={() => onNavigate('traces')}>
              <Icon.Activity className="btn-ico" />
              Traces
            </Button>
          </div>
        </Panel>

        <Panel title="Latest Trace" eyebrow="Evidence" actions={<Button variant="ghost" size="sm" onClick={() => onNavigate('traces')}>View all</Button>}>
          {data.telemetry?.latestTrace ? <JsonBlock value={data.telemetry.latestTrace} /> : <EmptyState icon={<Icon.Activity width={34} height={34} />} message="No traces recorded yet." />}
        </Panel>
      </div>

      <Panel title="Provider Pulse" eyebrow="Health" actions={<Button variant="ghost" size="sm" onClick={() => onNavigate('providers')}>Manage</Button>}>
        {data.providers.length === 0 ? (
          <EmptyState icon={<Icon.Server width={34} height={34} />} message="No providers registered yet." />
        ) : (
          <div className="pulse-grid">
            {data.providers.map((provider) => (
              <article className="pulse-card" key={provider.id}>
                <div className="pulse-top">
                  <span className="pulse-name">{provider.name}</span>
                  <HealthBadge status={provider.lastHealthStatus} />
                </div>
                <p className="pulse-meta"><Badge tone="neutral">{provider.kind}</Badge></p>
                <p className="pulse-meta mt-2">{provider.baseUrl}</p>
                {provider.lastHealthAt ? <p className="pulse-meta mt-1">checked {relativeTime(provider.lastHealthAt)}</p> : null}
              </article>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
