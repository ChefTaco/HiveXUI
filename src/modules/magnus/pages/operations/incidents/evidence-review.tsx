import { useState, type FormEvent } from 'react';
import { BookCheck, Download, Search } from 'lucide-react';
import { incidentEvidenceResponseSchema, lessonSuggestionsResponseSchema, publishLessonResponseSchema } from '@contracts/magnus/browser';
import { Button, Field, Select, TextArea, TextInput } from '@ui';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { FxPanel } from '../../../effects';
import { downloadText, FormError } from '../shared/parts';
import { lessonExpiry } from './incident-model';

const RUNBOOKS = ['diagnostics.v1', 'restart-service.v1'].map((value) => ({ value, label: value }));

/** For ADMIN and OPERATOR, whom the routes allow. Reviewed lessons never execute anything. */
export function EvidenceReview() {
  const [incidentId, setIncidentId] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [symptom, setSymptom] = useState('');
  const [cause, setCause] = useState('');
  const [evidenceId, setEvidenceId] = useState('');
  const [runbook, setRunbook] = useState('diagnostics.v1');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState<'evidence' | 'publish' | 'lessons' | null>(null);

  async function run(kind: 'evidence' | 'publish' | 'lessons', action: () => Promise<void>) {
    setBusy(kind);
    setError('');
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }
  const downloadEvidence = () =>
    run('evidence', async () => {
      const { data } = await magnus.get(`/ops/incidents/${segment(incidentId)}/evidence`, incidentEvidenceResponseSchema);
      setOutput(data.markdown);
      downloadText(data.markdown, 'magnus-incident-evidence.md', 'text/markdown');
    });
  const publish = (event: FormEvent) => {
    event.preventDefault();
    void run('publish', async () => {
      const { data } = await magnus.post('/ops/lessons', publishLessonResponseSchema, {
        body: { incidentId, symptom, cause, runbookVersion: runbook, evidenceIds: [evidenceId], expiresAt: lessonExpiry(), reviewed: true },
      });
      setOutput(JSON.stringify(data, null, 2));
    });
  };
  const findLessons = () =>
    run('lessons', async () => {
      const { data } = await magnus.get('/ops/lessons', lessonSuggestionsResponseSchema, { query: { query: symptom || 'worker' } });
      setOutput(JSON.stringify(data, null, 2));
    });

  return (
    <FxPanel title="Export evidence or review an incident lesson" description="Enter the anomaly ID from the anomaly ledger. Reviewed lessons need a completed runbook execution; they never execute actions." interactive={false}>
      <div className="grid gap-4">
        <FormError message={error} />
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[min(100%,16rem)] flex-1"><Field label="Incident ID"><TextInput placeholder="Anomaly ID" value={incidentId} onChange={setIncidentId} /></Field></div>
          <Button icon={<Download className="size-4" />} loading={busy === 'evidence'} disabled={!incidentId || busy !== null} onClick={() => void downloadEvidence()}>Download evidence packet</Button>
          <Button icon={<Search className="size-4" />} loading={busy === 'lessons'} disabled={busy !== null} onClick={() => void findLessons()}>Find current lessons matching the symptom</Button>
        </div>
        <details className="rounded-control border border-border p-3">
          <summary className="cursor-pointer text-sm font-semibold">Review and publish a lesson</summary>
          <form className="mt-3 grid gap-3" onSubmit={publish}>
            <Field label="Reviewed symptom"><TextInput placeholder="Sanitized symptom" required minLength={5} value={symptom} onChange={setSymptom} /></Field>
            <Field label="Verified cause"><TextArea placeholder="Verified cause; exclude raw logs and private evidence" required minLength={5} rows={3} value={cause} onChange={setCause} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Successful execution ID"><TextInput placeholder="Completed runbook execution ID" required value={evidenceId} onChange={setEvidenceId} /></Field>
              <Field label="Runbook version"><Select value={runbook} onChange={setRunbook} options={RUNBOOKS} /></Field>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" required checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} className="mt-0.5" />
              I reviewed the cause and evidence, removed private content, and approve publication with a 30-day expiry.
            </label>
            <div><Button type="submit" variant="primary" icon={<BookCheck className="size-4" />} loading={busy === 'publish'} disabled={!incidentId || busy !== null}>Publish reviewed lesson</Button></div>
          </form>
        </details>
        {output ? <pre className="code-block m-0" aria-label="Result">{output}</pre> : null}
      </div>
    </FxPanel>
  );
}
