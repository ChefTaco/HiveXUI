import { useState } from 'react';
import type { z } from 'zod';
import { Activity, Boxes, CheckCircle2, CircleSlash, Cpu, FlaskConical, RefreshCw, Wrench, XCircle } from 'lucide-react';
import { applicationCanaryResponseSchema, applicationListResponseSchema, capacityAdviceResponseSchema, maintenanceListResponseSchema } from '@contracts/magnus/browser';
import { Badge, Button, EmptyState, JsonBlock, PageHeader, TableFrame } from '@ui';
import { cn } from '@lib/cn';
import { formatTime, relativeTime } from '@lib/format';
import { useToast } from '../../../../../components/toast';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel, Gauge, PageItem } from '../../../effects';
import Link from '../../../navigation';
import { hasRoute } from '../../../routes';
import { useMagnusSession, WRITE_ROLES } from '../../../session';
import { LoadingRows, ResourceError } from '../../../ui/resource-state';
import { ActionConfirm } from '../../../ui/action-confirm';
import { Figure } from '../shared/figure';
import { useSweep } from '../shared/sweep';
import { listAllNodes } from '../nodes/nodes-api';
import { MaintenancePanel } from './maintenance-panel';
import { applicationCounts, probeTone, windowState } from './model';
import { DependencyPanel, StoragePanel } from './observations';

const POLL_MS = 30_000;
type Application = z.output<typeof applicationListResponseSchema>['data'][number];
type CanaryResult = z.output<typeof applicationCanaryResponseSchema>['data'];

export default function ApplicationOperationsPage() {
  const { can } = useMagnusSession();
  const canWrite = can(WRITE_ROLES);
  const applications = useMagnusResource((signal) => magnus.get('/ops/applications', applicationListResponseSchema, { signal }), [], { pollMs: POLL_MS });
  const windows = useMagnusResource((signal) => magnus.get('/ops/maintenance', maintenanceListResponseSchema, { signal }), [], { pollMs: POLL_MS });
  const capacity = useMagnusResource((signal) => magnus.get('/ops/capacity-advice', capacityAdviceResponseSchema, { signal }), [], { pollMs: POLL_MS });
  const nodes = useMagnusResource((signal) => listAllNodes(signal));
  const nodeList = nodes.data?.nodes ?? [];
  const [canaryFor, setCanaryFor] = useState<Application | null>(null);
  const [canaryBusy, setCanaryBusy] = useState(false);
  const [canaryResults, setCanaryResults] = useState<Record<string, CanaryResult>>({});
  const toast = useToast();
  async function runCanary() {
    if (!canaryFor) return;
    setCanaryBusy(true);
    try {
      const { data } = await magnus.post(`/ops/applications/${segment(canaryFor.id)}/canary`, applicationCanaryResponseSchema);
      setCanaryResults((current) => ({ ...current, [canaryFor.id]: data }));
      if (data.status === 'pass') toast.success('Inference canary passed', `${canaryFor.serviceId} answered in ${Math.round(data.durationMs)} ms.`);
      else toast.error('Inference canary failed', `${canaryFor.serviceId} did not pass after ${Math.round(data.durationMs)} ms.`);
      setCanaryFor(null);
    } catch (error) {
      toast.error('The canary could not run', errorMessage(error));
    } finally {
      setCanaryBusy(false);
    }
  }
  const apps = applications.data?.data;
  const counts = applicationCounts(apps ?? []);
  const collector = applications.data?.meta.collector;
  const activeWindows = (windows.data?.data ?? []).filter((window) => windowState(window) === 'active').length;
  const refreshAll = () => {
    void applications.refresh();
    void windows.refresh();
    void capacity.refresh();
    void nodes.refresh();
  };
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader
          title="Application operations"
          eyebrow="Fleet"
          description="Observed readiness, advisory GPU capacity, scoped maintenance and read-only storage investigations."
          actions={<Button size="sm" icon={<RefreshCw className="size-4" />} loading={applications.refreshing || windows.refreshing || capacity.refreshing} onClick={refreshAll}>Refresh</Button>}
        />
      </PageItem>
      <PageItem>
        <FxPanel hero interactive={false} aria-label="Application readiness summary">
          <div className="flex flex-wrap items-center justify-center gap-6">
            <Gauge value={apps?.length ? (counts.pass / apps.length) * 100 : null} label="Applications passing" higherIsBetter thresholds={{ warn: 10, crit: 34 }} {...(apps?.length ? { sublabel: `${counts.pass} of ${apps.length}` } : {})} />
            <div className="grid min-w-0 flex-1 basis-64 grid-cols-2 gap-3 lg:grid-cols-4">
              <Figure label="Probed" value={apps?.length} icon={Boxes} {...(collector ? { sublabel: collector.errors ? `${collector.errors} collector error${collector.errors === 1 ? '' : 's'}` : `${collector.configured} configured` } : {})} />
              <Figure label="Passing" value={apps ? counts.pass : undefined} icon={CheckCircle2} tone={counts.pass ? 'success' : 'neutral'} />
              <Figure label="Failing" value={apps ? counts.fail : undefined} icon={XCircle} tone={counts.fail ? 'danger' : 'success'} />
              <Figure label="In maintenance" value={windows.data ? activeWindows : undefined} icon={Wrench} tone={activeWindows ? 'warning' : 'neutral'} sublabel="Active windows" />
            </div>
          </div>
        </FxPanel>
      </PageItem>
      <PageItem>
        <FxPanel title={<span className="flex items-center gap-2"><Activity className="size-4 text-accent" />Applications</span>} interactive={false}>
          {!apps ? (
            applications.loading ? <LoadingRows /> : <ResourceError error={applications.error} title="Applications could not be loaded" onRetry={() => void applications.refresh()} />
          ) : apps.length === 0 ? (
            <EmptyState compact icon={<CircleSlash className="size-4" />} title="No application probes configured" message="Add the reviewed registry on the Control API host." />
          ) : (
            <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0">
              {apps.map((app) => <ApplicationRow key={`${app.id}:${app.status}`} app={app} canWrite={canWrite} canary={canaryResults[app.id]} onCanary={() => setCanaryFor(app)} />)}
            </ul>
          )}
        </FxPanel>
      </PageItem>
      <PageItem>
        <MaintenancePanel resource={windows} nodes={nodeList} canWrite={canWrite} />
      </PageItem>
      <PageItem>
        <FxPanel title={<span className="flex items-center gap-2"><Cpu className="size-4 text-accent" />GPU capacity advice</span>} description="Advisory only. Nothing is scheduled from these observations." interactive={false}>
          {!capacity.data ? (
            capacity.loading ? <LoadingRows rows={2} /> : <ResourceError error={capacity.error} title="Capacity advice could not be loaded" onRetry={() => void capacity.refresh()} />
          ) : capacity.data.data.nodes.length === 0 ? (
            <EmptyState compact icon={<Cpu className="size-4" />} title="No GPU observations" message="Advice appears once a node reports GPU samples." />
          ) : (
            <TableFrame label="GPU capacity advice">
              <table>
                <thead><tr>{['Node', 'Capacity', 'Observed', 'Recommendation'].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead>
                <tbody>
                  {capacity.data.data.nodes.map((node) => (
                    <tr key={node.nodeId} className="fx-rail">
                      <td className="font-semibold">{node.hostname}</td>
                      <td><Badge tone={probeTone(node.capacity)} dot>{node.capacity}</Badge></td>
                      <td className="text-text-muted" title={formatTime(node.observedAt)}>{node.observedAt ? relativeTime(node.observedAt) : 'Never'}</td>
                      <td className="text-text-muted">{node.recommendation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          )}
        </FxPanel>
      </PageItem>
      <PageItem><DependencyPanel /></PageItem>
      {canWrite ? <PageItem><StoragePanel nodes={nodeList} /></PageItem> : null}
      <ActionConfirm
        open={!!canaryFor}
        title="Run one inference canary?"
        message={canaryFor ? `This sends one explicitly bounded inference request to ${canaryFor.projectId} / ${canaryFor.serviceId}. It uses real capacity.` : ''}
        confirmLabel="Run canary"
        loading={canaryBusy}
        onConfirm={() => void runCanary()}
        onCancel={() => setCanaryFor(null)}
      />
    </div>
  );
}

function ApplicationRow({ app, canWrite, canary, onCanary }: { app: Application; canWrite: boolean; canary: CanaryResult | undefined; onCanary: () => void }) {
  const sweep = useSweep();
  return (
    <li className={cn(sweep, 'glow-hover relative rounded-panel border bg-surface-raised p-3', app.status === 'fail' ? 'border-danger' : 'border-border')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <strong className="min-w-0 break-words">{app.projectId} / {app.serviceId}</strong>
        <Badge tone={probeTone(app.status)} dot className={app.status === 'fail' ? 'fx-badge-pulse' : ''}>{app.status}</Badge>
        <Badge>{app.kind}</Badge>
        {canary ? <Badge tone={probeTone(canary.status)}>Canary {canary.status}, {Math.round(canary.durationMs)} ms{canary.totalTokens !== null ? `, ${canary.totalTokens} tokens` : ''}</Badge> : null}
        <span className="flex-1" />
        {app.kind === 'hive-router' && canWrite ? <Button size="sm" icon={<FlaskConical className="size-4" />} onClick={onCanary}>Run one inference canary</Button> : null}
      </div>
      <p className="m-0 mt-1 text-sm text-text-muted">
        {hasRoute(`/nodes/${encodeURIComponent(app.nodeId)}`) ? <Link href={`/nodes/${encodeURIComponent(app.nodeId)}`}>{app.nodeId}</Link> : app.nodeId}
        {' · '}
        <span title={formatTime(app.observedAt)}>{app.observedAt ? `Observed ${relativeTime(app.observedAt)}` : 'Never observed'}</span>
        {app.result.releaseRevision ? <> · <span className="font-mono">{app.result.releaseRevision}</span></> : null}
      </p>
      {app.result.checks?.length ? (
        <ul className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0" aria-label="Probe checks">
          {app.result.checks.map((check, index) => <li key={index} title={check.detail}><Badge tone={probeTone(check.status)}>{check.status}: {check.detail}</Badge></li>)}
        </ul>
      ) : null}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-text-muted">Readiness evidence</summary>
        <div className="mt-2"><JsonBlock value={app.result} /></div>
      </details>
    </li>
  );
}
