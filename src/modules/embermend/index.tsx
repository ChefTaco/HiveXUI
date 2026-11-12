import { useEffect, useState } from 'react';
import { z } from 'zod';
import { recommendationSchema, findingSchema, occurrenceSchema, accessSchema, evidenceSchema, jobSchema, type Recommendation } from '@contracts/embermend.generated';
import { embermendRequest } from './api';
import { Panel, Button, Badge, PageHeader } from '../../components/ui';

const findingsSchema = z.array(z.object({ finding: findingSchema, occurrences: z.array(occurrenceSchema) }));
type FindingRow = z.infer<typeof findingsSchema>[number];
function observationMessage(job: z.infer<typeof jobSchema>): string {
  if (job.error === 'OWNER_SETTLED_ORIGINAL_OUTCOME_UNKNOWN') return 'Ownership is settled. The original outcome remains unknown.';
  if (job.error === 'CAMPAIGN_FAILED_CONFIRMED' || job.error === 'ASSESSMENT_FAILED_CONFIRMED') return 'The original operation is confirmed failed.';
  if (job.status === 'completed') return 'The original recorded outcome has been read.';
  if (['queued', 'running'].includes(job.status)) return 'Reading existing receipts; the original action is not being repeated.';
  return 'The original outcome needs review. Inspect the supporting evidence.';
}
function outcomeForScope(row: Recommendation, findings: readonly FindingRow[], dimension: 'source' | 'runtime'): 'verified' | 'not applicable' | 'outstanding' | 'unknown' | 'review required' | 'mitigated' {
  const records = row.plan.findingIds.map(id => findings.find(item => item.finding.id === id));
  if (!records.length || records.some(record => !record || !record.occurrences.length)) return 'unknown';
  const states = records.flatMap(record => record?.occurrences.map(item => dimension === 'source' ? item.sourceState : item.runtimeState) ?? []);
  if (states.every(state => state === 'not-applicable')) return 'not applicable';
  if (records.some(record => record?.finding.validity !== 'validated')) return 'review required';
  if (states.some(state => state === 'unknown')) return 'unknown';
  if (states.every(state => state === 'not-applicable' || state === (dimension === 'source' ? 'verified-fixed' : 'verified-resolved'))) return 'verified';
  if (dimension === 'runtime' && states.every(state => ['not-applicable', 'verified-mitigated', 'verified-resolved'].includes(state))) return 'mitigated';
  return 'outstanding';
}
const request = embermendRequest;
export default function EmbermendModule() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [findings, setFindings] = useState<FindingRow[]>([]);
  const [access, setAccess] = useState<z.infer<typeof accessSchema> | null>(null);
  const [evidence, setEvidence] = useState<z.infer<typeof evidenceSchema> | null>(null);
  const [observations, setObservations] = useState<Record<string, z.infer<typeof jobSchema>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false);
  async function refresh(): Promise<void> {
    setBusy(true);
    try {
      const [timeline, risks, identity, observed] = await Promise.all([request('recommendations'), request('findings'), request('access'), Promise.all(Object.entries(observations).map(async ([originalId, job]) => [originalId, jobSchema.parse(await request(`jobs/${encodeURIComponent(job.id)}`))] as const))]);
      setRecommendations(z.array(recommendationSchema).parse(timeline)); setFindings(findingsSchema.parse(risks)); setAccess(accessSchema.parse(identity)); setLoaded(true); setError(null);
      if (observed.length) setObservations(current => ({ ...current, ...Object.fromEntries(observed) }));
    } catch (error) { setError(error instanceof Error ? error.message : 'Embermend is unavailable.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    const pending = Object.entries(observations).filter(([, job]) => ['queued', 'running'].includes(job.status));
    if (!pending.length) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void Promise.all(pending.map(async ([originalId, job]) => [originalId, jobSchema.parse(await request(`jobs/${encodeURIComponent(job.id)}`, undefined, controller.signal))] as const)).then(async values => {
        if (controller.signal.aborted) return;
        setObservations(current => ({ ...current, ...Object.fromEntries(values) }));
        if (values.every(([, job]) => !['queued', 'running'].includes(job.status))) await refresh();
      }).catch(() => { if (!controller.signal.aborted) setError('The observation could not be read. Refresh to inspect its retained outcome.'); });
    }, 1500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [observations]);
  async function observe(originalId: string): Promise<void> {
    setBusy(true);
    try {
      const queued = z.object({ jobId: z.string().min(1) }).parse(await request(`jobs/${encodeURIComponent(originalId)}/reconcile`, {}));
      const job = jobSchema.parse(await request(`jobs/${encodeURIComponent(queued.jobId)}`));
      setObservations(current => ({ ...current, [originalId]: job }));
      await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : 'The original outcome could not be observed.'); setBusy(false); }
  }
  async function decide(row: Recommendation, decision: 'approve' | 'reject'): Promise<void> {
    setBusy(true);
    try { await request('decisions', { planId: row.plan.id, revision: row.plan.revision, digest: row.digest, decision, expiresAt: row.plan.expiresAt }); await refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Decision could not be recorded.'); setBusy(false); }
  }
  async function execute(row: Recommendation): Promise<void> {
    setBusy(true);
    try { await request(`plans/${encodeURIComponent(row.plan.id)}/execute`, { revision: row.plan.revision, digest: row.digest }); await refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Inspect the retained operation before requesting further work.'); setBusy(false); }
  }
  async function pause(row: Recommendation): Promise<void> {
    setBusy(true);
    try { await request(`campaigns/${encodeURIComponent(row.plan.campaignId)}/pause`, { paused: !row.campaign?.paused }); await refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Pause could not be recorded.'); setBusy(false); }
  }
  async function showEvidence(id: string): Promise<void> {
    try { setEvidence(evidenceSchema.parse(await request(`evidence/${encodeURIComponent(id)}`))); }
    catch (error) { setError(error instanceof Error ? error.message : 'Evidence is unavailable for your current access.'); }
  }
  return <>
    <PageHeader
      eyebrow="Embermend · continuous hardening"
      title="Recommendations & outcomes"
      description="Review proposed changes, follow authorized work, and inspect the evidence behind each outcome."
      actions={<Button loading={busy} onClick={() => void refresh()}>Refresh</Button>}
    />
    {error ? <p role="alert" className="warning-banner">{error}</p> : null}
    {loaded && recommendations.length === 0 ? <Panel><h3>No recommendations yet</h3><p>Assign an assessment profile and an eligible Magnus target through your coordinator. Recommendations appear here when there is security work to review.</p></Panel> : null}
    <div className="space-y-4" aria-label="Security recommendations">{recommendations.map(row => {
      const published = row.publications.some(item => item.revision === row.plan.revision && item.digest === row.digest);
      const awaiting = row.status === 'explained';
      const source = outcomeForScope(row, findings, 'source'); const runtime = outcomeForScope(row, findings, 'runtime');
      const verified = [source, runtime].every(state => state === 'verified' || state === 'not applicable') && [source, runtime].some(state => state === 'verified');
      const canRecover = access?.kind === 'operator' && access.permissions.includes('recover');
      const settledUnknown = row.executions.some(item => item.receipt?.state === 'unknown' && item.receipt.ownershipReleased && item.receipt.result['ownershipSettled'] === true);
      const ownership = !row.executions.length ? 'not reserved' : row.executions.every(item => item.receipt?.ownershipReleased) ? 'settled' : 'retained';
      return <Panel key={`${row.plan.id}:${row.plan.revision}`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">Revision {row.plan.revision} · {row.plan.scope.targetIds.length} managed {row.plan.scope.targetIds.length === 1 ? 'target' : 'targets'}</p><h3>{row.plan.objective}</h3></div><Badge tone={row.campaign?.paused ? 'warning' : row.status === 'authorized' ? 'success' : 'neutral'}>{row.campaign?.paused ? 'Paused' : awaiting ? 'Awaiting decision' : row.status === 'authorized' ? 'Authorized' : row.status}</Badge></div>
        <p className="whitespace-pre-wrap">{row.plan.explanation}</p>
        <p><strong>Service impact:</strong> {row.plan.impact}</p>
        {row.plan.uncertainty.length ? <p><strong>Uncertainty:</strong> {row.plan.uncertainty.join('; ')}</p> : null}
        <div className="flex flex-wrap gap-2 py-3" aria-label="Remediation progress"><Badge>Explained: {published ? 'published' : 'pending'}</Badge>{row.jobs.map(job => <Badge key={job.id}>Work: {job.status} · {Math.round(job.progress * 100)}%</Badge>)}<Badge>Execution: {row.executions.length ? row.executions.map(item => item.state).join(', ') : 'not dispatched'}</Badge><Badge>Ownership: {ownership}</Badge><Badge>Source outcome: {source}</Badge><Badge>Runtime outcome: {runtime}</Badge><Badge>Security outcome: {verified ? 'verified for recorded scope' : 'verification outstanding'}</Badge></div>
        {settledUnknown ? <p role="status">Ownership is settled. The original outcome remains unknown; findings require separate verification.</p> : null}
        {canRecover && access?.permissions.includes('evidence') ? row.jobs.filter(job => job.status === 'unknown').map(job => {
          const observation = observations[job.id];
          return <div key={job.id}><Button disabled={busy || Boolean(observation && ['queued', 'running'].includes(observation.status))} onClick={() => void observe(job.id)}>Read retained outcome {job.id.slice(0, 8)}</Button>{observation ? <p role="status">Observation: {observation.status} · {observationMessage(observation)}</p> : null}</div>;
        }) : null}
        {row.jobs.some(job => ['unknown', 'failed'].includes(job.status)) ? <p role="status">Work needs review. Inspect the retained job and operation evidence before requesting further changes.</p> : null}
        {awaiting && published && access?.kind === 'operator' && access.permissions.includes('approve') ? <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void decide(row, 'approve')}>Approve revision {row.plan.revision}</Button><Button disabled={busy} onClick={() => void decide(row, 'reject')}>Reject recommendation</Button></div> : null}
        {row.status === 'authorized' && !row.executions.length && !row.jobs.length && access?.permissions.includes('execute') && (!row.plan.actions.some(action => action.class === 'recovery') || canRecover) ? <Button disabled={busy || row.campaign?.paused === true} onClick={() => void execute(row)}>Start authorized work</Button> : null}
        {access?.permissions.includes('execute') ? <Button disabled={busy} onClick={() => void pause(row)}>{row.campaign?.paused ? 'Resume dispatch' : 'Pause further dispatch'}</Button> : null}
        <details className="mt-4"><summary>Actions and supporting evidence</summary>{row.jobs.map(job => <p key={job.id}>Job {job.id} · {job.status}{job.error ? ` · ${job.error}` : ''}</p>)}{row.jobs.map(job => observations[job.id]).filter(job => job !== undefined).map(job => <p key={job.id}>Observation job {job.id} · {job.status}{job.error ? ` · ${job.error}` : ''}</p>)}<ul>{row.plan.actions.map(action => <li key={action.id}>{action.version} · {action.targetId} · {row.executions.find(item => item.actionId === action.id)?.state ?? 'planned'}<p>Recovery: {action.recovery}</p></li>)}</ul><div className="flex flex-wrap gap-2">{row.plan.evidenceIds.map(id => <Button key={id} onClick={() => void showEvidence(id)}>Open evidence {id.slice(0, 12)}</Button>)}</div><p>Pausing prevents future dispatch. Already admitted operations retain their recorded state.</p></details>
      </Panel>;
    })}</div>
    {evidence ? <Panel className="mt-4"><div className="flex justify-between gap-3"><h3>Evidence · {evidence.method}</h3><Button onClick={() => setEvidence(null)}>Close evidence</Button></div><p>Observed {new Date(evidence.observedAt).toLocaleString()} · {evidence.source}</p><pre className="max-h-96 overflow-auto whitespace-pre-wrap">{JSON.stringify(evidence.content, null, 2)}</pre><p className="font-mono break-all">SHA-256 {evidence.digest}</p></Panel> : null}
    <Panel className="mt-6"><h3>Remaining security work</h3><p>Source correction, deployed correction, and accepted risk are tracked separately.</p>{loaded && findings.length === 0 ? <p>No findings are recorded. This does not establish assessment coverage.</p> : null}{findings.map(({ finding, occurrences }) => <details key={finding.id} className="py-3"><summary>{finding.title} · {finding.severity} · {finding.validity}</summary><p>{finding.rationale}</p>{occurrences.map(item => <p key={item.id}>Source: {item.sourceState} · Runtime: {item.runtimeState} · Coverage: {item.coverage.status}</p>)}</details>)}</Panel>
  </>;
}
