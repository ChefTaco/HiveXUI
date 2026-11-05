import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2, OctagonX, RotateCcw, XCircle, ArrowUpCircle } from 'lucide-react';
import { startUpgradeResponseSchema, upgradeEligibilityResponseSchema, upgradeRunResponseSchema } from '@contracts/magnus/browser';
import { Badge, Button, Drawer, type Tone } from '@ui';
import { cn } from '@lib/cn';
import { magnus, segment } from '../../../api/client';
import { MagnusApiError } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { ADMIN_ONLY, useMagnusSession } from '../../../session';
import { failureBudget, nodeDetail, remedyText, retryCount, runHeadline, targetDescription, upgradeErrorMessage, type UpgradeEligibility, type UpgradeRun } from './agent-upgrade-view';

const RUN_POLL_MS = 5000;

const STATE_BADGE: Record<UpgradeRun['nodes'][number]['state'], { label: string; tone: Tone }> = {
  pending: { label: 'Queued', tone: 'neutral' },
  requested: { label: 'Installing', tone: 'info' },
  watching: { label: 'Watching', tone: 'info' },
  ambiguous: { label: 'Unknown', tone: 'warning' },
  confirmed: { label: 'Upgraded', tone: 'success' },
  reverted: { label: 'Reverted', tone: 'danger' },
  failed: { label: 'Failed', tone: 'danger' },
  refused: { label: 'Refused', tone: 'warning' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};

type StartAnswer = z.output<typeof startUpgradeResponseSchema>['data'];
type CheckReport = Extract<StartAnswer, { dryRun: true }>;
const isRun = (data: StartAnswer): data is UpgradeRun => !('dryRun' in data);

/**
 * Upgrade agents: every node with whether it can take the target agent version now. Nodes that cannot are
 * greyed out with the reason. One canary goes first, each agent reverts itself if the new version does not
 * report a heartbeat in time, and Check shows every node's full report before anything starts. A problem of
 * one node never stops the run. Reopening shows the last run, each node needing attention with what to do,
 * and Retry for those nodes. Reading is open to every role; only ADMIN sees what would change anything.
 */
export function AgentUpgradeDrawer({ open, onClose, onFinished }: { open: boolean; onClose: () => void; onFinished?: () => void }) {
  const { can } = useMagnusSession();
  const canRun = can(ADMIN_ONLY);
  const [eligibility, setEligibility] = useState<UpgradeEligibility | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [run, setRun] = useState<UpgradeRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<CheckReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [maxFailures, setMaxFailures] = useState('');

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setEligibility(null);
    setRun(null);
    setCheck(null);
    setError(null);
    magnus
      .get('/agents/upgrade/eligibility', upgradeEligibilityResponseSchema, { signal: controller.signal })
      .then(({ data }) => {
        setEligibility(data);
        setSelected(new Set(data.nodes.filter((node) => node.eligible).map((node) => node.nodeId)));
        setRun(data.latestRun);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(upgradeErrorMessage(cause));
      });
    return () => controller.abort();
  }, [open]);

  const running = open && run?.status === 'running';
  const runId = run?.id;
  const live = useMagnusResource((signal) => magnus.get(`/agents/upgrade/runs/${segment(runId ?? '')}`, upgradeRunResponseSchema, { signal }), [runId], { enabled: running, pollMs: RUN_POLL_MS });
  useEffect(() => {
    const next = live.data?.data;
    if (!next || next.id !== runId) return;
    setRun(next);
    if (next.status !== 'running') onFinished?.();
    // Only a new answer from the server counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.data]);
  useEffect(() => {
    if (!running || !live.error) return;
    if (live.error instanceof MagnusApiError && live.error.notFound) {
      setError(`Upgrade run ${runId} is no longer known to the server`);
      setRun(null);
    } else setError(upgradeErrorMessage(live.error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.error]);

  const eligibleCount = useMemo(() => eligibility?.nodes.filter((node) => node.eligible).length ?? 0, [eligibility]);
  const showCandidates = eligibility !== null && run?.status !== 'running';
  const canStart = canRun && eligibility?.upgradesEnabled === true;
  const retries = retryCount(run);

  async function act(action: () => Promise<UpgradeRun>) {
    setBusy(true);
    setError(null);
    try {
      setRun(await action());
    } catch (cause) {
      setError(upgradeErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  const startUpgrade = () =>
    act(async () => {
      const { data } = await magnus.post('/agents/upgrade', startUpgradeResponseSchema, {
        body: { nodeIds: [...selected], version: eligibility?.version, ...(eligibility?.prerelease ? { allowPrerelease: true } : {}), ...failureBudget(maxFailures) },
      });
      if (!isRun(data)) throw new Error('The server answered with a report, not a run. Refresh to confirm.');
      return data;
    });
  async function runCheck() {
    setChecking(true);
    setError(null);
    try {
      const { data } = await magnus.post('/agents/upgrade', startUpgradeResponseSchema, { body: { dryRun: true, version: eligibility?.version, ...(selected.size ? { nodeIds: [...selected] } : {}) } });
      if (!isRun(data)) setCheck(data);
    } catch (cause) {
      setError(upgradeErrorMessage(cause));
    } finally {
      setChecking(false);
    }
  }
  const stop = () => run && act(async () => (await magnus.post(`/agents/upgrade/runs/${segment(run.id)}/stop`, upgradeRunResponseSchema)).data);
  const retry = (acknowledgeSuspicion = false) => run && act(async () => (await magnus.post(`/agents/upgrade/runs/${segment(run.id)}/retry`, upgradeRunResponseSchema, { body: acknowledgeSuspicion ? { acknowledgeSuspicion } : {} })).data);
  const toggle = (nodeId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });

  const footer = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      {canRun && run?.status === 'running' ? <Button size="sm" variant="danger" onClick={() => void stop()} disabled={busy || Boolean(run.stopRequestedBy)} icon={<OctagonX className="size-4" />}>Stop</Button> : null}
      {retries > 0 && canStart ? <Button size="sm" onClick={() => void retry()} disabled={busy} icon={<RotateCcw className="size-4" />}>Retry {retries} node{retries === 1 ? '' : 's'}</Button> : null}
      {retries > 0 && canStart && (run?.suspectedRelease || run?.excluded?.some((node) => node.code === 'RETRY_HELD_SUSPECTED')) ? (
        <Button size="sm" variant="danger" onClick={() => void retry(true)} disabled={busy} title="Each attempt on an older agent can strand another lease. Read the agent log first." icon={<RotateCcw className="size-4" />}>Retry older agents too</Button>
      ) : null}
      {showCandidates && canRun ? <Button size="sm" onClick={() => void runCheck()} disabled={busy} loading={checking} icon={<ClipboardCheck className="size-4" />}>Check</Button> : null}
      {showCandidates && canRun ? (
        <Button size="sm" variant="primary" onClick={() => void startUpgrade()} disabled={selected.size === 0 || !eligibility?.upgradesEnabled} loading={busy} icon={<ArrowUpCircle className="size-4" />}>
          Upgrade {selected.size || eligibleCount} agent{(selected.size || eligibleCount) === 1 ? '' : 's'}
        </Button>
      ) : null}
    </div>
  );

  return (
    <Drawer open={open} title="Upgrade agents" onClose={onClose} footer={footer} {...(eligibility ? { eyebrow: `Target ${eligibility.version}` } : {})}>
      <div className="grid gap-4 text-sm">
        {eligibility ? <p className="m-0 text-text-muted">{targetDescription(eligibility)}</p> : null}
        {error ? <p role="alert" className="m-0 rounded-control border border-danger bg-danger-soft px-3 py-2 text-danger">{error}</p> : null}
        {eligibility && !eligibility.upgradesEnabled ? <p className="m-0 rounded-control border border-warning bg-warning-soft px-3 py-2 text-warning">Agent upgrades are off: {eligibility.disabledReason}</p> : null}
        {!eligibility && !error ? <p className="m-0 flex items-center gap-2 text-text-muted"><Loader2 className="size-4 animate-spin" />Checking agents…</p> : null}
        {run ? <RunReport run={run} /> : null}
        {check ? <CheckResult check={check} /> : null}
        {showCandidates ? (
          <ul className="m-0 max-h-80 list-none divide-y divide-border overflow-y-auto rounded-control border border-border p-0">
            {eligibility.nodes.map((node) => (
              <li key={node.nodeId} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2', !(node.eligible && eligibility.upgradesEnabled) && 'opacity-60')} title={node.reason ?? undefined}>
                {canRun ? <input type="checkbox" aria-label={`Upgrade ${node.name}`} checked={selected.has(node.nodeId)} disabled={!node.eligible || !eligibility.upgradesEnabled} onChange={() => toggle(node.nodeId)} /> : null}
                <span className="min-w-0 max-w-40 truncate font-medium">{node.name}</span>
                <span className="num text-xs text-text-muted">{node.version}</span>
                <span className="min-w-0 flex-[1_1_10rem] text-xs break-words text-text-muted">{node.eligible ? `→ ${eligibility.version}` : node.reason}</span>
                {node.preflight && node.preflight.status !== 'ok' ? <Badge tone={node.preflight.status === 'blocked' ? 'danger' : 'neutral'}>preflight {node.preflight.status}</Badge> : null}
              </li>
            ))}
            {eligibility.nodes.length === 0 ? <li className="px-3 py-2 text-text-muted">No nodes registered.</li> : null}
          </ul>
        ) : null}
        <p className="m-0 text-xs text-text-muted">The first agent is a canary. Each agent switches back by itself if the new version does not report a heartbeat in time. Only evidence about the release stops the run: a failure on the canary, an integrity mismatch, or too many reverts. A problem of one node is recorded and the run goes on.</p>
        {showCandidates && canRun ? (
          <label className="flex items-center gap-2 text-xs text-text-muted" title="Reverts or failed installs that stop the run after its canary. Empty: the server's setting.">
            Stop after
            <input className="w-16" inputMode="numeric" aria-label="Release failures that stop the run" value={maxFailures} onChange={(event) => setMaxFailures(event.target.value)} />
            failures
          </label>
        ) : null}
      </div>
    </Drawer>
  );
}

function RunIcon({ status }: { status: UpgradeRun['status'] }) {
  if (status === 'running') return <Loader2 className="size-4 animate-spin text-accent" />;
  if (status === 'succeeded') return <CheckCircle2 className="size-4 text-success" />;
  if (status === 'partial') return <AlertTriangle className="size-4 text-warning" />;
  if (status === 'stopped') return <OctagonX className="size-4 text-warning" />;
  return <XCircle className="size-4 text-danger" />;
}

function RunReport({ run }: { run: UpgradeRun }) {
  const canary = run.canaryNodeId ?? run.nodes[0]?.nodeId;
  return (
    <div className="grid gap-2">
      <p className="m-0 flex items-center gap-2 font-semibold">
        <RunIcon status={run.status} />
        {run.status === 'running' ? `Upgrading to ${run.version}${run.stopRequestedBy ? ' (stopping after the nodes in progress)' : ''}` : runHeadline(run)}
      </p>
      {run.status !== 'running' && run.message ? <p className="m-0 text-text-muted">{run.message}</p> : null}
      {(run.warnings ?? []).map((warning) => <p key={`${warning.nodeId}-${warning.code}`} className="m-0 text-warning">{warning.name}: {warning.detail}</p>)}
      <ul className="m-0 max-h-80 list-none divide-y divide-border overflow-y-auto rounded-control border border-border p-0">
        {run.nodes.map((node) => {
          const detail = nodeDetail(node);
          const badge = STATE_BADGE[node.state];
          return (
            <li key={`${node.nodeId}-${node.state}`} className="scan-sweep flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="min-w-0 max-w-48 truncate font-medium">{node.name}{node.nodeId === canary ? ' (canary)' : ''}</span>
              <span className="num text-xs text-text-muted">{node.from} → {run.version}</span>
              <Badge tone={badge.tone}>
                {node.state === 'requested' ? <Loader2 className="mr-1 inline size-3 animate-spin" /> : null}
                {node.state === 'reverted' ? <RotateCcw className="mr-1 inline size-3" /> : null}
                {badge.label}
              </Badge>
              {(node.attempts ?? 1) > 1 ? <span className="num text-xs text-text-muted">try {node.attempts}</span> : null}
              {detail ? <span className="min-w-0 basis-full text-xs break-words text-text-muted">{detail}</span> : null}
            </li>
          );
        })}
        {(run.excluded ?? []).map((node) => (
          <li key={`excluded-${node.nodeId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 opacity-60" title={node.reason}>
            <span className="min-w-0 max-w-48 truncate font-medium">{node.name}</span>
            <Badge>Not included</Badge>
            <span className="min-w-0 basis-full text-xs break-words text-text-muted">{node.reason}</span>
          </li>
        ))}
      </ul>
      {run.status !== 'running' && run.attention?.length ? (
        <div className="grid gap-2 rounded-control border border-warning bg-warning-soft px-3 py-2">
          <p className="m-0 font-semibold text-warning">Needs attention</p>
          <ul className="m-0 grid max-h-48 list-none gap-2 overflow-y-auto p-0">
            {run.attention.map((item) => (
              <li key={`${item.nodeId}-${item.code}`}>
                <p className="m-0 font-medium">{item.name}: <span className="num">{item.code}</span>{item.failureClass === 'release' ? ' (points at the release)' : ''}{item.unknownCode ? ' (unrecognised code)' : ''}</p>
                {item.detail ? <p className="m-0 text-text-muted">{item.detail}</p> : null}
                <p className="m-0">{item.remedy}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function CheckResult({ check }: { check: CheckReport }) {
  return (
    <div className="grid gap-2">
      <p className="m-0 font-semibold">Check: {check.eligible} ready, {check.blocked} blocked{check.release.verified ? '' : `; target not verified: ${check.release.reason ?? 'unknown'}`}</p>
      <ul className="m-0 max-h-64 list-none divide-y divide-border overflow-y-auto rounded-control border border-border p-0">
        {check.nodes.map((node) => (
          <li key={node.nodeId} className="grid gap-1 px-3 py-2">
            <p className="m-0 flex flex-wrap items-center gap-2">
              <span className="min-w-0 max-w-48 truncate font-medium">{node.name}</span>
              <Badge tone={node.eligible ? 'success' : node.preflight?.status === 'blocked' ? 'danger' : 'neutral'}>{node.eligible ? 'Ready' : node.code ?? 'Not eligible'}</Badge>
              <span className="text-xs text-text-muted">preflight {node.preflight?.status ?? 'not run'}</span>
            </p>
            {!node.eligible && node.reason ? <p className="m-0 text-text-muted">{node.reason}</p> : null}
            {!node.eligible && node.remedy ? <p className="m-0">{node.remedy}</p> : null}
            {node.preflight?.problems.filter((problem) => problem.code !== node.code).map((problem) => (
              <p key={`${problem.code}-${problem.detail}`} className="m-0 text-text-muted"><span className="num">{problem.code}</span>: {problem.detail}. {remedyText(problem.code)}</p>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
