import { CircleAlert, Code2, KeyRound, RefreshCw, Server } from 'lucide-react';
import { Badge, Button, EmptyState, PageHeader, StatusDot } from '@ui';
import { errorMessage } from '../../../api/errors';
import { FxPanel, PageItem } from '../../../effects';
import Link from '../../../navigation';
import { LoadingRows, ResourceError } from '../../../ui/resource-state';
import { PostureHero, StatTile } from '../shared/fx';
import { summarize } from './logic';
import { useCodexFleet } from './use-codex';

export default function CodexOverviewPage() {
  const fleet = useCodexFleet();
  const known = fleet.data !== undefined;
  const { installed, healthy, updates, needsLogin, latestVersion } = summarize(fleet.data ?? []);
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader
          eyebrow="Agent runtime"
          title="Codex agents"
          description="ChatGPT OAuth and CLI release posture · API tokens disabled"
          actions={
            <>
              <Button size="sm" icon={<RefreshCw className="size-4" />} loading={fleet.refreshing} onClick={() => void fleet.refreshLatest()}>Refresh</Button>
              <Link href="/codex/installations" className="btn btn--primary btn--sm no-underline"><Server className="size-4" />Installations</Link>
            </>
          }
        />
      </PageItem>
      <PageItem>
        <PostureHero label="OAuth healthy" sublabel={known ? `${healthy} of ${installed.length} installations` : 'Checking nodes'} value={known ? healthy : null} max={installed.length}>
          <StatTile icon={<Code2 className="size-4" />} label="Codex installed" value={known ? installed.length : null} />
          <StatTile icon={<KeyRound className="size-4" />} label="OAuth healthy" value={known ? healthy : null} tone="success" />
          <StatTile icon={<RefreshCw className="size-4" />} label="Updates available" value={known ? updates : null} tone="warning" />
          <StatTile icon={<CircleAlert className="size-4" />} label="Needs login" value={known ? needsLogin : null} tone="danger" />
        </PostureHero>
      </PageItem>
      <PageItem>
        <FxPanel title="Fleet posture" description={`Latest published Codex CLI: ${latestVersion}`} interactive={false}>
          {!known ? (
            fleet.loading ? <LoadingRows /> : <ResourceError error={fleet.error} title="Codex fleet state could not be loaded" onRetry={() => void fleet.refresh()} />
          ) : installed.length === 0 ? (
            <EmptyState compact icon={<Code2 className="size-5" />} title="No Codex installations" message={`None were detected across ${fleet.data?.length ?? 0} managed nodes.`} />
          ) : (
            <div className="grid gap-2">
              {fleet.error ? <p role="alert" className="m-0 text-sm text-warning">Showing the last good state: {errorMessage(fleet.error)}</p> : null}
              {installed.map((item) => (
                <div key={item.nodeId} className="glow-hover flex flex-wrap items-center justify-between gap-3 rounded-control border border-border bg-surface-raised px-3 py-2">
                  <div className="min-w-0">
                    <p className="m-0 flex items-center gap-2 text-sm font-medium"><StatusDot status={item.auth.oauth ? 'HEALTHY' : 'DEGRADED'} />{item.nodeName}</p>
                    <p className="m-0 mt-0.5 font-mono text-xs text-text-muted">{item.version ?? 'version unknown'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.updateAvailable ? <Badge tone="warning">update</Badge> : null}
                    <Badge tone={item.auth.oauth ? 'success' : 'warning'} dot>{item.auth.oauth ? 'OAuth current' : item.auth.status.replaceAll('_', ' ')}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </FxPanel>
      </PageItem>
    </div>
  );
}
