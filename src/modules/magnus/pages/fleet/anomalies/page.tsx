import { AlertTriangle, ArrowRight, RefreshCw, ShieldAlert, ShieldCheck, Siren, Zap } from 'lucide-react';
import { Badge, Button, EmptyState, PageHeader, LoadingRows, ResourceError } from '@ui';
import { cn } from '@lib/cn';
import { formatTime } from '@lib/format';
import { magnus } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { FxMeter, FxPanel, PageItem } from '../../../effects';
import Link from '../../../navigation';
import { Figure } from '../shared/figure';
import { severityTone } from '../shared/severity';
import { useSweep } from '../shared/sweep';
import { activeBands, hotspot } from './model';
import { anomalyListResponseSchema, anomalySummaryResponseSchema, type AnomalyEvent } from './schemas';

const PAGE_SIZE = 100;

export default function AnomaliesPage() {
  const summary = useMagnusResource((signal) => magnus.get('/anomalies/summary', anomalySummaryResponseSchema, { signal }));
  const list = useMagnusResource((signal) => magnus.get('/anomalies', anomalyListResponseSchema, { query: { resolved: 'false', pageSize: PAGE_SIZE }, signal }));
  const anomalies = list.data?.data.anomalies;
  const total = list.data?.data.total ?? 0;
  const data = summary.data?.data;
  const bands = activeBands(data);
  const top = hotspot(data);
  const refresh = () => {
    void summary.refresh();
    void list.refresh();
  };
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader
          title="Anomalies"
          eyebrow="Fleet"
          icon={<Siren className="size-5" />}
          description="Fleet-wide anomaly feed with correlation drill-down."
          actions={
            <>
              <Link href="/anomalies/remediation" className="btn btn--sm no-underline"><Zap className="size-4" />Auto-remediation</Link>
              <Button size="sm" icon={<RefreshCw className="size-4" />} loading={summary.refreshing || list.refreshing} onClick={refresh}>Refresh</Button>
            </>
          }
        />
      </PageItem>
      <PageItem>
        <FxPanel hero interactive={false} aria-label="Anomaly summary">
          {summary.error && !data ? <ResourceError error={summary.error} title="The summary could not be loaded" onRetry={() => void summary.refresh()} /> : (
            <div className="grid gap-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Figure label="Active anomalies" value={data?.totalActive} icon={ShieldAlert} tone={data?.totalActive ? 'danger' : 'success'} />
                <Figure label="Severity bands active" value={data ? bands.length : undefined} icon={AlertTriangle} tone={bands.length ? 'warning' : 'success'} sublabel={bands.length ? bands.map(({ severity, count }) => `${count} ${severity}`).join(', ') : 'None'} />
                <Figure label="Current hotspot" value={top?.nodeName ?? (data ? 'None' : undefined)} icon={Siren} tone={top ? 'warning' : 'neutral'} {...(top ? { sublabel: `${top.count} active: ${top.metrics.join(', ')}` } : {})} />
              </div>
              {bands.length ? (
                <div className="grid gap-1.5">
                  {bands.map(({ severity, count }) => <FxMeter key={severity} value={count} max={data?.totalActive || 1} tone={severityTone(severity)} glow label={`${severity} share`} valueLabel={`${count} ${severity}`} />)}
                </div>
              ) : null}
            </div>
          )}
        </FxPanel>
      </PageItem>
      <PageItem>
        <FxPanel title="Unresolved anomalies" interactive={false}>
          {!anomalies ? (
            list.loading ? <LoadingRows rows={5} /> : <ResourceError error={list.error} title="Anomalies could not be loaded" onRetry={() => void list.refresh()} />
          ) : anomalies.length === 0 ? (
            <EmptyState icon={<ShieldCheck className="size-5" />} title="No unresolved anomalies" message="A rare and beautiful sight." />
          ) : (
            <>
              {list.error ? <p role="alert" className="m-0 mb-3 text-sm text-warning">Showing the last good list: {errorMessage(list.error)}</p> : null}
              <ul className="m-0 grid list-none grid-cols-1 p-0">{anomalies.map((anomaly) => <AnomalyRow key={`${anomaly.id}:${anomaly.occurrenceCount}`} anomaly={anomaly} />)}</ul>
              {total > anomalies.length ? <p className="m-0 mt-3 text-sm text-text-muted">Showing the newest {anomalies.length} of {total}.</p> : null}
            </>
          )}
        </FxPanel>
      </PageItem>
    </div>
  );
}

function AnomalyRow({ anomaly }: { anomaly: AnomalyEvent }) {
  const tone = severityTone(anomaly.severity);
  const sweep = useSweep();
  return (
    <li className={cn(sweep, 'fx-rail border-b border-border last:border-b-0')}>
      <Link href={`/anomalies/${encodeURIComponent(anomaly.id)}`} className="flex items-center justify-between gap-4 px-3 py-3 text-text no-underline hover:bg-surface-hover">
        <span className="min-w-0 flex-1">
          <span className="mb-1 flex flex-wrap items-center gap-2">
            <Badge tone={tone} dot={tone === 'danger'} className={tone === 'danger' ? 'fx-badge-pulse' : ''}>{anomaly.severity}</Badge>
            <span className="font-semibold">{anomaly.metric}</span>
            <span className="text-sm text-text-muted">{anomaly.node?.name ?? anomaly.nodeId}</span>
            {anomaly.occurrenceCount > 1 ? <Badge tone="info"><span className="num">×{anomaly.occurrenceCount}</span></Badge> : null}
          </span>
          <span className="num block text-sm text-text-muted">
            Value {anomaly.value.toFixed(2)} · z-score {anomaly.zScore.toFixed(2)} · first seen {formatTime(anomaly.firstSeenAt)}
            {anomaly.occurrenceCount > 1 ? <> · last seen {formatTime(anomaly.lastSeenAt)}</> : null}
          </span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
      </Link>
    </li>
  );
}
