import { useState, type ReactNode } from 'react';
import { z } from 'zod';
import { Activity, AlertCircle, AlertTriangle, Clock, FileText, Info, Pin, PinOff, RefreshCw, Server, Shield, Sparkles, Terminal } from 'lucide-react';
import {
  aiInsightsResponseSchema,
  pinInsightResponseSchema,
  pinnedInsightsResponseSchema,
  statsOverviewResponseSchema,
  tailscaleSummaryResponseSchema,
  unpinInsightResponseSchema,
} from '@contracts/magnus/browser';
import { Badge, Button, EmptyState, IconButton, PageHeader, StatusDot, statusTone, type Tone } from '@ui';
import { formatTime, relativeTime } from '@lib/format';
import { cn } from '@lib/cn';
import { useToast } from '../../../../../components/toast';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { AnimatedNumber, FleetRadar, FxMeter, FxPanel, Gauge, LazyAreaChart, PageItem, series, Sparkline, TONE_TEXT, useSessionSamples } from '../../../effects';
import { LiveEventList } from '../../../live/live-list';
import Link from '../../../navigation';
import { hasRoute } from '../../../routes';
import { useMagnusSession, WRITE_ROLES } from '../../../session';
import { LoadingRows, ResourceError } from '../../../ui/resource-state';
import { TailscaleExpiryAlert } from '../shared/tailscale-alert';

type Insight = z.output<typeof aiInsightsResponseSchema>['data']['insights'][number];
const POLL_MS = 15_000;
const INSIGHTS_POLL_MS = 5 * 60_000;

export default function FleetOverviewPage() {
  const stats = useMagnusResource((signal) => magnus.get('/stats/overview', statsOverviewResponseSchema, { signal }), [], { pollMs: POLL_MS });
  const tailscale = useMagnusResource((signal) => magnus.get('/nodes/tailscale/summary', tailscaleSummaryResponseSchema, { signal }));
  const data = stats.data?.data;
  const samples = useSessionSamples(
    'magnus:overview',
    data ? { online: data.nodes.online, active: data.commands.running + data.commands.pending, cron: data.cron.active, cpu: data.health.avgCpuPercent, mem: data.health.avgMemoryPercent } : null,
  );
  const previous = samples.at(-2);
  const cpu = data?.health.avgCpuPercent ?? null;
  const memory = data?.health.avgMemoryPercent ?? null;
  const posture: { label: string; tone: Tone } = !data
    ? { label: 'Acquiring', tone: 'neutral' }
    : data.nodes.offline > 0
      ? { label: 'Nodes offline', tone: 'danger' }
      : data.nodes.degraded > 0
        ? { label: 'Degraded', tone: 'warning' }
        : { label: 'All systems nominal', tone: 'success' };
  const panelTone = posture.tone === 'danger' ? 'danger' : posture.tone === 'warning' ? 'warning' : 'accent';
  const chart = samples.map((sample) => ({ t: sample.t, cpu: sample.cpu ?? null, mem: sample.mem ?? null }));
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader
          title="Fleet overview"
          eyebrow="Fleet · live"
          description="Real-time status of your Magnus fleet"
          status={<Badge tone={posture.tone} dot {...(posture.tone === 'success' ? {} : { className: 'fx-badge-pulse' })}>{posture.label}</Badge>}
          actions={<Button size="sm" icon={<RefreshCw className="size-4" />} loading={stats.refreshing} onClick={() => void stats.refresh()}>Refresh</Button>}
        />
      </PageItem>
      {tailscale.data ? <PageItem><TailscaleExpiryAlert summary={tailscale.data.data} /></PageItem> : null}
      <PageItem>
        <FxPanel hero fxTone={panelTone} aria-label="Fleet status">
          {!data && stats.loading ? (
            <LoadingRows rows={5} />
          ) : !data ? (
            <ResourceError error={stats.error} title="Fleet status unavailable" onRetry={() => void stats.refresh()} />
          ) : (
            <div className="grid gap-6 xl:grid-cols-[auto_minmax(0,1fr)]">
              <div className="flex flex-wrap items-center justify-center gap-6 sm:justify-start">
                <FleetRadar counts={data.nodes} />
                <div className="flex flex-wrap justify-center gap-4">
                  <Gauge value={data.nodes.total > 0 ? (data.nodes.online / data.nodes.total) * 100 : null} label="Nodes online" tone={data.nodes.total === 0 ? 'neutral' : data.nodes.offline > 0 ? 'danger' : data.nodes.online < data.nodes.total ? 'warning' : 'success'} display={`${data.nodes.online}/${data.nodes.total}`} size={150} />
                  <Gauge value={cpu} label="Avg CPU" size={150} sublabel={`${data.health.reportingNodes} reporting`} />
                  <Gauge value={memory} label="Avg memory" size={150} />
                </div>
              </div>
              <div className="flex min-w-0 flex-col">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3 text-xs text-text-muted">
                  <span className="font-medium">CPU and memory, this session</span>
                  <div className="flex flex-wrap items-center gap-3">
                    <Legend status="ONLINE" pulse={false} label={`${data.nodes.online} up`} />
                    <Legend status="DEGRADED" label={`${data.nodes.degraded} degraded`} />
                    <Legend status="OFFLINE" pulse={data.nodes.offline > 0} label={`${data.nodes.offline} down`} />
                    <Legend status="PROVISIONING" pulse={false} label={`${data.nodes.provisioning} provisioning`} />
                  </div>
                </div>
                {chart.length > 1 ? (
                  <LazyAreaChart data={chart} xKey="t" percent height={170} formatX={(value) => new Date(Number(value)).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit' })} series={[{ key: 'cpu', label: 'CPU', tone: 'accent' }, { key: 'mem', label: 'Memory', tone: 'info' }]} />
                ) : (
                  <div className="flex h-[170px] items-center justify-center rounded-panel border border-dashed border-border-strong text-sm text-text-muted">
                    <span className="fx-pulse mr-2 inline-block size-1.5 rounded-full bg-accent" />
                    Collecting samples. The trend appears after the next poll.
                  </div>
                )}
              </div>
            </div>
          )}
        </FxPanel>
      </PageItem>
      <PageItem>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total nodes" icon={<Server className="size-4" />} value={data ? <AnimatedNumber value={data.nodes.total} /> : '—'} sub={data ? `${data.nodes.online} online` : undefined} spark={series(samples, 'online')} delta={delta(previous?.online, data?.nodes.online)} deltaUnit=" up" />
          <Stat label="Active commands" tone="accent" icon={<Terminal className="size-4" />} value={data ? <AnimatedNumber value={data.commands.running + data.commands.pending} /> : '—'} sub={data ? `${data.commands.total} total` : undefined} spark={series(samples, 'active')} />
          <Stat label="Cron jobs" icon={<Clock className="size-4" />} value={data ? <AnimatedNumber value={data.cron.total} /> : '—'} sub={data ? `${data.cron.active} active` : undefined} spark={series(samples, 'cron')} />
          <Stat label="System health" tone={cpu !== null && cpu >= 90 ? 'danger' : cpu !== null && cpu >= 70 ? 'warning' : 'accent'} icon={<Activity className="size-4" />} value={cpu === null ? '—' : <AnimatedNumber value={cpu} decimals={Number.isInteger(cpu) ? 0 : 1} suffix="% CPU" />} sub={data ? (data.health.reportingNodes > 0 ? `${data.health.reportingNodes} node${data.health.reportingNodes === 1 ? '' : 's'} reporting` : 'No health data') : undefined}>
            {cpu !== null ? <FxMeter value={cpu} label="Average CPU" valueLabel="" /> : null}
          </Stat>
        </div>
      </PageItem>
      <PageItem>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <FxPanel title="Recent commands" actions={<Terminal className="size-4 text-accent" />}>
            {!data ? (
              stats.loading ? <LoadingRows /> : <ResourceError error={stats.error} title="Commands unavailable" />
            ) : data.recentCommands.length === 0 ? (
              <EmptyState compact icon={<Terminal className="size-4" />} title="No commands dispatched yet" action={hasRoute('/commands') ? <Link href="/commands">Run a command</Link> : undefined} />
            ) : (
              <ul className="m-0 grid list-none grid-cols-1 gap-1.5 p-0">
                {data.recentCommands.map((command) => (
                  <li key={`${command.id}-${command.status}`} className="scan-sweep flex items-center justify-between gap-2 rounded-chip border border-border bg-surface-raised px-3 py-2 text-sm">
                    <div className="flex min-w-0 items-center gap-2">
                      <StatusDot status={command.status} />
                      <code className="min-w-0 truncate text-accent">{command.command}</code>
                      <span className="shrink-0 text-text-muted">on {command.node.name}</span>
                    </div>
                    <div className="ml-2 flex shrink-0 items-center gap-2">
                      <Badge tone={statusTone(command.status)}>{command.status}</Badge>
                      <span className="num hidden text-xs text-text-muted sm:inline" title={formatTime(command.createdAt)}>{relativeTime(command.createdAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </FxPanel>
          <FxPanel title="Recent activity" actions={<Shield className="size-4 text-accent" />}>
            {!data ? (
              stats.loading ? <LoadingRows /> : <ResourceError error={stats.error} title="Audit feed unavailable" />
            ) : data.recentAudit.length === 0 ? (
              <EmptyState compact icon={<Shield className="size-4" />} title="No audit events yet" />
            ) : (
              <ol className="relative m-0 grid list-none grid-cols-1 gap-1.5 border-l border-border-strong p-0 pl-3">
                {data.recentAudit.map((event) => (
                  <li key={event.id} className="relative flex items-center justify-between gap-2 rounded-chip px-2 py-1.5 text-sm hover:bg-surface-hover">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{event.action}</span>
                      {event.targetType ? <span className="truncate text-text-muted">{event.targetType}{event.targetId ? ` ${event.targetId.slice(0, 8)}…` : ''}</span> : null}
                    </div>
                    <span className="num shrink-0 text-xs text-text-muted" title={formatTime(event.timestamp)}>{relativeTime(event.timestamp)}</span>
                  </li>
                ))}
              </ol>
            )}
          </FxPanel>
          <FxPanel title="Live event stream" fxTone="success">
            <LiveEventList limit={7} />
          </FxPanel>
        </div>
      </PageItem>
      <QuickActions />
      <Insights />
    </div>
  );
}

function delta(before: number | null | undefined, now: number | null | undefined) {
  return typeof before === 'number' && typeof now === 'number' ? Math.round((now - before) * 10) / 10 : undefined;
}

function Legend({ status, label, pulse }: { status: string; label: string; pulse?: boolean }) {
  return <span className="flex items-center gap-1.5"><StatusDot status={status} {...(pulse !== undefined ? { pulse } : {})} />{label}</span>;
}

function Stat({ label, value, sub, icon, tone = 'neutral', spark, delta: change, deltaUnit = '', children }: { label: string; value: ReactNode; sub?: string | undefined; icon: ReactNode; tone?: Tone; spark?: readonly number[]; delta?: number | undefined; deltaUnit?: string; children?: ReactNode }) {
  return (
    <FxPanel padding="sm" {...(tone === 'danger' || tone === 'warning' ? { fxTone: tone } : {})} className="grid gap-1">
      <div className="flex items-center justify-between text-sm text-text-muted"><span>{label}</span><span className={TONE_TEXT[tone === 'neutral' ? 'accent' : tone]}>{icon}</span></div>
      <div className="flex items-baseline gap-2">
        <span className={cn('text-2xl font-bold', TONE_TEXT[tone === 'neutral' ? 'accent' : tone])}>{value}</span>
        {change ? <span className={cn('num text-xs', change > 0 ? 'text-success' : 'text-warning')}>{change > 0 ? '+' : ''}{change}{deltaUnit}</span> : null}
      </div>
      {sub ? <span className="text-xs text-text-muted">{sub}</span> : null}
      {spark ? <Sparkline values={spark} width={200} height={28} stretch tone={tone === 'neutral' ? 'accent' : tone} emptyLabel="" /> : null}
      {children}
    </FxPanel>
  );
}

function QuickActions() {
  const actions: ReadonlyArray<{ href: string; label: string; icon: ReactNode }> = [
    { href: '/nodes', label: 'Manage nodes', icon: <Server className="size-5" /> },
    { href: '/mission-control', label: 'Mission Control', icon: <Sparkles className="size-5" /> },
    { href: '/commands', label: 'Run command', icon: <Terminal className="size-5" /> },
    { href: '/cron', label: 'Cron jobs', icon: <Clock className="size-5" /> },
    { href: '/files', label: 'Edit files', icon: <FileText className="size-5" /> },
  ].filter((action) => hasRoute(action.href));
  return (
    <PageItem>
      <FxPanel title="Quick actions" interactive={false}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {actions.map((action) => (
            <Link key={action.href} href={action.href} className="glow-hover group flex flex-col items-center gap-2 rounded-panel border border-border bg-surface-raised p-4 text-center no-underline hover:border-accent">
                            <span className="text-accent">{action.icon}</span>
              <span className="text-sm text-text-muted group-hover:text-accent">{action.label}</span>
            </Link>
          ))}
        </div>
      </FxPanel>
    </PageItem>
  );
}

const INSIGHT_LOOK: Record<Insight['severity'], { Icon: typeof Info; text: string; panel: string }> = {
  critical: { Icon: AlertCircle, text: 'text-danger', panel: 'border-danger bg-danger-soft' },
  warning: { Icon: AlertTriangle, text: 'text-warning', panel: 'border-warning bg-warning-soft' },
  info: { Icon: Info, text: 'text-info', panel: 'border-info bg-info-soft' },
  success: { Icon: Info, text: 'text-success', panel: 'border-success bg-success-soft' },
};

function Insights() {
  const toast = useToast();
  const { can } = useMagnusSession();
  const canPin = can(WRITE_ROLES);
  // A cache miss can run an AI generation, so this waits for its own answer behind the stats.
  const insights = useMagnusResource((signal) => magnus.get('/assistant/insights', aiInsightsResponseSchema, { signal, timeoutMs: 60_000 }), [], { pollMs: INSIGHTS_POLL_MS });
  const pins = useMagnusResource((signal) => magnus.get('/assistant/insights/pins', pinnedInsightsResponseSchema, { signal }));
  const [busy, setBusy] = useState(false);
  const list = insights.data?.data.insights ?? [];
  const pinned = pins.data?.data.pins ?? [];
  if (list.length === 0 && pinned.length === 0) return null;
  async function toggle(insight: Insight) {
    const existing = pinned.find((item) => item.title === insight.title && item.body === insight.body);
    setBusy(true);
    try {
      if (existing) await magnus.delete(`/assistant/insights/pins/${segment(existing.id)}`, unpinInsightResponseSchema);
      else await magnus.post('/assistant/insights/pins', pinInsightResponseSchema, { body: { ...insight, ...(insights.data ? { generatedAt: insights.data.data.generatedAt } : {}) } });
      await pins.refresh();
    } catch (error) {
      toast.error('The pin could not be changed', errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function unpin(id: string) {
    setBusy(true);
    try {
      await magnus.delete(`/assistant/insights/pins/${segment(id)}`, unpinInsightResponseSchema);
      await pins.refresh();
    } catch (error) {
      toast.error('The pin could not be changed', errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <PageItem>
      <FxPanel title={<span className="flex items-center gap-2"><Sparkles className="size-4 text-accent" />AI insights</span>} actions={insights.data ? <span className="num text-xs text-text-muted">Updated {formatTime(insights.data.data.generatedAt)}</span> : undefined}>
        {pinned.length > 0 ? (
          <div className="mb-4">
            <p className="mb-2 text-sm font-medium text-text-muted">Pinned</p>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {pinned.map((insight) => (
                <div key={insight.id} className="rounded-chip border border-accent bg-accent-soft px-3 py-2">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <div>
                      <p className="m-0 text-sm font-bold">{insight.title}</p>
                      <p className="m-0 text-xs text-text-muted">Pinned {formatTime(insight.pinnedAt)}</p>
                    </div>
                    {canPin ? <IconButton label="Unpin insight" icon={<PinOff className="size-4" />} disabled={busy} onClick={() => void unpin(insight.id)} /> : null}
                  </div>
                  <p className="m-0 text-sm text-text-muted">{insight.body}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {list.slice(0, 6).map((insight) => {
            const look = INSIGHT_LOOK[insight.severity];
            const isPinned = pinned.some((item) => item.title === insight.title && item.body === insight.body);
            return (
              <div key={`${insight.title}-${insight.body}`} className={cn('rounded-chip border px-3 py-2', look.panel)}>
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div className={cn('flex min-w-0 items-center gap-1.5', look.text)}>
                    <look.Icon className="size-4 shrink-0" />
                    <span className="truncate text-sm font-bold">{insight.title}</span>
                  </div>
                  {canPin ? <IconButton label={isPinned ? 'Unpin insight' : 'Pin insight'} icon={isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />} disabled={busy} onClick={() => void toggle(insight)} /> : null}
                </div>
                <p className="m-0 line-clamp-2 text-sm text-text-muted">{insight.body}</p>
              </div>
            );
          })}
        </div>
      </FxPanel>
    </PageItem>
  );
}
