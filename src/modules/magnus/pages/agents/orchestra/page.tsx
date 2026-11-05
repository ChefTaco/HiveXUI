import { Activity, Bot, Database, MonitorDot, Server, Users } from 'lucide-react';
import { EmptyState, PageHeader } from '@ui';
import { HERMES_POLL_MS } from '../../../api/rate-gate';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel, PageItem } from '../../../effects';
import Link from '../../../navigation';
import { useMagnusSession } from '../../../session';
import { LoadingRows, ResourceError } from '../../../ui/resource-state';
import { Fact, PostureHero, StatTile } from '../shared/fx';
import { groupProfiles, HermesStatus, installLabel, readInstallations, readProfiles, summarize, synced } from './shared';

function QuickAction({ label, detail, href, icon }: { label: string; detail: string; href: string; icon: React.ReactNode }) {
  return (
    <Link href={href} className="glow-hover group flex min-h-24 items-start gap-3 rounded-panel border border-border bg-surface px-4 py-3 text-text no-underline hover:border-accent">
      <span className="mt-0.5 text-accent">{icon}</span>
      <span>
        <span className="block text-base font-semibold group-hover:text-accent">{label}</span>
        <span className="mt-1 block text-sm text-text-muted">{detail}</span>
      </span>
    </Link>
  );
}

export default function HermesOverviewPage() {
  const { hermes } = useMagnusSession();
  const inventory = useMagnusResource(async (signal) => {
    const [installations, profiles] = await Promise.all([readInstallations(signal), readProfiles(signal)]);
    return { installations, profiles };
  }, [], { enabled: hermes, pollMs: HERMES_POLL_MS });
  const data = inventory.data;
  const known = data !== undefined;
  const { detected, healthy, dashboards, gateways } = summarize(data?.installations ?? [], data?.profiles ?? []);
  const byInstallation = groupProfiles(data?.profiles ?? []);
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader
          eyebrow="Agent runtime"
          title="Hermes agents"
          description={known ? `${detected.length} detected installation${detected.length === 1 ? '' : 's'} · latest sync ${synced(detected[0]?.lastSyncedAt)}` : 'Loading inventory…'}
          actions={<Link href="/orchestra/installations" className="btn btn--primary btn--sm no-underline"><Server className="size-4" />Installations</Link>}
        />
      </PageItem>
      <PageItem>
        <PostureHero label="Healthy installs" sublabel={known ? `${healthy} of ${detected.length} detected` : 'Reading inventory'} value={known ? healthy : null} max={detected.length}>
          <StatTile icon={<Server className="size-4" />} label="Installations" value={known ? detected.length : null} />
          <StatTile icon={<Activity className="size-4" />} label="Healthy installs" value={known ? healthy : null} tone="success" />
          <StatTile icon={<MonitorDot className="size-4" />} label="Dashboards running" value={known ? dashboards : null} tone="info" />
          <StatTile icon={<Bot className="size-4" />} label="Running gateways" value={known ? gateways : null} tone="success" />
        </PostureHero>
      </PageItem>
      <PageItem>
        <div className="grid gap-3 md:grid-cols-2">
          <QuickAction label="Installations" detail="Survey Hermes Agent runtime, home, version, and service posture." href="/orchestra/installations" icon={<Server className="size-4" />} />
          <QuickAction label="Profiles" detail="Review discovered profiles and their running configuration snapshots." href="/orchestra/profiles" icon={<Users className="size-4" />} />
        </div>
      </PageItem>
      <PageItem>
        <FxPanel title="Installation inventory" description="Runtime, dashboard, gateway, and profile posture" interactive={false}>
          {!known ? (
            inventory.loading ? <LoadingRows /> : <ResourceError error={inventory.error} title="Hermes Agent inventory could not be loaded" onRetry={() => void inventory.refresh()} />
          ) : detected.length === 0 ? (
            <EmptyState compact icon={<Bot className="size-5" />} title="No Hermes installations detected yet" message="Nodes report their Hermes Agent here once one is installed." />
          ) : (
            <div className="grid gap-3">
              {inventory.error ? <p role="alert" className="m-0 text-sm text-warning">Showing the last good inventory: {errorMessage(inventory.error)}</p> : null}
              {detected.map((installation) => {
                const linked = byInstallation.get(installation.id) ?? installation.profiles ?? [];
                return (
                  <article key={installation.id} className="glow-hover rounded-panel border border-border bg-surface-raised p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="m-0 text-base font-medium">{installLabel(installation)}</p>
                        <p className="m-0 mt-1 break-all font-mono text-xs text-text-muted">{installation.hostname} · {installation.hermesHome}</p>
                      </div>
                      <HermesStatus status={installation.status} />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Fact label="Version"><span className="font-mono">{installation.version ?? 'unknown'}</span></Fact>
                      <Fact label="Dashboard"><HermesStatus status={installation.dashboardStatus} /></Fact>
                      <Fact label="Gateway"><HermesStatus status={installation.gatewayStatus} /></Fact>
                      <Fact label="Profiles"><span className="num">{linked.length}</span></Fact>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                      <span className="inline-flex items-center gap-1 rounded-chip border border-border px-2 py-1 font-mono"><MonitorDot className="size-3" />127.0.0.1:{installation.dashboardPort} on {installation.hostname}</span>
                      <span className="inline-flex items-center gap-1 rounded-chip border border-border px-2 py-1"><Database className="size-3" />synced {synced(installation.lastSyncedAt)}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </FxPanel>
      </PageItem>
    </div>
  );
}
