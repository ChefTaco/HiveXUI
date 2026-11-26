// Embermend beyond recommendations: whether assessment can run (readiness), accepted risk
// (exceptions) and the assessment profiles assigned to targets. Each panel reads its own route and
// says so when Embermend refuses it; none of them changes anything without a confirmation.
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { exceptionSchema, profileAssignmentSchema, readinessSchema, type CampaignReport, campaignReportSchema, type Finding } from '@contracts/embermend.generated';
import { Badge, Button, Field, Panel, TextArea, TextInput, useConfirm } from '../../components/ui';
import { describeApiError } from '@lib/api-error';
import { embermendRequest } from './api';

type Readiness = z.infer<typeof readinessSchema>;
type Exception = z.infer<typeof exceptionSchema>;
type Assignment = z.infer<typeof profileAssignmentSchema>;
type Scope = Exception['scope'];

/** Embermend's readiness blockers, in words. */
const BLOCKERS: Record<string, string> = {
  NO_FRESH_ENROLLED_ASSESSMENT_TARGET: 'No enrolled Magnus target in your scope reported within the last two minutes, so assessment cannot run.',
  MAGNUS_UNAVAILABLE_OR_INCOMPATIBLE: 'Magnus did not answer, or answered with capabilities Embermend does not support.',
};

/** Whether Embermend can assess and dispatch work in the caller's scope (`GET /readiness`). */
export function ReadinessPanel({ reload }: { reload: number }) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    embermendRequest('readiness')
      .then((value) => {
        if (!active) return;
        setReadiness(readinessSchema.parse(value));
        setError('');
      })
      .catch((reason: unknown) => active && setError(describeApiError(reason, 'Readiness is unavailable')));
    return () => {
      active = false;
    };
  }, [reload]);
  if (error) return <Panel title="Readiness"><p role="alert" className="m-0">{error}</p></Panel>;
  if (!readiness) return null;
  return (
    <Panel title="Readiness" eyebrow={readiness.status === 'ready' ? 'Ready' : 'Degraded'}>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Embermend readiness">
        <Badge tone={readiness.assessmentReady ? 'success' : 'warning'}>Assessment: {readiness.assessmentReady ? 'ready' : 'not ready'}</Badge>
        <Badge tone={readiness.managedDispatch ? 'success' : 'warning'}>Managed dispatch: {readiness.managedDispatch ? 'available' : 'unavailable'}</Badge>
        <Badge>Eligible targets: {readiness.eligibleTargets}</Badge>
        {readiness.capabilities ? <Badge>Embermend {readiness.capabilities.serviceVersion}</Badge> : null}
      </div>
      {readiness.blockers.map((code) => (
        <p key={code} className="mb-0">{BLOCKERS[code] ?? code}</p>
      ))}
    </Panel>
  );
}

/** End of the chosen day in UTC, as Embermend wants an exception's expiry. */
const endOfDay = (date: string): string => new Date(`${date}T23:59:59.000Z`).toISOString();
const ids = (text: string): string[] => text.split(',').map((item) => item.trim()).filter(Boolean);

/**
 * Accepted risk (`GET /exceptions`, `POST /exceptions`): which findings are accepted, by whom, why,
 * with which compensating controls and until when. Recording one needs the `exception` permission.
 */
export function ExceptionsPanel({ findings, scope, canRecord, reload }: { findings: readonly Finding[]; scope: Scope | null; canRecord: boolean; reload: number }) {
  const [exceptions, setExceptions] = useState<Exception[] | null>(null);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [owner, setOwner] = useState('');
  const [rationale, setRationale] = useState('');
  const [controls, setControls] = useState('');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmAction, confirmDialog] = useConfirm();
  const load = useCallback(async () => {
    try {
      setExceptions(z.array(exceptionSchema).parse(await embermendRequest('exceptions')));
      setError('');
    } catch (reason) {
      setError(describeApiError(reason, 'Accepted risk is unavailable'));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, reload]);

  const today = new Date().toISOString().slice(0, 10);
  const ready = scope !== null && chosen.size > 0 && owner.trim() && rationale.trim() && expires > today;
  async function record() {
    if (!ready || !scope) return;
    const accepted = findings.filter((finding) => chosen.has(finding.id));
    const confirmed = await confirmAction({
      title: 'Accept this risk',
      message: `${accepted.length} ${accepted.length === 1 ? 'finding is' : 'findings are'} recorded as accepted risk until ${expires}, owned by ${owner.trim()}: ${accepted.map((finding) => finding.title).join('; ')}. Recommendations stop treating them as outstanding until the exception expires or is withdrawn.`,
      confirmLabel: 'Record exception',
      tone: 'warning',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const body = exceptionSchema.parse({
        id: `exception-${crypto.randomUUID()}`,
        scope,
        findingIds: [...chosen],
        owner: owner.trim(),
        rationale: rationale.trim(),
        compensatingControls: ids(controls),
        expiresAt: endOfDay(expires),
        status: 'active',
      });
      await embermendRequest('exceptions', body);
      setChosen(new Set());
      setOwner('');
      setRationale('');
      setControls('');
      setExpires('');
      await load();
    } catch (reason) {
      setError(reason instanceof z.ZodError ? 'Check the owner and compensating control names: each is 1 to 200 characters.' : describeApiError(reason, 'The exception could not be recorded'));
    } finally {
      setBusy(false);
    }
  }
  const title = (id: string) => findings.find((finding) => finding.id === id)?.title ?? id;
  return (
    <Panel title="Accepted risk" eyebrow={exceptions ? `${exceptions.length} recorded` : undefined}>
      {confirmDialog}
      {error ? <p role="alert">{error}</p> : null}
      {exceptions && exceptions.length === 0 ? <p>No risk has been accepted. Findings stay outstanding until they are fixed or verified.</p> : null}
      {exceptions?.length ? (
        <ul className="check-list m-0 p-0" aria-label="Accepted risk">
          {exceptions.map((item) => (
            <li key={item.id} className="check-row">
              <div>
                <strong>
                  {item.findingIds.map(title).join('; ')} <Badge tone={item.status === 'active' ? 'warning' : 'neutral'}>{item.status}</Badge>
                </strong>
                <span>
                  Owner {item.owner} · until {new Date(item.expiresAt).toLocaleDateString()}
                  {item.compensatingControls.length ? ` · controls: ${item.compensatingControls.join(', ')}` : ''}
                </span>
                <span className="whitespace-pre-wrap">{item.rationale}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {canRecord && findings.length ? (
        <details className="mt-3">
          <summary>Accept risk for findings</summary>
          <fieldset className="grid gap-2">
            <legend className="sr-only">Findings to accept</legend>
            {findings.map((finding) => (
              <label key={finding.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={chosen.has(finding.id)}
                  onChange={(event) =>
                    setChosen((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(finding.id);
                      else next.delete(finding.id);
                      return next;
                    })
                  }
                />
                {finding.title} · {finding.severity}
              </label>
            ))}
          </fieldset>
          <div className="field-grid">
            <Field label="Owner">
              <TextInput value={owner} onChange={setOwner} maxLength={200} />
            </Field>
            <Field label="Expires on">
              <TextInput type="date" min={today} value={expires} onChange={setExpires} />
            </Field>
            <Field label="Compensating controls" hint="Comma-separated, such as firewall-rule-12">
              <TextInput value={controls} onChange={setControls} />
            </Field>
          </div>
          <Field label="Rationale">
            <TextArea value={rationale} onChange={setRationale} maxLength={4000} />
          </Field>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void record()}>
            Record exception
          </Button>
        </details>
      ) : null}
    </Panel>
  );
}

/** Which assessment profile each set of targets is assessed against (`GET /profile-assignments`). */
export function AssignmentsPanel({ reload }: { reload: number }) {
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    embermendRequest('profile-assignments')
      .then((value) => active && setAssignments(z.array(profileAssignmentSchema).parse(value)))
      .catch((reason: unknown) => active && setError(describeApiError(reason, 'Profile assignments are unavailable')));
    return () => {
      active = false;
    };
  }, [reload]);
  return (
    <Panel title="Assessment profiles">
      {error ? <p role="alert">{error}</p> : null}
      {assignments && assignments.length === 0 ? <p>No assessment profile is assigned. Your coordinator assigns profiles to targets; recommendations start after the first assessment.</p> : null}
      {assignments?.length ? (
        <ul className="check-list m-0 p-0" aria-label="Assessment profiles">
          {assignments.map((item) => (
            <li key={item.id} className="check-row">
              <div>
                <strong>
                  {item.profileId} {item.profileVersion}
                </strong>
                <span>
                  {item.targetIds.length} {item.targetIds.length === 1 ? 'target' : 'targets'}: {item.targetIds.join(', ')}
                </span>
                <span>Impact: {item.impact}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

/** Reads a campaign's report (`GET /campaigns/{id}/report`), checks it, and saves it as JSON. */
export async function downloadCampaignReport(campaignId: string, save: (report: CampaignReport, name: string) => void = saveJson): Promise<CampaignReport> {
  const report = campaignReportSchema.parse(await embermendRequest(`campaigns/${encodeURIComponent(campaignId)}/report`));
  save(report, `embermend-campaign-${campaignId.replace(/[^A-Za-z0-9._-]/g, '-')}-${report.generatedAt.slice(0, 10)}.json`);
  return report;
}

function saveJson(report: CampaignReport, name: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
