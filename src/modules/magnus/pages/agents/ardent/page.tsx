import { Activity, ArrowUpRight, Bot, Database, Radio, Server } from 'lucide-react';
import { Badge, EmptyState, PageHeader, StatusDot, LoadingRows, ResourceError } from '@ui';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel, PageItem } from '../../../effects';
import Link from '../../../navigation';
import { PostureHero, StatTile } from '../shared/fx';
import { listInstallations } from './api';
import { channelSummary, profileHref, summarize } from './logic';

export default function ArdentOverviewPage() {
  const inventory = useMagnusResource((signal) => listInstallations(signal));
  const known = inventory.data !== undefined;
  const { detected, profiles, running, needsAttention } = summarize(inventory.data ?? []);
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader
          eyebrow="Agent runtime"
          title="Magnus Ardent"
          description="Inspect the Ardent agent runtime across managed nodes. Each signal comes from the node and its authenticated profile API."
          actions={<Link href="/ardent/installations" className="btn btn--primary btn--sm no-underline">Open installations <ArrowUpRight className="size-4" /></Link>}
        />
      </PageItem>
      <PageItem>
        <PostureHero label="Running profiles" sublabel={known ? `${running} of ${profiles.length} running` : 'Checking nodes'} value={known ? running : null} max={profiles.length}>
          <StatTile icon={<Server className="size-4" />} label="Installed nodes" value={known ? detected.length : null} />
          <StatTile icon={<Activity className="size-4" />} label="Running profiles" value={known ? running : null} tone="success" />
          <StatTile icon={<Radio className="size-4" />} label="Needs attention" value={known ? needsAttention : null} tone={needsAttention ? 'warning' : 'accent'} />
        </PostureHero>
      </PageItem>
      <PageItem>
        <FxPanel title="Profiles" description="Current profile observations from managed nodes" interactive={false}>
          {!known ? (
            inventory.loading ? <LoadingRows /> : <ResourceError error={inventory.error} title="Ardent inventory is unavailable" onRetry={() => void inventory.refresh()} />
          ) : profiles.length === 0 ? (
            <EmptyState compact icon={<Bot className="size-5" />} title="No Ardent profiles detected" message="Create one on the Profiles page, or review node inventory for installation or connection errors." action={<Link href="/ardent/profiles" className="btn btn--sm no-underline">Profiles</Link>} />
          ) : (
            <div className="grid gap-3">
              {inventory.error ? <p role="alert" className="m-0 text-sm text-warning">Showing the last good inventory: {errorMessage(inventory.error)}</p> : null}
              {profiles.map((profile) => (
                <article key={`${profile.node.nodeId}:${profile.id}`} className="glow-hover grid gap-3 rounded-panel border border-border bg-surface-raised p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="m-0 flex items-center gap-2 text-base font-semibold"><StatusDot status={profile.running ? 'RUNNING' : 'STOPPED'} />{profile.name}</p>
                      <p className="m-0 mt-1 break-all font-mono text-xs text-text-muted">{profile.node.hostname} · {profile.id} · Ardent {profile.node.version ?? 'version unknown'}</p>
                    </div>
                    <Badge tone={profile.running ? 'success' : 'neutral'} dot>{profile.running ? 'Running' : 'Stopped'}</Badge>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {[
                      { label: 'Backend', value: profile.backend ?? 'Unknown', icon: Bot },
                      { label: 'A2A', value: profile.a2aEnabled ? 'Configured' : 'Disabled', icon: Radio },
                      { label: 'Channels', value: channelSummary(profile.channels), icon: Database },
                    ].map((signal) => (
                      <div key={signal.label} className="rounded-control border border-border bg-surface-sunken px-3 py-2">
                        <signal.icon className="size-4 text-accent" />
                        <p className="m-0 mt-1 text-xs text-text-muted">{signal.label}</p>
                        <p className="m-0 text-sm font-medium">{signal.value}</p>
                      </div>
                    ))}
                  </div>
                  {profile.error ? <p role="alert" className="m-0 text-sm text-danger">{profile.error}</p> : null}
                  <Link href={profileHref(profile.node.nodeId, profile.id)} className="inline-flex items-center gap-1 text-sm font-semibold">Open profile <ArrowUpRight className="size-4" /></Link>
                </article>
              ))}
            </div>
          )}
        </FxPanel>
      </PageItem>
    </div>
  );
}
