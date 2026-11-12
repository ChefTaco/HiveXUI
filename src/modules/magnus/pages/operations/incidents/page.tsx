import { Activity, ExternalLink, Radar, RefreshCw, ShieldAlert } from 'lucide-react';
import { dependencyHealthResponseSchema, incidentSummaryResponseSchema, timelineResponseSchema } from '@contracts/magnus/browser';
import { Badge, Button, PageHeader, LoadingRows, ResourceError, buttonClass } from '@ui';
import { formatTime } from '@lib/format';
import { cn } from '@lib/cn';
import { productEnabled } from '../../../../../lib/runtime';
import { magnus } from '../../../api/client';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel, GLOW_TEXT, HaloDot, PageItem, TONE_TEXT } from '../../../effects';
import Link, { useSearchParams } from '../../../navigation';
import { hasRoute } from '../../../routes';
import { useMagnusSession, WRITE_ROLES } from '../../../session';
import { EvidenceReview } from './evidence-review';
import { CHECK_TONE, HEALTH_TONE, severityTone, windowHours } from './incident-model';

const EDGE = { success: 'border-l-success', warning: 'border-l-warning', danger: 'border-l-danger', neutral: 'border-l-border', accent: 'border-l-accent', signal: 'border-l-signal', info: 'border-l-info' };

export default function IncidentsPage() {
  const params = useSearchParams();
  const { can } = useMagnusSession();
  const nodeId = params.get('nodeId') || undefined;
  const hours = windowHours(params.get('hours'));
  const incident = useMagnusResource((signal) => magnus.get('/ops/incident-summary', incidentSummaryResponseSchema, { query: { nodeId, hours }, signal }), [nodeId, hours]);
  const health = useMagnusResource((signal) => magnus.get('/ops/dependency-health', dependencyHealthResponseSchema, { signal }));
  const timeline = useMagnusResource((signal) => magnus.get('/ops/timeline', timelineResponseSchema, { query: { limit: 25 }, signal }));
  const summary = incident.data?.data;
  const dependencies = health.data?.data;
  const healthTone = dependencies ? HEALTH_TONE[dependencies.status] : 'neutral';
  const refreshing = incident.refreshing || health.refreshing || timeline.refreshing;
  const refresh = () => {
    void incident.refresh();
    void health.refresh();
    void timeline.refresh();
  };
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader
          title="Incident workspace"
          eyebrow={<span className="text-danger">Evidence, not execution</span>}
          icon={<ShieldAlert className="size-5" />}
          description="A redacted operating picture. Suggested remediation remains a dry run until explicitly confirmed elsewhere."
          actions={
            <>
              {productEnabled('cindertrace') ? <Link href="/security-fusion/cases" className={buttonClass({ size: 'sm' })}><ExternalLink className="size-4" />Correlated security cases</Link> : null}
              <Button size="sm" icon={<RefreshCw className="size-4" />} loading={refreshing} onClick={refresh}>Refresh</Button>
            </>
          }
        />
      </PageItem>
      {can(WRITE_ROLES) ? <PageItem><EvidenceReview /></PageItem> : null}
      <PageItem>
        <div className="grid gap-3 lg:grid-cols-[4fr_6fr]">
          <FxPanel hero title={<span className="flex items-center gap-2"><Radar className="size-4 text-danger" />Current classification</span>} fxTone="danger" interactive={false}>
            {!summary ? (
              incident.loading ? <LoadingRows rows={3} /> : <ResourceError error={incident.error} title="Unavailable" onRetry={() => void incident.refresh()} />
            ) : (
              <>
                <p className="m-0 text-lg font-bold">{summary.blastRadius}</p>
                {summary.node ? <p className="m-0 mt-1 text-sm text-text-muted">{summary.node.name} · {summary.node.hostname}</p> : null}
                <ul className="m-0 mt-3 grid list-none gap-2 p-0 text-sm text-warning">
                  {summary.likelyCauses.map((cause) => <li key={cause}>— {cause}</li>)}
                </ul>
                <p className="num m-0 mt-4 border-t border-border pt-3 text-xs text-text-muted">Window {summary.windowHours}h · refreshed {formatTime(summary.generatedAt)}</p>
              </>
            )}
          </FxPanel>
          <FxPanel
            title={<span className="flex items-center gap-2"><Activity className="size-4 text-accent" />Dependency map</span>}
            actions={<Badge tone={healthTone} dot className={healthTone === 'danger' ? 'fx-badge-pulse' : ''}>{dependencies?.status ?? 'unavailable'}</Badge>}
            fxTone={healthTone === 'danger' ? 'danger' : healthTone === 'warning' ? 'warning' : 'accent'}
            interactive={false}
          >
            {!dependencies ? (
              health.loading ? <LoadingRows rows={3} /> : <ResourceError error={health.error} title="Dependency health is unavailable" onRetry={() => void health.refresh()} />
            ) : (
              <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
                {dependencies.checks.map((check) => {
                  const tone = CHECK_TONE[check.status];
                  return (
                    <li key={check.name} className={cn('border-l-2 pl-2 text-sm', EDGE[tone])}>
                      <div className="flex flex-wrap items-center gap-2 font-semibold">
                        {check.status === 'fail' ? <HaloDot tone="danger" /> : null}
                        {check.name}
                        <span className={cn(TONE_TEXT[tone], GLOW_TEXT[tone])}>{check.status}</span>
                      </div>
                      <div className="text-xs text-text-muted">{check.message}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </FxPanel>
        </div>
      </PageItem>
      <PageItem>
        <FxPanel title="Fleet timeline" interactive={false}>
          {!timeline.data ? (
            timeline.loading ? <LoadingRows /> : <ResourceError error={timeline.error} title="The timeline is unavailable" onRetry={() => void timeline.refresh()} />
          ) : timeline.data.data.length === 0 ? (
            <p className="m-0 text-sm text-text-muted">No fleet activity yet.</p>
          ) : (
            <ol className="m-0 grid list-none gap-2 p-0">
              {timeline.data.data.map((item, index) => (
                <li key={`${item.timestamp}-${index}`} className="fx-rail grid gap-x-3 gap-y-0.5 border-b border-border pb-2 text-sm sm:grid-cols-[10rem_7rem_1fr]">
                  <span className="num text-xs text-text-muted sm:text-sm">{formatTime(item.timestamp)}</span>
                  <span className={cn('text-xs sm:text-sm', TONE_TEXT[severityTone(item.severity)])}>{item.type}</span>
                  <span className="min-w-0 break-words">
                    {hasRoute(item.href) ? <Link href={item.href}>{item.title}</Link> : item.title}
                    {item.node ? <span className="ml-2 text-xs text-text-muted">{item.node}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </FxPanel>
      </PageItem>
    </div>
  );
}
