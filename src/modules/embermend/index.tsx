import { useEffect, useState } from 'react';
import { z } from 'zod';
import { recommendationSchema, findingSchema, occurrenceSchema, accessSchema, evidenceSchema, type Recommendation } from '@contracts/embermend.generated';
import { apiFetch } from '../../lib/transport';
import { Panel, Button, Badge } from '../../components/ui';

const findingsSchema = z.array(z.object({ finding: findingSchema, occurrences: z.array(occurrenceSchema) }));
type FindingRow = z.infer<typeof findingsSchema>[number];
function verifiedForScope(row: Recommendation, findings: readonly FindingRow[]): boolean {
  return row.plan.findingIds.every(id => {
    const record = findings.find(item => item.finding.id === id);
    return record !== undefined && record.occurrences.length > 0 && record.occurrences.every(item => item.runtimeState === 'verified-resolved' || item.runtimeState === 'not-applicable' && item.sourceState === 'verified-fixed');
  });
}
async function request(path: string, body?: unknown): Promise<unknown> {
  const response = await apiFetch('/api/embermend/api/v1/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(response.status === 403 ? 'Your current access does not allow this decision.' : response.status === 409 ? 'The recommendation or its execution conditions changed. Refresh and review the current revision.' : 'Embermend could not complete the request. Refresh to inspect the retained outcome before trying another action.');
  return response.json();
}
export default function EmbermendModule() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [findings, setFindings] = useState<FindingRow[]>([]);
  const [access, setAccess] = useState<z.infer<typeof accessSchema> | null>(null);
  const [evidence, setEvidence] = useState<z.infer<typeof evidenceSchema> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false);
  async function refresh(): Promise<void> {
    setBusy(true);
    try {
      const [timeline, risks, identity] = await Promise.all([request('recommendations'), request('findings'), request('access')]);
      setRecommendations(z.array(recommendationSchema).parse(timeline)); setFindings(findingsSchema.parse(risks)); setAccess(accessSchema.parse(identity)); setLoaded(true); setError(null);
    } catch (error) { setError(error instanceof Error ? error.message : 'Embermend is unavailable.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, []);
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
    <div className="page-head"><div><p className="eyebrow">Embermend · continuous hardening</p><h2>Recommendations & outcomes</h2><p>Review proposed changes, follow authorized work, and inspect the evidence behind each outcome.</p></div><Button loading={busy} onClick={() => void refresh()}>Refresh</Button></div>
    {error ? <p role="alert" className="warning-banner">{error}</p> : null}
    {loaded && recommendations.length === 0 ? <Panel><h3>No recommendations yet</h3><p>Assign an assessment profile and an eligible Magnus target through your coordinator. Recommendations appear here when there is security work to review.</p></Panel> : null}
    <div className="space-y-4" aria-label="Security recommendations">{recommendations.map(row => {
      const published = row.publications.some(item => item.revision === row.plan.revision && item.digest === row.digest);
      const awaiting = row.status === 'explained';
      return <Panel key={`${row.plan.id}:${row.plan.revision}`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">Revision {row.plan.revision} · {row.plan.scope.targetIds.length} managed {row.plan.scope.targetIds.length === 1 ? 'target' : 'targets'}</p><h3>{row.plan.objective}</h3></div><Badge tone={row.campaign?.paused ? 'warning' : row.status === 'authorized' ? 'success' : 'neutral'}>{row.campaign?.paused ? 'Paused' : awaiting ? 'Awaiting decision' : row.status === 'authorized' ? 'Authorized' : row.status}</Badge></div>
        <p className="whitespace-pre-wrap">{row.plan.explanation}</p>
        <p><strong>Service impact:</strong> {row.plan.impact}</p>
        {row.plan.uncertainty.length ? <p><strong>Uncertainty:</strong> {row.plan.uncertainty.join('; ')}</p> : null}
        <div className="flex flex-wrap gap-2 py-3" aria-label="Remediation progress"><Badge>Explained: {published ? 'published' : 'pending'}</Badge><Badge>Execution: {row.executions.length ? row.executions.map(item => item.state).join(', ') : 'not dispatched'}</Badge><Badge>Security outcome: {verifiedForScope(row, findings) ? 'verified for recorded scope' : 'verification outstanding'}</Badge></div>
        {awaiting && published && access?.kind === 'operator' && access.permissions.includes('approve') ? <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void decide(row, 'approve')}>Approve revision {row.plan.revision}</Button><Button disabled={busy} onClick={() => void decide(row, 'reject')}>Reject recommendation</Button></div> : null}
        {row.status === 'authorized' && !row.executions.length && access?.permissions.includes('execute') ? <Button disabled={busy || row.campaign?.paused === true} onClick={() => void execute(row)}>Start authorized work</Button> : null}
        {access?.permissions.includes('execute') ? <Button disabled={busy} onClick={() => void pause(row)}>{row.campaign?.paused ? 'Resume dispatch' : 'Pause further dispatch'}</Button> : null}
        <details className="mt-4"><summary>Actions and supporting evidence</summary><ul>{row.plan.actions.map(action => <li key={action.id}>{action.version} · {action.targetId} · {row.executions.find(item => item.actionId === action.id)?.state ?? 'planned'}<p>Recovery: {action.recovery}</p></li>)}</ul><div className="flex flex-wrap gap-2">{row.plan.evidenceIds.map(id => <Button key={id} onClick={() => void showEvidence(id)}>Open evidence {id.slice(0, 12)}</Button>)}</div><p>Pausing prevents future dispatch. Already admitted operations retain their recorded state.</p></details>
      </Panel>;
    })}</div>
    {evidence ? <Panel className="mt-4"><div className="flex justify-between gap-3"><h3>Evidence · {evidence.method}</h3><Button onClick={() => setEvidence(null)}>Close evidence</Button></div><p>Observed {new Date(evidence.observedAt).toLocaleString()} · {evidence.source}</p><pre className="max-h-96 overflow-auto whitespace-pre-wrap">{JSON.stringify(evidence.content, null, 2)}</pre><p className="font-mono break-all">SHA-256 {evidence.digest}</p></Panel> : null}
    <Panel className="mt-6"><h3>Remaining security work</h3><p>Source correction, deployed correction, and accepted risk are tracked separately.</p>{loaded && findings.length === 0 ? <p>No findings are recorded. This does not establish assessment coverage.</p> : null}{findings.map(({ finding, occurrences }) => <details key={finding.id} className="py-3"><summary>{finding.title} · {finding.severity} · {finding.validity}</summary><p>{finding.rationale}</p>{occurrences.map(item => <p key={item.id}>Source: {item.sourceState} · Runtime: {item.runtimeState} · Coverage: {item.coverage.status}</p>)}</details>)}</Panel>
  </>;
}
