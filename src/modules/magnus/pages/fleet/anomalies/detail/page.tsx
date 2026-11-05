import { useState } from 'react';
import { ArrowLeft, Bot, Clock3, GitBranch, Lightbulb, RefreshCw, Siren, Terminal, Zap } from 'lucide-react';
import { Badge, Button, EmptyState, PageHeader } from '@ui';
import { cn } from '@lib/cn';
import { formatTime } from '@lib/format';
import { useToast } from '../../../../../../components/toast';
import { magnus } from '../../../../api/client';
import { errorMessage, MagnusApiError } from '../../../../api/errors';
import { useMagnusResource } from '../../../../api/use-resource';
import { FxPanel, HaloDot, PageItem } from '../../../../effects';
import Link, { notFound, useParams } from '../../../../navigation';
import { hasRoute } from '../../../../routes';
import { useMagnusSession, WRITE_ROLES } from '../../../../session';
import { LoadingRows, ResourceError } from '../../../../ui/resource-state';
import { Figure } from '../../shared/figure';
import { severityTone } from '../../shared/severity';
import { useSweep } from '../../shared/sweep';
import { correlationTimeline, executionIsLive, executionTone, type CorrelationItem } from '../model';
import { anomalyCorrelationResponseSchema, heartbeatConversationsResponseSchema, remediationExecutionListResponseSchema, remediationRuleListResponseSchema, remediationTriggerResponseSchema, type RemediationRule } from '../schemas';

const EXECUTION_PAGE = 100;
const DOT_TONE = { 'target-anomaly': 'accent', 'correlated-anomaly': 'danger', command: 'warning' } as const;
const ITEM_BORDER = { 'target-anomaly': 'border-accent', 'correlated-anomaly': 'border-danger', command: 'border-warning' } as const;

export default function AnomalyDetailPage() {
  const { anomalyId = '' } = useParams<{ anomalyId: string }>();
  const toast = useToast();
  const { can } = useMagnusSession();
  const canTrigger = can(WRITE_ROLES);
  const sweep = useSweep();
  const details = useMagnusResource((signal) => magnus.get(`/anomalies/event/${encodeURIComponent(anomalyId)}/correlation`, anomalyCorrelationResponseSchema, { signal }), [anomalyId]);
  // Only once the anomaly exists: a missing one leaves this page at once.
  const found = !!details.data;
  const heartbeat = useMagnusResource((signal) => magnus.get('/assistant/conversations', heartbeatConversationsResponseSchema, { query: { type: 'heartbeat', status: 'all', pageSize: 1 }, signal }), [], { enabled: found });
  const rules = useMagnusResource((signal) => magnus.get('/remediation/rules', remediationRuleListResponseSchema, { signal }), [], { enabled: found });
  const executions = useMagnusResource((signal) => magnus.get('/remediation/executions', remediationExecutionListResponseSchema, { query: { pageSize: EXECUTION_PAGE }, signal }), [], { enabled: found });
  const [triggering, setTriggering] = useState('');
  async function trigger(rule: RemediationRule) {
    setTriggering(rule.id);
    try {
      const { data } = await magnus.post('/remediation/trigger', remediationTriggerResponseSchema, { body: { anomalyEventId: anomalyId, ruleId: rule.id } });
      if (data.status === 'skipped') toast.error(`${rule.name} was skipped`, 'Its runbook could not be planned. See its execution for the reason.');
      else toast.success(`${rule.name}: ${data.status.replace('_', ' ')}`, 'A rule already inside its cooldown returns its latest execution.');
      await executions.refresh();
    } catch (error) {
      toast.error('The rule could not be triggered', errorMessage(error));
    } finally {
      setTriggering('');
    }
  }
  if (details.error instanceof MagnusApiError && details.error.notFound) notFound();
  const data = details.data?.data;
  const timeline = data ? correlationTimeline(data) : [];
  const activeRules = (rules.data?.data ?? []).filter((rule) => rule.enabled);
  const related = (executions.data?.data.executions ?? []).filter((execution) => execution.anomalyEventId === anomalyId);
  const hasConversation = (heartbeat.data?.data.conversations.length ?? 0) > 0;
  const refresh = () => {
    void details.refresh();
    void heartbeat.refresh();
    void rules.refresh();
    void executions.refresh();
  };
  return (
    <div className="page-stack">
      <PageItem>
        <Link href="/anomalies" className="mb-2 inline-flex items-center gap-1 text-sm"><ArrowLeft className="size-4" />Back to anomalies</Link>
        <PageHeader
          title="Anomaly analysis"
          eyebrow="Anomalies"
          icon={<Siren className="size-5" />}
          description="Correlation timeline, root-cause hypotheses and recommended actions."
          status={data ? (
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={severityTone(data.anomaly.severity)} dot={!data.anomaly.resolved} className={data.anomaly.resolved ? '' : 'fx-badge-pulse'}>{data.anomaly.severity}</Badge>
              <Badge tone={data.anomaly.resolved ? 'success' : 'neutral'}>{data.anomaly.resolved ? 'Resolved' : 'Unresolved'}</Badge>
            </span>
          ) : undefined}
          actions={<Button size="sm" icon={<RefreshCw className="size-4" />} loading={details.refreshing} onClick={refresh}>Refresh</Button>}
        />
      </PageItem>
      {!data ? (
        <PageItem>
          <FxPanel interactive={false}>
            {details.loading ? <LoadingRows rows={5} /> : <ResourceError error={details.error} title="Correlation details could not be loaded" onRetry={() => void details.refresh()} />}
          </FxPanel>
        </PageItem>
      ) : (
        <>
          <PageItem>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
              <FxPanel hero title={<span className="flex items-center gap-2"><GitBranch className="size-4 text-accent" />Summary</span>} interactive={false}>
                <p className="m-0 mb-4 text-sm">{data.analysis.summary}</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Figure label="Correlated anomalies" value={data.group.anomalies.length} />
                  <Figure label="Related commands" value={data.group.relatedCommands.length} tone="info" />
                  <Figure label="Blast radius" value={data.analysis.blastRadius} tone={data.analysis.blastRadius === 'multi-node' ? 'danger' : 'warning'} />
                </div>
              </FxPanel>
              <FxPanel title={<span className="flex items-center gap-2"><Bot className="size-4 text-accent" />Heartbeat context</span>} interactive={false}>
                <p className="m-0 text-sm text-text-muted">
                  {hasConversation
                    ? 'This installation holds legacy heartbeat analyses. New fleet checks are recorded as cron logs and exposed through the Magnus API.'
                    : 'No legacy heartbeat conversation exists. Use the fleet check logs for current cron-owned status.'}
                </p>
              </FxPanel>
            </div>
          </PageItem>
          <PageItem>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_0.85fr]">
              <FxPanel title={<span className="flex items-center gap-2"><Clock3 className="size-4 text-accent" />Correlation timeline</span>} interactive={false}>
                <ol className="m-0 grid list-none grid-cols-1 gap-3 p-0">{timeline.map((item) => <TimelineEntry key={`${item.kind}-${item.id}`} item={item} current={anomalyId} />)}</ol>
              </FxPanel>
              <div className="grid content-start gap-4">
                <TextList title="Suspected triggers" icon={<Terminal className="size-4 text-accent" />} items={data.analysis.suspectedTriggers} mono />
                <TextList title="Recommended actions" icon={<Lightbulb className="size-4 text-accent" />} items={data.analysis.recommendedActions} />
                <FxPanel title={<span className="flex items-center gap-2"><Zap className="size-4 text-accent" />Auto-remediation</span>} fxTone="warning" interactive={false}>
                  <div className="grid gap-3">
                    {rules.error && !rules.data ? <ResourceError error={rules.error} title="Rules could not be loaded" onRetry={() => void rules.refresh()} /> : !rules.data ? <LoadingRows rows={2} /> : activeRules.length === 0 ? (
                      <EmptyState compact icon={<Zap className="size-4" />} title="No active remediation rules" action={<Link href="/anomalies/remediation">Create one</Link>} />
                    ) : canTrigger ? (
                      <>
                        <p className="m-0 text-sm text-text-muted">Propose a remediation rule's plan for this anomaly. Nothing runs before it is approved.</p>
                        {activeRules.map((rule) => (
                          <Button key={rule.id} className="h-auto justify-between whitespace-normal py-2 text-left" loading={triggering === rule.id} disabled={!!triggering} onClick={() => void trigger(rule)}>
                            <span className="min-w-0"><span className="font-semibold">{rule.name}</span>{rule.description ? <span className="block text-xs font-normal text-text-muted">{rule.description}</span> : null}</span>
                            <Zap className="size-4 shrink-0 text-accent" aria-hidden="true" />
                          </Button>
                        ))}
                      </>
                    ) : <p className="m-0 text-sm text-text-muted">{activeRules.length} active rule{activeRules.length === 1 ? '' : 's'}. Your role cannot trigger them.</p>}
                    {related.length > 0 ? (
                      <div className="grid gap-2">
                        <p className="m-0 text-xs font-medium text-text-muted">Executions for this anomaly</p>
                        {related.map((execution) => (
                          <div key={`${execution.id}:${execution.status}`} className={cn(sweep, 'rounded-chip border border-border bg-surface-raised px-3 py-2')}>
                            <div className="flex items-center justify-between gap-2 text-sm">
                              <span className="min-w-0 truncate font-semibold">{execution.rule?.name ?? execution.ruleId}</span>
                              <Badge tone={executionTone(execution.status)} dot={executionIsLive(execution.status)} className={executionIsLive(execution.status) ? 'fx-badge-pulse' : ''}>{execution.status.replace('_', ' ')}</Badge>
                            </div>
                            <p className="m-0 mt-1 text-xs text-text-muted">{formatTime(execution.triggeredAt)}</p>
                          </div>
                        ))}
                        <Link href="/anomalies/remediation?tab=executions" className="text-sm">Review plans and outcomes</Link>
                      </div>
                    ) : null}
                  </div>
                </FxPanel>
              </div>
            </div>
          </PageItem>
        </>
      )}
    </div>
  );
}

function TimelineEntry({ item, current }: { item: CorrelationItem; current: string }) {
  const sweep = useSweep();
  const title = item.kind === 'correlated-anomaly' && item.id !== current ? <Link href={`/anomalies/${encodeURIComponent(item.id)}`}>{item.title}</Link> : item.title;
  return (
    <li className={cn(sweep, 'rounded-panel border border-l-2 bg-surface-raised p-3', ITEM_BORDER[item.kind])}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-2 font-semibold"><HaloDot tone={DOT_TONE[item.kind]} active={item.kind === 'target-anomaly'} /><span className="min-w-0 break-words">{title}</span></span>
        <span className="num text-xs text-text-muted">{formatTime(item.timestamp)}</span>
      </div>
      <p className="m-0 mt-1 text-sm text-text-muted">{item.detail}</p>
      <p className="m-0 mt-1 text-xs text-text-muted">Node: {hasRoute(`/nodes/${encodeURIComponent(item.nodeId)}`) ? <Link href={`/nodes/${encodeURIComponent(item.nodeId)}`}>{item.nodeId}</Link> : item.nodeId}</p>
    </li>
  );
}

function TextList({ title, icon, items, mono = false }: { title: string; icon: React.ReactNode; items: readonly string[]; mono?: boolean }) {
  return (
    <FxPanel title={<span className="flex items-center gap-2">{icon}{title}</span>} interactive={false}>
      <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0">
        {items.map((item) => <li key={item} className={cn('rounded-chip border border-border bg-surface-raised px-3 py-2 text-sm text-text-muted break-words', mono && 'font-mono')}>{item}</li>)}
      </ul>
    </FxPanel>
  );
}
