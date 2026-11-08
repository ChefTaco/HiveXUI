import { useState } from 'react';
import { Archive, Check, CircleCheckBig, Download, FileWarning, Package, X } from 'lucide-react';
import { Button, Drawer, Field, TextArea } from '@ui';
import { errorMessage } from '../../magnus/api/errors';
import { useMagnusResource } from '../../magnus/api/use-resource';
import { saveBlob } from '../../magnus/pages/agents/ardent/api';
import { LoadingRows, ResourceError } from '../../magnus/ui/resource-state';
import { idempotencyKey } from '../api/client';
import { when } from '../agents/shared';
import { createExport, decide, fetchBlob, listExports, markFinal, type DecisionKind, type Deliverable, type ExportRecord, type ReviewComment, type Revision } from './api';
import { canExport, decisionRules, STATUS } from './logic';

const DECISION: Record<DecisionKind, { title: string; confirm: string; done: string }> = {
  accepted: { title: 'Accept', confirm: 'Accept revision', done: 'Accepted.' },
  changes_requested: { title: 'Request changes', confirm: 'Request changes', done: 'Changes requested.' },
  rejected: { title: 'Reject', confirm: 'Reject revision', done: 'Rejected.' },
};

async function download(record: ExportRecord, projectName: string) {
  saveBlob(await fetchBlob(record.blob_sha256, 'application/zip'), `${projectName.replace(/[^\w.-]+/g, '-')}-${record.created_at.slice(0, 10)}.zip`);
}

/** Earlier export packages, each downloadable again. */
function ExportHistory({ projectId, projectName }: { projectId: string; projectName: string }) {
  const exports = useMagnusResource((signal) => listExports(projectId, signal), [projectId]);
  const [error, setError] = useState('');
  if (!exports.data) return exports.loading ? <LoadingRows rows={3} /> : <ResourceError error={exports.error} title="Exports could not be loaded" onRetry={() => void exports.refresh()} />;
  if (!exports.data.length) return <p className="m-0 text-sm text-text-muted">No packages exported yet.</p>;
  return (
    <ul className="review-comment-list" aria-label="Export packages">
      {exports.data.map((record) => (
        <li key={record.id} className="review-export rounded-control border border-border bg-surface-sunken p-3 text-sm">
          <span>
            {when(record.created_at)} · {record.revision_ids.length} {record.revision_ids.length === 1 ? 'file' : 'files'} · {record.created_by}
          </span>
          <Button size="sm" icon={<Download className="size-4" />} onClick={() => download(record, projectName).catch((caught: unknown) => setError(errorMessage(caught, 'The package could not be downloaded')))}>
            Download
          </Button>
        </li>
      ))}
      {error ? <li role="alert" className="text-sm text-danger">{error}</li> : null}
    </ul>
  );
}

/** Accept, Request changes, Reject, Mark final and Export package for the open revision. */
export function DecisionBar({ projectId, projectName, deliverable, deliverables, revision, comments, readOnly, onChanged }: {
  projectId: string;
  projectName: string;
  deliverable: Deliverable;
  deliverables: readonly Deliverable[];
  revision: Revision;
  comments: readonly ReviewComment[];
  readOnly: boolean;
  onChanged: () => void;
}) {
  const rules = decisionRules({ deliverable, revision, comments, readOnly });
  const exportRule = canExport(deliverables);
  const [deciding, setDeciding] = useState<DecisionKind | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'decide' | 'final' | 'export' | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null);
  const [history, setHistory] = useState(false);
  const noteRequired = deciding === 'changes_requested' && rules.changes.needsNote && !note.trim();

  async function run(kind: 'decide' | 'final' | 'export', action: () => Promise<string>, failure: string) {
    setBusy(kind);
    setMessage(null);
    try {
      setMessage({ text: await action(), tone: 'success' });
      onChanged();
    } catch (caught) {
      setMessage({ text: errorMessage(caught, failure), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  }
  const submitDecision = () =>
    deciding &&
    run(
      'decide',
      async () => {
        await decide(revision.id, { decision: deciding, note_md: note.trim() }, idempotencyKey());
        setDeciding(null);
        return `Revision ${revision.revision}: ${DECISION[deciding].done}`;
      },
      'The decision could not be recorded',
    );
  const final = () =>
    run(
      'final',
      async () => {
        await markFinal(deliverable.id, revision.id, idempotencyKey());
        return `Revision ${revision.revision} is the final ${deliverable.name}.`;
      },
      'The final revision could not be set',
    );
  const exportPackage = () =>
    run(
      'export',
      async () => {
        const record = await createExport(projectId, undefined, idempotencyKey());
        await download(record, projectName);
        return `Exported ${record.revision_ids.length} final ${record.revision_ids.length === 1 ? 'file' : 'files'} with their review records.`;
      },
      'The package could not be exported',
    );
  const open = (kind: DecisionKind) => {
    setNote('');
    setDeciding(kind);
  };

  return (
    <div className="review-decisions panel panel--sm" role="group" aria-label="Review decision">
      <div className="review-decisions__buttons">
        <Button size="sm" variant="primary" icon={<Check className="size-4" />} disabled={!rules.accept.enabled || !!busy} title={rules.accept.reason} onClick={() => open('accepted')}>
          Accept
        </Button>
        <Button size="sm" variant="warning" icon={<FileWarning className="size-4" />} disabled={!rules.changes.enabled || !!busy} title={rules.changes.reason} onClick={() => open('changes_requested')}>
          Request changes
        </Button>
        <Button size="sm" variant="danger" icon={<X className="size-4" />} disabled={!rules.reject.enabled || !!busy} title={rules.reject.reason} onClick={() => open('rejected')}>
          Reject
        </Button>
        <Button size="sm" icon={<CircleCheckBig className="size-4" />} loading={busy === 'final'} disabled={!rules.final.enabled || !!busy} title={rules.final.reason} onClick={() => void final()}>
          {rules.final.isFinal ? 'Final ✓' : 'Mark final'}
        </Button>
        <span className="review-decisions__spacer" />
        <Button size="sm" icon={<Package className="size-4" />} loading={busy === 'export'} disabled={!exportRule.enabled || !!busy} title={exportRule.reason} onClick={() => void exportPackage()}>
          Export package
        </Button>
        <Button size="sm" variant="ghost" icon={<Archive className="size-4" />} onClick={() => setHistory(true)}>
          Exports
        </Button>
      </div>
      <p className="m-0 text-xs text-text-muted">
        Revision {revision.revision} is <strong>{STATUS[revision.review_status].label.toLowerCase()}</strong>
        {rules.final.isFinal ? ' and final' : ''}
        {!rules.final.enabled && !rules.final.isFinal && rules.final.reason ? ` · ${rules.final.reason}` : ''}
        {!exportRule.enabled ? ` · Export: ${exportRule.reason}` : ''}
      </p>
      {message ? (
        <p role={message.tone === 'danger' ? 'alert' : 'status'} className={`m-0 text-sm ${message.tone === 'danger' ? 'text-danger' : 'text-success'}`}>
          {message.text}
        </p>
      ) : null}
      <Drawer
        open={deciding !== null}
        title={deciding ? DECISION[deciding].title : ''}
        eyebrow={`${deliverable.name} · revision ${revision.revision}`}
        onClose={() => setDeciding(null)}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeciding(null)}>
              Cancel
            </Button>
            <Button variant={deciding === 'rejected' ? 'danger' : deciding === 'changes_requested' ? 'warning' : 'primary'} loading={busy === 'decide'} disabled={noteRequired} onClick={() => void submitDecision()}>
              {deciding ? DECISION[deciding].confirm : ''}
            </Button>
          </div>
        }
      >
        <div className="grid gap-3">
          <Field label="Note" hint={deciding === 'changes_requested' && rules.changes.needsNote ? 'Required: there are no open comments saying what to change.' : 'Optional. Kept with the decision and in the export.'}>
            <TextArea value={note} onChange={setNote} maxLength={20_000} className="review-composer__input" />
          </Field>
          {deciding === 'changes_requested' ? <p className="m-0 text-sm text-text-muted">To send the work back to its producer, use Request revision in Comments.</p> : null}
        </div>
      </Drawer>
      <Drawer open={history} title="Export packages" eyebrow={projectName} onClose={() => setHistory(false)}>
        <ExportHistory projectId={projectId} projectName={projectName} />
      </Drawer>
    </div>
  );
}
