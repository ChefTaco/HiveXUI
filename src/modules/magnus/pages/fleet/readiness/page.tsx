import { Activity, ArrowRight, RefreshCw, Server, ShieldAlert, Wrench } from 'lucide-react';
import { fleetReadinessResponseSchema, retentionSummaryResponseSchema, timelineResponseSchema } from '@contracts/magnus/browser';
import { Badge, Button, buttonClass, EmptyState, PageHeader, statusTone, TableFrame, LoadingRows, ResourceError } from '@ui';
import { cn } from '@lib/cn';
import { formatTime, relativeTime } from '@lib/format';
import { magnus } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { FleetRadar, FxMeter, FxPanel, Gauge, PageItem } from '../../../effects';
import Link from '../../../navigation';
import { hasRoute } from '../../../routes';
import { useMagnusSession } from '../../../session';
import { Figure } from '../shared/figure';
import { useSweep } from '../shared/sweep';
import { RetentionPanel } from '../../operations/retention/retention-panel';
import { TimelinePanel } from '../fleet-timeline/timeline-panel';
import { fleetNodes, radarCounts, type ReadinessNode } from './model';

const POLL_MS = 30_000;
const TIMELINE_LIMIT = 120;

export default function FleetReadinessPage() {
  const readiness = useMagnusResource((signal) => magnus.get('/ops/readiness', fleetReadinessResponseSchema, { signal }), [], { pollMs: POLL_MS });
  const timeline = useMagnusResource((signal) => magnus.get('/ops/timeline', timelineResponseSchema, { query: { limit: TIMELINE_LIMIT }, signal }), [], { pollMs: POLL_MS });
  const retention = useMagnusResource((signal) => magnus.get('/ops/retention', retentionSummaryResponseSchema, { signal }));
  const nodes = readiness.data ? fleetNodes(readiness.data.data.nodes) : undefined;
  const refreshAll = () => {
    void readiness.refresh();
    void timeline.refresh();
    void retention.refresh();
  };
  return (
    <div className="page-stack" data-testid="fleet-readiness-page">
      <PageItem>
        <PageHeader
          title="Fleet readiness"
          eyebrow="Fleet"
          description="Deploy eligibility, heartbeat freshness, Hermes posture and destructive-action gates, with the fleet timeline and data retention."
          actions={
            <>
              <Button size="sm" onClick={() => document.getElementById('fleet-timeline')?.scrollIntoView()}>Timeline</Button>
              <Button size="sm" onClick={() => document.getElementById('data-retention')?.scrollIntoView()}>Retention</Button>
              <Button size="sm" icon={<RefreshCw className="size-4" />} loading={readiness.refreshing || timeline.refreshing || retention.refreshing} onClick={refreshAll}>Refresh</Button>
            </>
          }
        />
      </PageItem>
      {nodes ? <PageItem><ReadinessHero nodes={nodes} /></PageItem> : null}
      <PageItem>
        <FxPanel title="Nodes" interactive={false}>
          {!nodes ? (
            readiness.loading ? <LoadingRows rows={5} /> : <ResourceError error={readiness.error} title="Readiness data unavailable" onRetry={() => void readiness.refresh()} />
          ) : nodes.length === 0 ? (
            <EmptyState icon={<Server className="size-5" />} title="No nodes to assess" message="Readiness appears here once a node is registered." />
          ) : (
            <>
              {readiness.error ? <p role="alert" className="m-0 mb-3 text-sm text-warning">Showing the last good answer: {errorMessage(readiness.error)}</p> : null}
              <ReadinessTable nodes={nodes} />
            </>
          )}
        </FxPanel>
      </PageItem>
      <PageItem><TimelinePanel resource={timeline} limit={TIMELINE_LIMIT} actions={<FullPage path="/fleet-timeline" label="Open the timeline" />} /></PageItem>
      <PageItem><RetentionPanel resource={retention} actions={<FullPage path="/retention" label="Open retention" />} /></PageItem>
    </div>
  );
}

function ReadinessHero({ nodes }: { nodes: readonly ReadinessNode[] }) {
  const stale = nodes.filter((node) => node.stale).length;
  const blocked = nodes.filter((node) => node.destructiveActionsBlocked).length;
  const eligible = nodes.filter((node) => node.deployEligible).length;
  return (
    <FxPanel hero interactive={false} aria-label="Fleet readiness summary">
      <div className="flex flex-wrap items-center justify-center gap-6">
        <FleetRadar counts={radarCounts(nodes)} />
        <Gauge value={nodes.length ? (eligible / nodes.length) * 100 : null} label="Deploy eligible" higherIsBetter thresholds={{ warn: 10, crit: 34 }} sublabel={`${eligible} of ${nodes.length}`} />
        <div className="grid min-w-0 flex-1 basis-64 grid-cols-2 gap-3">
          <Figure label="Nodes" value={nodes.length} icon={Server} />
          <Figure label="Stale" value={stale} icon={ShieldAlert} tone={stale ? 'warning' : 'success'} />
          <Figure label="Deploy eligible" value={eligible} icon={Wrench} />
          <Figure label="Blocked actions" value={blocked} icon={Activity} tone={blocked ? 'warning' : 'success'} />
        </div>
      </div>
    </FxPanel>
  );
}

function ReadinessTable({ nodes }: { nodes: readonly ReadinessNode[] }) {
  const { hermes } = useMagnusSession();
  const sweep = useSweep();
  return (
    <TableFrame label="Node readiness">
      <table>
        <thead>
          <tr>
            {['Node', 'Posture', 'Agent', ...(hermes ? ['Hermes'] : []), 'Health', 'Action'].map((heading) => <th key={heading}>{heading}</th>)}
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => (
            <tr key={`${node.id}:${node.operationalStatus}`} className={cn(sweep, 'fx-rail')}>
              <td>
                {hasRoute(`/nodes/${encodeURIComponent(node.id)}`) ? <Link href={`/nodes/${encodeURIComponent(node.id)}`} className="font-semibold">{node.name}</Link> : <span className="font-semibold">{node.name}</span>}
                <div className="text-xs text-text-muted">{node.hostname} · {node.os}/{node.arch}</div>
              </td>
              <td>
                <Badge tone={node.stale ? 'warning' : statusTone(node.operationalStatus)} dot className={node.stale ? 'fx-badge-pulse' : ''}>{node.operationalStatus}</Badge>
                <div className="mt-1 text-xs text-text-muted" title={formatTime(node.lastHeartbeatAt)}>{node.lastHeartbeatAt ? `Heartbeat ${relativeTime(node.lastHeartbeatAt)}` : 'Never reported'}</div>
              </td>
              <td>
                <div className="num">{node.agentVersion ?? 'Unknown'}</div>
                <div className="text-xs text-text-muted">{node.agentStatus ?? 'Not reported'}</div>
              </td>
              {hermes ? (
                <td>
                  <div>{node.hermes?.status ?? 'Unknown'}</div>
                  <div className="text-xs text-text-muted">Gateway {node.hermes?.gatewayStatus ?? 'unknown'}</div>
                </td>
              ) : null}
              <td className="min-w-40">
                {node.health ? (
                  <div className="grid gap-1">
                    <FxMeter value={node.health.cpuUsagePercent} label={`${node.name} CPU`} valueLabel={`CPU ${Math.round(node.health.cpuUsagePercent)}%`} />
                    <FxMeter value={node.health.memoryPercent} label={`${node.name} memory`} valueLabel={`Mem ${Math.round(node.health.memoryPercent)}%`} />
                    <div className={cn('text-xs', node.health.diskWarnings.length ? 'text-warning' : 'text-text-muted')}>
                      {node.health.diskWarnings.length ? `${node.health.diskWarnings.length} disk warning${node.health.diskWarnings.length === 1 ? '' : 's'}` : 'No disk warnings'}
                    </div>
                  </div>
                ) : <span className="text-xs text-text-muted">No health data</span>}
              </td>
              <td>
                {node.destructiveActionsBlocked ? <span className="text-sm text-warning">Blocked while stale</span> : hasRoute('/governor/operations') ? <Link href={`/governor/operations?node=${encodeURIComponent(node.id)}`} className="text-sm">Run preflight</Link> : <span className="text-sm text-text-muted">Not blocked</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

/** The panel's own page, once it is ported. */
function FullPage({ path, label }: { path: string; label: string }) {
  if (!hasRoute(path)) return null;
  return <Link href={path} className={buttonClass({ size: 'sm', variant: 'ghost' })}>{label}<ArrowRight aria-hidden="true" className="size-4" /></Link>;
}
