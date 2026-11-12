import { useState } from 'react';
import type { z } from 'zod';
import { Activity, Clock, Database, HardDrive, History, RefreshCw, Server, ShieldAlert, Wrench } from 'lucide-react';
import { fleetReadinessResponseSchema, timelineResponseSchema } from '@contracts/magnus/browser';
import { Badge, Button, EmptyState, PageHeader, statusTone, TableFrame, LoadingRows, ResourceError } from '@ui';
import { cn } from '@lib/cn';
import { formatTime, relativeTime } from '@lib/format';
import { magnus } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource, type Resource } from '../../../api/use-resource';
import { FleetRadar, FxMeter, FxPanel, Gauge, PageItem } from '../../../effects';
import Link from '../../../navigation';
import { hasRoute } from '../../../routes';
import { useMagnusSession } from '../../../session';
import { Figure } from '../shared/figure';
import { severityTone } from '../shared/severity';
import { useArrivals, useSweep } from '../shared/sweep';
import { fleetNodes, keyedTimeline, radarCounts, TIMELINE_TYPES, totalRecords, type ReadinessNode, type TimelineFilter } from './model';
import { retentionResponseSchema } from './schemas';

const POLL_MS = 30_000;
const TIMELINE_LIMIT = 120;

export default function FleetReadinessPage() {
  const readiness = useMagnusResource((signal) => magnus.get('/ops/readiness', fleetReadinessResponseSchema, { signal }), [], { pollMs: POLL_MS });
  const timeline = useMagnusResource((signal) => magnus.get('/ops/timeline', timelineResponseSchema, { query: { limit: TIMELINE_LIMIT }, signal }), [], { pollMs: POLL_MS });
  const retention = useMagnusResource((signal) => magnus.get('/ops/retention', retentionResponseSchema, { signal }));
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
      <PageItem><TimelinePanel resource={timeline} /></PageItem>
      <PageItem><RetentionPanel resource={retention} /></PageItem>
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

function TimelinePanel({ resource }: { resource: Resource<z.output<typeof timelineResponseSchema>> }) {
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const items = resource.data ? keyedTimeline(resource.data.data, filter) : undefined;
  const arrival = useArrivals(resource.data ? keyedTimeline(resource.data.data).map(({ key }) => key) : undefined);
  return (
    <FxPanel
      id="fleet-timeline"
      title={<span className="flex items-center gap-2"><History className="size-4 text-accent" />Fleet timeline</span>}
      description="Recent commands, deploys, Hermes jobs, logs, audit events and notifications in one stream."
      interactive={false}
      className="scroll-mt-4"
    >
      <div className="grid gap-3">
        <div className="segmented-tabs justify-self-start" role="group" aria-label="Filter the timeline by type">
          {(['all', ...TIMELINE_TYPES] as const).map((type) => (
            <button key={type} type="button" aria-pressed={filter === type} className={cn('tab-button capitalize', filter === type && 'tab-button--active')} onClick={() => setFilter(type)}>{type}</button>
          ))}
        </div>
        {!items ? (
          resource.loading ? <LoadingRows rows={6} /> : <ResourceError error={resource.error} title="Timeline data unavailable" onRetry={() => void resource.refresh()} />
        ) : items.length === 0 ? (
          <EmptyState compact icon={<Clock className="size-4" />} title={filter === 'all' ? 'Nothing on the timeline yet' : `No ${filter} events in the latest ${TIMELINE_LIMIT}`} />
        ) : (
          <ol className="m-0 grid max-h-[32rem] list-none grid-cols-1 gap-px overflow-y-auto p-0" tabIndex={0} aria-label="Timeline events">
            {items.map((item) => (
              <li key={item.key} className={cn(arrival(item.key), 'fx-rail rounded-chip hover:bg-surface-hover')}>
                <div className="grid gap-x-3 gap-y-0.5 px-3 py-2 text-sm sm:grid-cols-[11rem_6rem_minmax(0,1fr)_5rem] sm:items-center">
                  <span className="num flex items-center gap-2 text-xs text-text-muted"><Clock className="size-3.5 shrink-0" aria-hidden="true" />{formatTime(item.timestamp)}</span>
                  <span className="text-xs font-medium capitalize text-accent">{item.type}</span>
                  <span className="min-w-0 break-words">
                    {hasRoute(item.href) ? <Link href={item.href}>{item.title}</Link> : item.title}
                    {item.node ? <span className="block text-xs text-text-muted">{item.node}</span> : null}
                  </span>
                  <span><Badge tone={severityTone(item.severity)}>{item.severity}</Badge></span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </FxPanel>
  );
}

function RetentionPanel({ resource }: { resource: Resource<z.output<typeof retentionResponseSchema>> }) {
  const data = resource.data?.data;
  return (
    <FxPanel
      id="data-retention"
      title={<span className="flex items-center gap-2"><Database className="size-4 text-accent" />Data retention</span>}
      description="Operational data volume, oldest rows and purge policy."
      interactive={false}
      className="scroll-mt-4"
    >
      {!data ? (
        resource.loading ? <LoadingRows rows={5} /> : <ResourceError error={resource.error} title="Retention data unavailable" onRetry={() => void resource.refresh()} />
      ) : (
        <div className="grid gap-4">
          {data.policyStatus ? <p className="m-0"><Badge tone={data.policyStatus.status === 'pass' ? 'success' : 'warning'} dot>Policy {data.policyStatus.status}: {data.policyStatus.message}</Badge></p> : null}
          <div className="grid grid-cols-2 gap-3">
            <Figure label="Total records" value={totalRecords(data.tables).toLocaleString()} icon={Database} />
            <Figure label="Tables tracked" value={data.tables.length} icon={HardDrive} tone="info" />
          </div>
          <TableFrame label="Retention by table">
            <table>
              <thead><tr>{['Table', 'Rows', 'Oldest', 'Policy', 'Calculated cutoffs'].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead>
              <tbody>
                {data.tables.map((table) => (
                  <tr key={table.name} className="fx-rail">
                    <td className="font-semibold">{table.name}</td>
                    <td className="num text-accent">{table.count.toLocaleString()}</td>
                    <td className="text-text-muted">{table.oldestAt ? <span title={table.oldestAt}>{formatTime(table.oldestAt)}</span> : table.count ? 'Not tracked' : 'None'}</td>
                    <td className="text-text-muted">{table.policy}</td>
                    <td className="text-xs text-text-muted">
                      {table.cutoffs ? Object.entries(table.cutoffs).map(([name, value]) => <div key={name}><span className="font-semibold">{name}:</span> {formatTime(value)}</div>) : 'None'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        </div>
      )}
    </FxPanel>
  );
}
