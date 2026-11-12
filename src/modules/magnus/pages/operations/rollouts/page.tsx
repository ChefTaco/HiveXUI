import { useState } from 'react';
import { Octagon, Pause, Play, RefreshCw, Rocket } from 'lucide-react';
import { rolloutActionResponseSchema, rolloutDetailResponseSchema, rolloutListResponseSchema } from '@contracts/magnus/browser';
import type { z } from 'zod';
import { Badge, ConfirmDialog, EmptyState, IconButton, JsonBlock, PageHeader, statusTone, TableFrame, LoadingRows, ResourceError } from '@ui';
import { formatTime } from '@lib/format';
import { cn } from '@lib/cn';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { FxMeter, FxPanel, PageItem } from '../../../effects';
import { ADMIN_ONLY, useMagnusSession, WRITE_ROLES } from '../../../session';
import { FormError } from '../shared/parts';
import { abortMessage, canAbort, canPause, canResume, convergencePercent, convergenceTone, statusColor } from './rollout-model';

type Run = z.output<typeof rolloutListResponseSchema>['data'][number];
type Detail = z.output<typeof rolloutDetailResponseSchema>['data'];
const POLL_MS = 5000;

export default function RolloutsPage() {
  const { can } = useMagnusSession();
  const canControl = can(WRITE_ROLES);
  const canStop = can(ADMIN_ONLY);
  const runs = useMagnusResource((signal) => magnus.get('/rollouts', rolloutListResponseSchema, { signal }), [], { pollMs: POLL_MS });
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState('');
  const [aborting, setAborting] = useState<Run | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const list = runs.data?.data;

  async function control(run: Run, action: 'pause' | 'resume' | 'abort') {
    setBusy(run.id);
    setFailure('');
    try {
      await magnus.post(`/rollouts/${segment(run.id)}/${action}`, rolloutActionResponseSchema);
      await runs.refresh();
    } catch (error) {
      setFailure(errorMessage(error, 'Control request failed'));
    } finally {
      setBusy(null);
      setAborting(null);
    }
  }
  async function showDetail(id: string) {
    setFailure('');
    try {
      const { data } = await magnus.get(`/rollouts/${segment(id)}`, rolloutDetailResponseSchema);
      setDetail(data);
    } catch (error) {
      setFailure(errorMessage(error, 'Target evidence unavailable'));
    }
  }
  const shownFailure = failure || (runs.error && list ? errorMessage(runs.error) : '');
  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader
          title="Guided rollout workspace"
          eyebrow="Preflight → canary → waves → convergence"
          icon={<Rocket className="size-5" />}
          description="Durable rollout IDs, explicit canaries, health gates and operator controls in one ledger."
          actions={<IconButton label="Refresh rollouts" variant="default" icon={<RefreshCw className={cn('size-4', runs.refreshing && 'animate-spin')} />} onClick={() => void runs.refresh()} />}
        />
      </PageItem>
      {shownFailure ? <PageItem><FormError message={`${shownFailure} · Correlation details are available in Control API logs.`} /></PageItem> : null}
      <PageItem>
        <FxPanel padding={list && list.length > 0 ? 'none' : 'md'} interactive={false}>
          {!list ? (
            runs.loading ? <LoadingRows rows={5} /> : <ResourceError error={runs.error} title="Rollout data unavailable" onRetry={() => void runs.refresh()} />
          ) : list.length === 0 ? (
            <EmptyState icon={<Rocket className="size-5" />} title="No rollout evidence yet" message="Create rollouts through the existing deployment workflow; they will appear here with live convergence state." />
          ) : (
            <TableFrame label="Rollouts" className="max-h-[70vh]">
              <table>
                <thead>
                  <tr>
                    <th>Release / artifact</th><th>Strategy</th><th>Status</th><th>Convergence</th>
                    {canControl ? <th>Controls</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {list.map((run) => (
                    <tr key={`${run.id}-${run.status}`} className="fx-rail scan-sweep">
                      <td>
                        <button type="button" className="cursor-pointer font-mono font-semibold text-accent underline" onClick={() => void showDetail(run.id)}>{run.id}</button>
                        <div className="text-xs text-text-muted">{run.type} · {run.createdBy}</div>
                      </td>
                      <td className="whitespace-nowrap">{run.rolloutStrategy}</td>
                      <td><Badge tone={statusColor(run.status)} dot className={run.status === 'running' ? 'fx-badge-pulse' : ''}>{run.status}</Badge></td>
                      <td className="min-w-[14rem]">
                        <FxMeter value={convergencePercent(run)} tone={convergenceTone(run)} glow={run.failedNodes > 0 || run.status === 'running'} label={`Convergence of ${run.id}`} />
                        <div className="num mt-1 text-xs text-text-muted">{run.completedNodes} passed · {run.failedNodes} failed · {run.totalNodes} total</div>
                      </td>
                      {canControl ? (
                        <td>
                          <div className="flex gap-1">
                            <IconButton label={`Pause ${run.id}`} variant="default" icon={<Pause className="size-4" />} disabled={busy === run.id || !canPause(run.status)} onClick={() => void control(run, 'pause')} />
                            <IconButton label={`Resume ${run.id}`} variant="default" icon={<Play className="size-4" />} disabled={busy === run.id || !canResume(run.status)} onClick={() => void control(run, 'resume')} />
                            {canStop ? <IconButton label={`Abort ${run.id}`} variant="danger" icon={<Octagon className="size-4" />} disabled={busy === run.id || !canAbort(run.status)} onClick={() => setAborting(run)} /> : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          )}
        </FxPanel>
      </PageItem>
      {detail ? (
        <PageItem>
          <FxPanel title="Target convergence evidence" eyebrow={detail.id} actions={<Badge tone={statusColor(detail.status)}>{detail.status}</Badge>} interactive={false}>
            <div className="grid gap-3">
              {detail.targets.length > 0 ? (
                <TableFrame label="Rollout targets">
                  <table>
                    <thead><tr><th>Host</th><th>Status</th><th>Started</th><th>Completed</th><th>Error</th></tr></thead>
                    <tbody>
                      {detail.targets.map((target) => (
                        <tr key={`${target.id}-${target.status}`} className="fx-rail">
                          <td className="whitespace-nowrap">{target.hostname}</td>
                          <td><Badge tone={statusTone(target.status)}>{target.status}</Badge></td>
                          <td className="num whitespace-nowrap text-text-muted">{formatTime(target.startedAt)}</td>
                          <td className="num whitespace-nowrap text-text-muted">{formatTime(target.completedAt)}</td>
                          <td className="break-words text-danger">{target.error ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableFrame>
              ) : <p className="m-0 text-sm text-text-muted">This rollout has no targets.</p>}
              <JsonBlock value={{ id: detail.id, status: detail.status, targets: detail.targets }} />
            </div>
          </FxPanel>
        </PageItem>
      ) : null}
      <ConfirmDialog
        open={!!aborting}
        title="Abort rollout"
        message={aborting ? abortMessage(aborting.id) : ''}
        confirmLabel="Abort rollout"
        loading={aborting !== null && busy === aborting.id}
        onConfirm={() => { if (aborting) void control(aborting, 'abort'); }}
        onCancel={() => setAborting(null)}
      />
    </div>
  );
}
