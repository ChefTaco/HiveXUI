import type { ElementType, ReactNode } from 'react';
import { Activity, AlertTriangle, Bot, Brain, CheckCircle2, Compass, Router, Server, Shield, Siren } from 'lucide-react';
import { dependencyHealthResponseSchema, hermesInstallationsResponseSchema, hermesProfilesResponseSchema, statsOverviewResponseSchema } from '@contracts/magnus/browser';
import { Badge, EmptyState, PageHeader, StatusDot, type Tone } from '@ui';
import { cn } from '@lib/cn';
import { magnus } from '../../../api/client';
import { HERMES_POLL_MS } from '../../../api/rate-gate';
import { useMagnusResource } from '../../../api/use-resource';
import { FxMeter, FxPanel, Gauge, latencyTone, PageItem, TONE_TEXT, type Thresholds } from '../../../effects';
import Link from '../../../navigation';
import { hasRoute } from '../../../routes';
import { useMagnusSession } from '../../../session';
import { LoadingRows } from '../../../ui/resource-state';
import { summarizeHermesInventory } from './hermes-inventory';

const POLL_MS = 15_000;

export default function MissionControlPage() {
  const { hermes } = useMagnusSession();
  const stats = useMagnusResource((signal) => magnus.get('/stats/overview', statsOverviewResponseSchema, { signal }), [], { pollMs: POLL_MS });
  const dependencies = useMagnusResource((signal) => magnus.get('/ops/dependency-health', dependencyHealthResponseSchema, { signal }), [], { pollMs: POLL_MS });
  const orchestra = useMagnusResource(
    async (signal) => {
      const [installations, profiles] = await Promise.all([
        magnus.get('/orchestra/installations', hermesInstallationsResponseSchema, { signal }),
        magnus.get('/orchestra/profiles', hermesProfilesResponseSchema, { signal }),
      ]);
      return summarizeHermesInventory(installations.data, profiles.data);
    },
    [],
    { enabled: hermes, pollMs: HERMES_POLL_MS },
  );
  const fleet = stats.data?.data;
  const online = fleet?.nodes.online ?? 0;
  const troubled = (fleet?.nodes.offline ?? 0) + (fleet?.nodes.degraded ?? 0);
  const posture = !fleet ? 'unknown' : troubled === 0 ? 'green' : 'amber';
  const postureLabel = posture === 'green' ? 'All systems nominal' : posture === 'amber' ? 'Attention required' : 'Status unknown';
  const PostureIcon = posture === 'green' ? CheckCircle2 : posture === 'amber' ? Siren : Activity;
  const postureTone: Tone = posture === 'green' ? 'success' : posture === 'amber' ? 'warning' : 'neutral';
  const cpu = fleet?.health.avgCpuPercent ?? null;
  const health = dependencies.data?.data;
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader title="Mission Control" eyebrow="Command deck" icon={<Compass className="size-5" />} description={hermes ? 'One posture across fleet operations and Hermes Agent inventory.' : 'One posture across fleet operations and platform dependencies.'} />
      </PageItem>
      <PageItem>
        <FxPanel hero interactive={false} {...(posture === 'amber' ? { fxTone: 'warning' as const } : posture === 'green' ? { fxTone: 'success' as const } : {})} padding="sm" aria-label="Fleet posture">
          <div className="flex flex-wrap items-center gap-4 px-2 py-1">
            <span className={cn('relative flex size-11 items-center justify-center rounded-full border border-current bg-surface', TONE_TEXT[postureTone])}>
              {posture === 'amber' ? <span className="fx-halo opacity-30" aria-hidden="true" /> : null}
              <PostureIcon className="relative size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-text-muted">Fleet posture</div>
              <div className={cn('fx-text-glow text-lg font-bold', TONE_TEXT[postureTone])}>{stats.loading && !fleet ? 'Checking fleet posture' : postureLabel}</div>
            </div>
            {fleet ? (
              <div className="flex flex-wrap gap-4 text-xs text-text-muted">
                <span className="flex items-center gap-1.5"><StatusDot status="ONLINE" />{fleet.nodes.online} up</span>
                <span className="flex items-center gap-1.5"><StatusDot status="DEGRADED" />{fleet.nodes.degraded} degraded</span>
                <span className="flex items-center gap-1.5"><StatusDot status="OFFLINE" pulse={fleet.nodes.offline > 0} />{fleet.nodes.offline} down</span>
              </div>
            ) : null}
          </div>
        </FxPanel>
      </PageItem>
      <PageItem>
        <FxPanel
          title={<span className="flex items-center gap-2"><Router className="size-4 text-accent" />Dependency health{health ? <Badge tone={health.status === 'healthy' ? 'success' : health.status === 'degraded' ? 'warning' : 'danger'} dot>{health.status}</Badge> : null}</span>}
          actions={hasRoute('/fleet-readiness') ? <Link href="/fleet-readiness" className="text-sm">Readiness</Link> : undefined}
        >
          {health ? <SystemBus checks={health.checks} /> : dependencies.loading ? <LoadingRows rows={2} /> : <EmptyState compact icon={<Router className="size-4" />} title="Dependency health unavailable" />}
        </FxPanel>
      </PageItem>
      <PageItem>
        <Tier title="Fleet" description="Nodes, commands and reporting health" icon={Server}>
          {!fleet ? (
            stats.loading ? <div className="col-span-full"><LoadingRows rows={2} /></div> : <Offline pillar="Fleet" />
          ) : (
            <>
              <Stat label="Nodes online" value={online} sublabel={`${fleet.nodes.total} total`} tone={fleet.nodes.total > 0 && troubled === 0 ? 'success' : 'accent'} gauge={{ value: online, max: fleet.nodes.total || 1, higherIsBetter: true }} />
              <Stat label="Offline or degraded" value={troubled} tone={troubled > 0 ? 'warning' : 'neutral'} meter={{ value: troubled, max: fleet.nodes.total || 1, thresholds: { warn: 1, crit: 34 } }} />
              <Stat label="Avg CPU" value={cpu === null ? '—' : `${Math.round(cpu)}%`} sublabel={`${fleet.health.reportingNodes} reporting`} meter={{ value: cpu }} />
              <Stat label="Commands" value={fleet.commands.running + fleet.commands.pending} sublabel={`${fleet.commands.running} running · ${fleet.commands.pending} pending`} />
            </>
          )}
        </Tier>
      </PageItem>
      {hermes ? (
        <PageItem>
          <Tier title="Hermes Agent" description="Hermes Agent installations and profiles" icon={Bot}>
            {!orchestra.data ? (
              orchestra.loading ? <div className="col-span-full"><LoadingRows rows={2} /></div> : <Offline pillar="Hermes Agent" />
            ) : (
              <>
                <Stat label="Installations" value={orchestra.data.installations} />
                <Stat label="Healthy" value={orchestra.data.healthyInstallations} sublabel={`${orchestra.data.installations} total`} tone={orchestra.data.installations > 0 && orchestra.data.healthyInstallations === orchestra.data.installations ? 'success' : 'accent'} meter={{ value: orchestra.data.healthyInstallations, max: orchestra.data.installations || 1, tone: orchestra.data.healthyInstallations === orchestra.data.installations ? 'success' : 'warning' }} />
                <Stat label="Profiles" value={orchestra.data.profiles} />
                <Stat label="Gateways" value={orchestra.data.runningGateways} sublabel="running" {...(orchestra.data.profiles > 0 ? { meter: { value: orchestra.data.runningGateways, max: orchestra.data.profiles, tone: 'accent' as const } } : {})} />
              </>
            )}
          </Tier>
        </PageItem>
      ) : null}
      <QuickLinks hermes={hermes} />
    </div>
  );
}

function Tier({ title, description, icon: Icon, children }: { title: string; description: string; icon: ElementType; children: ReactNode }) {
  return (
    <FxPanel as="section" title={<span className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-panel border border-accent bg-surface text-accent"><Icon className="size-4" /></span>{title}</span>} description={description}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>
    </FxPanel>
  );
}

function Stat({ label, value, sublabel, tone = 'accent', meter, gauge }: { label: string; value: string | number; sublabel?: string; tone?: Tone; meter?: { value: number | null; max?: number; thresholds?: Thresholds; tone?: Tone }; gauge?: { value: number; max: number; higherIsBetter: boolean } }) {
  return (
    <div className="fx-hover relative rounded-panel border border-border bg-surface-raised p-3 hover:border-accent">
      <span className="fx-hover__glow" aria-hidden="true" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-text-muted">{label}</div>
          <div className={cn('num mt-1 truncate text-xl font-bold', TONE_TEXT[tone])}>{value}</div>
          {sublabel ? <div className="mt-0.5 truncate text-xs text-text-muted">{sublabel}</div> : null}
        </div>
        {gauge ? <Gauge value={gauge.value} max={gauge.max} label={label} higherIsBetter={gauge.higherIsBetter} thresholds={{ warn: 10, crit: 34 }} size={56} ticks={false} display="" hideLabel className="-my-1 shrink-0" /> : null}
      </div>
      {meter ? <FxMeter value={meter.value} {...(meter.max !== undefined ? { max: meter.max } : {})} {...(meter.thresholds ? { thresholds: meter.thresholds } : {})} {...(meter.tone ? { tone: meter.tone } : {})} label={label} className="mt-2" /> : null}
    </div>
  );
}

function Offline({ pillar }: { pillar: string }) {
  return <div className="col-span-full"><EmptyState compact tone="warning" icon={<AlertTriangle className="size-4" />} title={`${pillar} data unavailable`} message="The service may be unreachable or not configured." /></div>;
}

const CHECK_TEXT = { pass: 'text-success', warn: 'text-warning', fail: 'text-danger', skip: 'text-text-muted' } as const;

/** Dependency checks drawn as stations on a glowing bus line. */
function SystemBus({ checks }: { checks: ReadonlyArray<{ name: string; status: keyof typeof CHECK_TEXT; message: string; latencyMs?: number | undefined }> }) {
  return (
    <div className="relative">
      <div aria-hidden="true" className="fx-bus hidden lg:block" />
      <ol className="relative m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-4 lg:grid-cols-7">
        {checks.slice(0, 7).map((check) => (
          <li key={check.name} className="flex min-w-0 flex-col items-start gap-2 lg:items-center" title={check.message}>
            <span className={cn('relative inline-flex size-3.5 items-center justify-center rounded-full border border-border bg-surface', CHECK_TEXT[check.status])}>
              {check.status === 'fail' ? <span className="fx-halo" /> : null}
              <span className="relative size-2 rounded-full bg-current" />
            </span>
            <div className="w-full rounded-chip border border-border bg-surface-raised p-2 lg:text-center">
              <div className="truncate text-xs text-text-muted">{check.name}</div>
              <div className="mt-1 flex items-baseline gap-2 lg:justify-center">
                <span className={cn('text-sm font-semibold', CHECK_TEXT[check.status])}>{check.status}</span>
                {typeof check.latencyMs === 'number' ? <span className={cn('num text-xs', TONE_TEXT[latencyTone(check.latencyMs)])}>{Math.round(check.latencyMs)}ms</span> : null}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function QuickLinks({ hermes }: { hermes: boolean }) {
  const links: ReadonlyArray<{ href: string; label: string; icon: ElementType; hermes?: boolean }> = [
    { href: '/', label: 'Fleet overview', icon: Server },
    { href: '/nodes', label: 'Nodes', icon: Server },
    { href: '/orchestra/installations', label: 'Hermes installations', icon: Bot, hermes: true },
    { href: '/orchestra/profiles', label: 'Hermes profiles', icon: Brain, hermes: true },
    { href: '/governor/operations', label: 'Operations', icon: Activity },
    { href: '/audit', label: 'Audit trail', icon: Shield },
  ];
  // A link appears as soon as its page is ported.
  const shown = links.filter((link) => hasRoute(link.href) && (hermes || !link.hermes));
  return (
    <PageItem>
      <FxPanel title={<span className="flex items-center gap-2"><Activity className="size-4 text-accent" />Quick actions</span>} interactive={false}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {shown.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="fx-hover group flex flex-col items-center gap-2 rounded-panel border border-border bg-surface-raised px-3 py-4 text-center no-underline hover:border-accent">
              <span className="fx-hover__glow" aria-hidden="true" />
              <span className="flex size-9 items-center justify-center rounded-full border border-accent bg-surface"><Icon className="size-4 text-accent" /></span>
              <span className="text-sm text-text-muted group-hover:text-text">{label}</span>
            </Link>
          ))}
        </div>
      </FxPanel>
    </PageItem>
  );
}
