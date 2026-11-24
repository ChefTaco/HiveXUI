// Artifact delivery in Deliverable Review: the preview badge, Download original with progress and
// resume, the import status strip and the provenance of a revision (manifest 1.1).
import { useEffect, useRef, useState } from 'react';
import { Download, FileCheck2 } from 'lucide-react';
import { selectRendition, type Rendition } from '@hivemagnus/hive-common/artifact';
import { Badge, Button } from '@ui';
import { saveBlob } from '../../magnus/pages/agents/ardent/api';
import { errorMessage } from '../../magnus/api/errors';
import { formatBytes } from '../projects/logic';
import { projectHref } from '../routes';
import { StudioLink } from '../link';
import { DigestMismatchError, downloadOriginal, MAX_RESUMES, type ArtifactImport, type Deliverable, type DownloadProgress, type Revision } from './api';
import { shortMime } from './logic';

/** Media types a renderer here shows inline. */
const DISPLAYABLE = ['image/*', 'text/*', 'application/pdf', 'application/json'];

/**
 * The form of a revision to show inline: its preview when Studio received one that suits (HiveCommon
 * selectRendition, keeping transparency for a PNG), else the original. `preview` is the rendition only
 * when it is not the original itself.
 */
export function displayRendition(revision: Revision): { preview: Rendition | null } {
  // HiveCommon's Rendition leaves out the optional fields a rendition does not have.
  const roles: ReadonlySet<string> = new Set(['original', 'preview', 'model_input']);
  const renditions: Rendition[] = (revision.renditions ?? []).filter((item) => roles.has(item.role)).map(({ width, height, has_alpha, purpose: _purpose, role, ...rest }) => ({
    ...rest,
    role: role as Rendition['role'],
    ...(typeof width === 'number' ? { width } : {}),
    ...(typeof height === 'number' ? { height } : {}),
    ...(typeof has_alpha === 'boolean' ? { has_alpha } : {}),
  }));
  if (!renditions.length) return { preview: null };
  const chosen = selectRendition(renditions, { purpose: 'display', acceptMime: DISPLAYABLE, needsAlpha: revision.mime.split(';', 1)[0]!.trim().toLowerCase() === 'image/png' });
  return { preview: chosen && chosen.role !== 'original' && chosen.sha256 !== revision.blob_sha256 ? chosen : null };
}

/** "Preview · original 18.4 MB PNG". */
export const previewLabel = (revision: Revision): string => `Preview · original ${formatBytes(revision.size)} ${shortMime(revision.mime).toUpperCase()}`;

export function RenditionBadge({ revision }: { revision: Revision }) {
  return (
    <Badge tone="info" className="review-rendition">
      {previewLabel(revision)}
    </Badge>
  );
}

const phaseText = (progress: DownloadProgress): string => {
  if (progress.phase === 'verifying') return 'Checking the SHA-256…';
  const amount = progress.total ? `${formatBytes(progress.received)} of ${formatBytes(progress.total)}` : formatBytes(progress.received);
  if (progress.phase === 'resuming') return `Connection dropped at ${formatBytes(progress.received)}; resuming (${progress.resumes} of ${MAX_RESUMES})…`;
  return progress.resumes ? `${amount} · resumed ${progress.resumes} ${progress.resumes === 1 ? 'time' : 'times'}` : amount;
};

/**
 * Download original: the full-quality bytes, streamed with a progress bar, resumed after a dropped
 * connection, and saved only once they match the revision's SHA-256.
 */
export function DownloadOriginal({ revision, name, label = 'Download original', download = downloadOriginal, save = saveBlob }: { revision: Revision; name: string; label?: string; download?: typeof downloadOriginal; save?: typeof saveBlob }) {
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function start() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setError(null);
    setSaved(false);
    setProgress({ received: 0, total: revision.size, resumes: 0, phase: 'downloading' });
    try {
      const blob = await download(revision.blob_sha256, { mime: revision.mime, size: revision.size, signal: current.signal, onProgress: (next) => !current.signal.aborted && setProgress(next) });
      if (current.signal.aborted) return;
      save(blob, name);
      setSaved(true);
    } catch (failure) {
      if (current.signal.aborted) return;
      setError(failure instanceof DigestMismatchError ? failure.message : errorMessage(failure, 'The original could not be downloaded'));
    } finally {
      if (!current.signal.aborted) setProgress(null);
    }
  }
  const busy = progress !== null;
  return (
    <div className="review-download grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={<Download className="size-4" />} loading={busy} onClick={() => void start()}>
          {label}
        </Button>
        {busy ? (
          <Button size="sm" variant="ghost" onClick={() => {
              controller.current?.abort();
              setProgress(null);
            }} aria-label={`Stop downloading ${name}`}>
            Stop
          </Button>
        ) : null}
      </div>
      {progress ? (
        <div className="grid gap-1" role="status">
          <progress className="review-download__bar" max={progress.total ?? undefined} value={progress.total ? Math.min(progress.received, progress.total) : undefined} aria-label={`Downloading ${name}`} />
          <span className="text-xs text-text-muted">{phaseText(progress)}</span>
        </div>
      ) : null}
      {saved ? (
        <p className="m-0 text-xs text-success" role="status">
          <FileCheck2 className="mr-1 inline size-3" aria-hidden="true" />
          Saved; the SHA-256 matches.
        </p>
      ) : null}
      {error ? (
        <p className="m-0 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** How an import that did not complete reads: a compatibility outcome names what to upgrade. */
export function importFailure(item: ArtifactImport): string {
  const code = item.error_code ?? (item.error && /TRANSFER_REQUIRES_V2/.test(item.error) ? 'TRANSFER_REQUIRES_V2' : undefined);
  if (code === 'TRANSFER_REQUIRES_V2') return 'Not received: the agent cannot send a file this large. Its Ardent needs artifact transfer v2 (Ardent 3.2.0 or later) for files over 2 MiB.';
  if (code === 'DIGEST_MISMATCH') return 'Not received: the bytes did not match their recorded digest.';
  if (code === 'TRANSFER_TOO_LARGE' || code === 'TOO_LARGE') return 'Not received: the file is larger than Studio or the agent accepts.';
  if (code === 'TRANSFER_SOURCE_GONE') return 'Not received: the agent no longer offers this file.';
  if (code === 'MAGNUS_REFUSED') return `Not received: Magnus refused the transfer${item.error ? ` (${item.error})` : ''}.`;
  return `Not received: ${item.error ?? 'the import failed'}`;
}

const IMPORT_STATE: Record<string, string> = { pending: 'Being received', queued: 'Waiting to transfer', transferring: 'Transferring', resuming: 'Resuming after an interruption', verifying: 'Checking the digest', imported: 'Received' };

/** Artifacts on their way into Studio: progress while they transfer, and why one did not arrive. */
export function ImportStrip({ imports }: { imports: readonly ArtifactImport[] }) {
  const shown = imports.filter((item) => item.state !== 'imported');
  if (!shown.length) return null;
  return (
    <div className="review-list__imports grid gap-2" aria-label="Receiving">
      <p className="m-0 stat-label">Receiving</p>
      {shown.map((item) => {
        const received = item.received_bytes;
        return (
          <div key={item.artifact_id} className="grid gap-1 text-xs" data-import={item.state}>
            <span>
              <span className="font-medium">{item.name}</span> · {formatBytes(item.size)}
            </span>
            {item.state === 'failed' ? (
              <span className="text-danger">{importFailure(item)}</span>
            ) : (
              <>
                <span className="text-text-muted">
                  {IMPORT_STATE[item.state] ?? item.state.replaceAll('_', ' ')}
                  {received && item.size ? ` · ${formatBytes(received)} of ${formatBytes(item.size)}` : ''}
                  {item.resumes ? ` · resumed ${item.resumes} ${item.resumes === 1 ? 'time' : 'times'}` : item.attempts > 1 ? ` · attempt ${item.attempts}` : ''}
                  {item.transfer === 'whole' ? ' · whole-file download' : ''}
                </span>
                {received && item.size ? <progress max={item.size} value={Math.min(received, item.size)} aria-label={`Receiving ${item.name}`} /> : null}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const textOf = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/** The manifest fields worth reading, from manifest 1.0 or 1.1. */
export function provenanceOf(revision: Revision) {
  const ardent = record(revision.ardent);
  const manifest = record(ardent.manifest);
  const provenance = record(manifest.provenance);
  const execution = record(provenance.execution);
  const rendition = record(manifest.rendition);
  const transform = record(rendition.transform);
  return {
    schemaVersion: textOf(manifest.schema_version),
    producer: textOf(provenance.producer),
    producerTask: textOf(provenance.producer_task_id) ?? textOf(ardent.task_id),
    agent: textOf(ardent.agent_ref),
    executionRoot: textOf(execution.root),
    executionTask: textOf(execution.task),
    executionStep: textOf(execution.step),
    manifestRevision: typeof manifest.revision === 'number' ? manifest.revision : null,
    supersedes: textOf(manifest.supersedes_sha256),
    rendition: textOf(rendition.role) ? { role: textOf(rendition.role)!, of: textOf(rendition.of_sha256), transform: textOf(transform.name) ? `${textOf(transform.name)} ${textOf(transform.version) ?? ''}`.trim() : null } : null,
    license: textOf(manifest.license),
  };
}

/** Where a revision came from: the agent and task that produced it, its execution root and its revision chain. */
export function ProvenancePanel({ projectId, deliverable, revision }: { projectId: string; deliverable: Deliverable; revision: Revision }) {
  const facts = provenanceOf(revision);
  const chain = [...deliverable.revisions].sort((a, b) => a.revision - b.revision);
  const rows: Array<[string, React.ReactNode]> = [
    ['Produced by', facts.agent ?? facts.producer ?? 'unknown'],
    ['Ardent task', facts.producerTask ? <span className="break-all font-mono">{facts.producerTask}</span> : 'not recorded'],
    ['Execution root', facts.executionRoot ? <span className="break-all font-mono">{facts.executionRoot}</span> : 'not recorded'],
  ];
  if (facts.executionStep) rows.push(['Step', <span className="break-all font-mono">{facts.executionStep}</span>]);
  if (facts.rendition) rows.push(['Rendition', `${facts.rendition.role}${facts.rendition.of ? ` of ${facts.rendition.of.slice(0, 12)}` : ''}${facts.rendition.transform ? ` · ${facts.rendition.transform}` : ''}`]);
  if (facts.supersedes) rows.push(['Supersedes', <span className="font-mono">{facts.supersedes.slice(0, 12)}</span>]);
  if (facts.schemaVersion) rows.push(['Manifest', facts.schemaVersion]);
  if (facts.license) rows.push(['License', facts.license]);
  return (
    <section className="review-provenance panel panel--sm" aria-labelledby="review-provenance-title">
      <h4 id="review-provenance-title" className="m-0 text-sm font-semibold text-text-strong">
        Provenance
      </h4>
      <dl className="kv-list mt-2 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="kv-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 mt-2 text-xs text-text-muted">
        {`Revisions: ${chain.map((item) => `r${item.revision}${item.id === revision.id ? ' (this)' : ''}`).join(' → ')}`}
      </p>
      {revision.source_task_id ? (
        <StudioLink className="mt-1 inline-block text-xs" href={projectHref(projectId, `/room?lineage=${encodeURIComponent(revision.source_task_id)}`)}>
          Open the execution history
        </StudioLink>
      ) : null}
    </section>
  );
}
