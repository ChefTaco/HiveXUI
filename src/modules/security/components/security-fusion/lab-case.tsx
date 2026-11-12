import { useState, type FormEvent } from 'react';
import { linkTo, navigateTo } from '../../../../lib/routes';
import { useSecurityRefresh } from '@security/lib/page-data';
import { labAssessmentSchema, type LabAssessment, type LabComparison, type LabRun } from '@security/contracts/index';
import { Meter, Panel, TableFrame, Button } from '@ui';
import { labPost, labButton } from './lab-home';

const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`;
export function LabCase({run, comparison}: {run: LabRun; comparison: LabComparison | null}) {
  const refresh = useSecurityRefresh();
  const last = run.checkpoints.at(-1)?.assessment;
  const [summary, setSummary] = useState(''), [hypotheses, setHypotheses] = useState(''), [checks, setChecks] = useState('');
  const [confidence, setConfidence] = useState(last?.compromiseConfidence ?? 50), [rationale, setRationale] = useState('');
  const [assertions, setAssertions] = useState<LabAssessment['assertions']>(last?.assertions ?? []);
  const [containment, setContainment] = useState<LabAssessment['containment']>({kind: 'none', targetId: '', evidenceIds: [], rationale: 'Continue investigation before containment.'});
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  async function action(fn: () => Promise<unknown>, success: string) {
    setBusy(true); setMessage('');
    try { await fn(); setMessage(success); refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Request failed'); }
    finally { setBusy(false); }
  }
  function claim(id: LabAssessment['assertions'][number]['claimId'], patch: Partial<LabAssessment['assertions'][number]>) {
    setAssertions(items => [...items.filter(x => x.claimId !== id), {claimId: id, disposition: 'hypothesis', evidenceIds: [], ...items.find(x => x.claimId === id), ...patch}]);
  }
  function citations(selected: string[], update: (value: string[]) => void, label: string) {
    return <fieldset className="mt-2 grid gap-2"><legend>{label}</legend>{run.events.map((event, index) => <label key={event.id} className="check-field"><input type="checkbox" checked={selected.includes(event.id)} onChange={e => update(e.target.checked ? [...selected, event.id] : selected.filter(id => id !== event.id))} /><span>E{index + 1} · {event.summary}</span></label>)}</fieldset>;
  }
  function save(event: FormEvent) {
    event.preventDefault();
    const parsed = labAssessmentSchema.safeParse({runId: run.id, stage: run.stage, previousRevision: run.latestRevision, evidenceSha256: run.evidenceSha256, compromiseConfidence: confidence, confidenceRationale: rationale.trim(), assertions, containment});
    if (!parsed.success) { setMessage(parsed.error.issues.map(x => x.message).join('; ')); return; }
    void action(() => labPost(`cases/${encodeURIComponent(run.caseId)}/investigations`, {
      summary: summary.trim(), hypotheses: hypotheses.split('\n').map(x => x.trim()).filter(Boolean), prioritizedChecks: checks.split('\n').map(x => x.trim()).filter(Boolean), evidenceSteps: [],
      proposedActions: containment.kind === 'none' ? [] : [{kind: containment.kind, description: containment.rationale, risk: 'high', reversible: containment.kind === 'host_isolation', requiresApproval: true, executable: false}], lab: parsed.data,
    }), 'Revision saved.');
  }
  const savedForStage = run.checkpoints.some(x => x.stage === run.stage && x.evidenceSha256 === run.evidenceSha256);
  return <section className="page-stack gap-4" aria-label="Investigation lab">
    <Panel eyebrow={`Disposable lab · ${run.status}`} title={run.stageTitle}>
      <ol aria-label="Evidence releases" className="grid grid-cols-3 gap-2">{[1, 2, 3].map(stage => <li key={stage} aria-current={stage === run.stage ? 'step' : undefined} className={`border-t-2 pt-2 text-sm ${stage <= run.stage ? 'border-accent text-accent' : 'border-border text-text-muted'}`}><span className="block font-semibold">0{stage}</span>{stage < run.stage ? 'Revealed' : stage === run.stage ? 'Current evidence' : 'Evidence sealed'}</li>)}</ol>
      <p className="warning-banner">Containment is simulated. No host or account will be changed.</p>
    </Panel>
    <Panel title="Released evidence">{run.events.map((event, i) => <article key={event.id} className="border-l-2 border-border-strong pl-3 text-sm"><p className="text-text"><strong className="text-accent">E{i + 1}</strong> · {event.summary}</p><p className="text-xs text-text-muted">{new Date(event.observedAt).toISOString()}</p><details className="mt-1"><summary>Observation details</summary><pre className="code-block mt-2">{JSON.stringify(event.attributes, null, 2)}</pre></details></article>)}</Panel>
    {run.checkpoints.length > 0 && <Panel title="Confidence history"><p className="text-sm text-text-muted">Investigator belief that the account is compromised; separate from correlation confidence.</p><ol className="space-y-4">{run.checkpoints.map((row, index) => <li key={row.investigationId} className="text-sm"><div className="flex justify-between gap-2"><span>Revision {row.revision} · stage {row.stage}</span><strong className="text-accent">{row.assessment.compromiseConfidence}% <span className="text-text-muted">{index > 0 ? `(${signed(row.assessment.compromiseConfidence - run.checkpoints[index - 1]!.assessment.compromiseConfidence)} points)` : ''}</span></strong></div><Meter className="my-2" value={row.assessment.compromiseConfidence} label={`Revision ${row.revision} compromise confidence`} /><p className="whitespace-pre-wrap text-text-muted">{row.assessment.confidenceRationale}</p></li>)}</ol></Panel>}
    {run.status === 'active' && <Panel as="form" onSubmit={save} title={`Revision ${run.latestRevision + 1} · what do you believe now?`}>
      <label className="field">Hypotheses <span className="field-hint">One per line</span><textarea rows={2} maxLength={4000} value={hypotheses} onChange={e => setHypotheses(e.target.value)} /></label>
      <label className="field">Confidence of account compromise: {confidence}%<input type="range" min="0" max="100" step="1" value={confidence} onChange={e => setConfidence(Number(e.target.value))} /></label>
      <label className="field">Why this confidence? What changed?<textarea required rows={3} maxLength={2000} value={rationale} onChange={e => setRationale(e.target.value)} /></label>
      <fieldset className="grid gap-3"><legend className="mb-2">Structured claims · scored against cited evidence</legend>{run.claims.map(item => {
        const selected = assertions.find(x => x.claimId === item.id);
        return <div key={item.id} className="stack-item block"><label className="field">{item.label}<select value={selected?.disposition ?? ''} onChange={e => { if (!e.target.value) setAssertions(items => items.filter(x => x.claimId !== item.id)); else claim(item.id, {disposition: e.target.value as 'asserted' | 'hypothesis' | 'retracted'}); }}><option value="">No claim</option><option value="hypothesis">Tentative hypothesis</option><option value="asserted">Assert as established</option><option value="retracted">Retract earlier claim</option></select></label>{selected && citations(selected.evidenceIds, ids => claim(item.id, {evidenceIds: ids}), 'Evidence for this claim')}</div>;
      })}</fieldset>
      <label className="field">Prioritized next checks <span className="field-hint">One per line</span><textarea rows={2} maxLength={4000} value={checks} onChange={e => setChecks(e.target.value)} /></label>
      <fieldset className="grid gap-3 rounded-control border border-warning p-3"><legend className="px-1 text-warning">Containment choice · simulation only</legend>
        <label className="field">Recommendation<select value={containment.kind} onChange={e => setContainment({...containment, kind: e.target.value as LabAssessment['containment']['kind']})}><option value="none">Defer containment</option><option value="host_isolation">Request temporary host isolation</option><option value="credential_rotation">Request account credential rotation</option></select></label>
        {containment.kind !== 'none' && <><label className="field">Target<select required value={containment.targetId} onChange={e => setContainment({...containment, targetId: e.target.value})}><option value="">Choose affected entity</option>{run.targets.map(target => <option key={target.id} value={target.id}>{target.type} · {target.label}</option>)}</select></label>{citations(containment.evidenceIds, ids => setContainment({...containment, evidenceIds: ids}), 'Evidence supporting containment')}</>}
        <label className="field">Containment rationale<textarea required rows={2} maxLength={1200} value={containment.rationale} onChange={e => setContainment({...containment, rationale: e.target.value})} /></label>
      </fieldset>
      <label className="field">Freeform reasoning · unscored<textarea required rows={3} maxLength={4000} value={summary} onChange={e => setSummary(e.target.value)} /></label>
      <button type="submit" className={`${labButton} justify-self-start`} disabled={busy}>Save investigation revision</button>
    </Panel>}
    {run.simulations.length > 0 && <Panel title="Simulated containment review" tone="warning">{run.simulations.map(sim => <article key={sim.id} className="stack-item block space-y-3 text-sm"><p>Revision {sim.plan.revision} · {sim.status.replaceAll('_', ' ')}</p><p>{sim.plan.containment.kind.replaceAll('_', ' ')} · {run.targets.find(x => x.id === sim.plan.containment.targetId)?.label ?? sim.plan.containment.targetId}</p><p>{sim.plan.containment.rationale}</p><details><summary>Exact simulated plan</summary><pre className="code-block mt-2">{JSON.stringify(sim.plan, null, 2)}{'\n'}SHA-256 {sim.planSha256}</pre></details>{sim.status === 'pending' && (run.canAdmin ? <><label className="check-field"><input type="checkbox" checked={reviewed[sim.id] ?? false} onChange={e => setReviewed({...reviewed, [sim.id]: e.target.checked})} />I reviewed the exact target, effect, evidence and expiry. This decision is simulated.</label><div className="inline-actions">{(['approve', 'reject'] as const).map(decision => <button key={decision} type="button" className={decision === 'approve' ? labButton : 'btn'} disabled={busy || !reviewed[sim.id]} onClick={() => void action(() => labPost(`lab/runs/${run.id}/simulations/${sim.id}/decision`, {decision, confirmed: true, planSha256: sim.planSha256}), 'Simulated decision recorded. No action executed.')}>{decision === 'approve' ? 'Approve simulation' : 'Reject simulation'}</button>)}</div></> : <p className="text-warning">An administrator must review this simulated request.</p>)}</article>)}</Panel>}
    {run.status === 'active' && <Panel><p className="text-text-muted">{savedForStage ? 'Current evidence has a saved revision. You can revise again or continue.' : 'Save a revision for the current evidence to continue.'}</p><button className={`${labButton} justify-self-start`} disabled={busy || !savedForStage} onClick={() => void action(() => labPost(`lab/runs/${run.id}/${run.stage === 3 ? 'complete' : 'advance'}`, {stage: run.stage, evidenceSha256: run.evidenceSha256}), run.stage === 3 ? 'Investigation complete.' : 'Next evidence revealed.')}>{run.stage === 3 ? 'Complete and compare' : 'Reveal next evidence'}</button></Panel>}
    {comparison && <Panel title={`Revision comparison · rubric v${comparison.rubricVersion}`}><p className="text-text-muted">Each revision is assessed against evidence available at the time. Freeform reasoning and confidence percentages are not graded.</p><p className="text-sm text-text-muted sm:hidden">Scroll across to compare all columns.</p><TableFrame label="Scrollable revision comparison"><table><caption className="sr-only">Unsupported claims and unnecessary containment across revisions</caption><thead><tr>{['Revision / stage', 'Asserted', 'Unsupported', 'Supported coverage', 'Unnecessary containment'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{comparison.checkpoints.map(row => <tr key={row.revision}><td>{row.revision} / {row.stage}</td><td>{row.evaluation!.assertedCount}</td><td>{row.evaluation!.unsupportedClaims.length} ({signed(comparison.deltas.find(x => x.revision === row.revision)!.unsupportedClaims)})</td><td>{row.evaluation!.coverage.supported}/{row.evaluation!.coverage.available}</td><td>{row.evaluation!.containment.unnecessary ? 'Yes' : 'No'}</td></tr>)}</tbody></table></TableFrame>{comparison.checkpoints.map(row => <details key={row.revision}><summary>Revision {row.revision}: assessment reasons</summary><div className="mt-2 space-y-2 text-sm text-text-muted"><p>{row.evaluation!.tentativeCount} tentative hypotheses · {row.evaluation!.retractedCount} retractions</p>{row.evaluation!.unsupportedClaims.map(claim => <p key={claim.claimId}>{run.claims.find(x => x.id === claim.claimId)?.label}: {claim.reason}</p>)}<p>{row.evaluation!.containment.reason}</p></div></details>)}<ul className="list-disc space-y-2 pl-4 text-sm text-text-muted">{comparison.teachingNotes.map(note => <li key={note}>{note}</li>)}</ul></Panel>}
    {run.canAdmin && <Button className="justify-self-start" disabled={busy} onClick={() => void action(async () => {const next = await labPost(`lab/runs/${run.id}/restart`); navigateTo(linkTo('cindertrace', 'case', { caseId: String(next.caseId) }));}, 'New investigation started.')}>Start fresh run · retain this history</Button>}
    {message && <p role="status" aria-live="polite" className="info-banner">{message}</p>}
  </section>;
}
