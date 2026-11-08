import { useRef, useState, type DragEvent } from 'react';
import { FileUp, RefreshCw, RotateCcw, X } from 'lucide-react';
import { Badge, Button, EmptyState, IconButton } from '@ui';
import { cn } from '@lib/cn';
import { errorMessage } from '../../magnus/api/errors';
import { idempotencyKey } from '../api/client';
import { reindexFile, uploadFile, type StudioFile } from '../api/endpoints';
import type { ProjectStore } from '../state/project-store';
import { formatBytes, KNOWLEDGE_LABEL, KNOWLEDGE_TONE, MAX_UPLOAD_BYTES, REFERENCE_ACCEPT, uploadMime } from './logic';

interface Upload {
  id: string;
  file: File;
  mime: string | null;
  /** Kept across a retry, so a request that did land is not stored twice. */
  key: string;
  state: 'uploading' | 'failed';
  error?: string;
}

/** Why a picked file cannot be sent, or null. */
export function rejectReason(file: { name: string; type: string; size: number }): string | null {
  if (!uploadMime(file)) return 'This type is not accepted. Use Markdown, text, CSV, JSON, DOCX, PDF or an image.';
  if (file.size > MAX_UPLOAD_BYTES) return `Larger than ${formatBytes(MAX_UPLOAD_BYTES)}.`;
  if (file.size === 0) return 'The file is empty.';
  return null;
}

function FileRow({ file, onReindex, busy, readOnly }: { file: StudioFile; onReindex: () => void; busy: boolean; readOnly: boolean }) {
  const { state, error, chunks } = file.knowledge;
  const working = state === 'pending' || state === 'indexing';
  return (
    <li className="studio-file border-b border-border">
      <div className="studio-file__main">
        <span className="studio-file__name cell-strong">{file.name}</span>
        <span className="text-xs text-text-muted">
          {formatBytes(file.size)}
          {state === 'indexed' && chunks !== null ? ` · ${chunks} ${chunks === 1 ? 'passage' : 'passages'}` : ''}
        </span>
        {state === 'failed' && error ? <span className="text-xs text-danger">{error}</span> : null}
      </div>
      <span className="studio-file__state">
        <Badge tone={KNOWLEDGE_TONE[state]}>
          {working ? <span className="spinner" aria-hidden="true" /> : null}
          {KNOWLEDGE_LABEL[state]}
        </Badge>
        {state === 'failed' && !readOnly ? (
          <Button size="sm" icon={<RefreshCw className="size-4" />} loading={busy} onClick={onReindex}>
            Retry
          </Button>
        ) : null}
      </span>
    </li>
  );
}

/**
 * A project's references: upload (up to 64 MiB each) and the HiveMem indexing state of every file,
 * kept current by the project stream. Failed indexing has Retry; failed uploads keep the file to retry.
 */
export function ReferenceManager({ store, files, readOnly = false }: { store: ProjectStore; files: readonly StudioFile[]; readOnly?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [rejected, setRejected] = useState<Array<{ name: string; reason: string }>>([]);
  const [reindexing, setReindexing] = useState<ReadonlySet<string>>(new Set());
  const [reindexError, setReindexError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const references = files.filter((file) => file.purpose === 'reference');

  async function send(upload: Upload) {
    setUploads((current) => current.map((item) => (item.id === upload.id ? { id: item.id, file: item.file, mime: item.mime, key: item.key, state: 'uploading' } : item)));
    try {
      const created = await uploadFile(store.projectId, upload.file, upload.file.name, upload.mime!, upload.key);
      store.upsertFile(created);
      setUploads((current) => current.filter((item) => item.id !== upload.id));
    } catch (error) {
      setUploads((current) => current.map((item) => (item.id === upload.id ? { ...item, state: 'failed', error: errorMessage(error, 'The upload failed') } : item)));
    }
  }

  function add(list: FileList | null) {
    if (!list?.length) return;
    const accepted: Upload[] = [];
    const refused: Array<{ name: string; reason: string }> = [];
    for (const file of list) {
      const reason = rejectReason(file);
      if (reason) refused.push({ name: file.name, reason });
      else accepted.push({ id: `${file.name}-${idempotencyKey()}`, file, mime: uploadMime(file), key: idempotencyKey(), state: 'uploading' });
    }
    setRejected(refused);
    setUploads((current) => [...current, ...accepted]);
    // One at a time keeps a large batch from saturating the link and the service.
    void accepted.reduce((previous, upload) => previous.then(() => send(upload)), Promise.resolve());
  }

  async function reindex(file: StudioFile) {
    setReindexError(null);
    setReindexing((current) => new Set(current).add(file.id));
    try {
      store.upsertFile(await reindexFile(file.id));
    } catch (error) {
      setReindexError(`${file.name}: ${errorMessage(error, 'Indexing could not be queued again')}`);
    } finally {
      setReindexing((current) => {
        const next = new Set(current);
        next.delete(file.id);
        return next;
      });
    }
  }

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!readOnly) add(event.dataTransfer.files);
  };

  return (
    <div className="studio-references">
      {readOnly ? null : (
        <div
          className={cn('studio-dropzone rounded-panel border border-dashed', dragging ? 'border-accent bg-accent-soft' : 'border-border-strong bg-surface-sunken')}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
        >
          <FileUp className="size-6 text-accent" aria-hidden="true" />
          <p className="text-sm">Drop files here, or</p>
          <Button onClick={() => input.current?.click()}>Choose files</Button>
          <p className="text-xs text-text-muted">Markdown, text, CSV, JSON, DOCX, PDF or images, up to 64 MB each. Each reference is indexed into the project’s HiveMem workspace so agents can search it.</p>
          <input ref={input} type="file" multiple accept={REFERENCE_ACCEPT} className="sr-only" tabIndex={-1} aria-label="Reference files" onChange={(event) => { add(event.target.files); event.target.value = ''; }} />
        </div>
      )}
      {rejected.length ? (
        <ul className="studio-file-list" aria-label="Files not added">
          {rejected.map((item) => (
            <li key={item.name} className="studio-file border-b border-border">
              <div className="studio-file__main">
                <span className="studio-file__name cell-strong">{item.name}</span>
                <span className="text-xs text-danger">{item.reason}</span>
              </div>
              <IconButton label={`Dismiss ${item.name}`} icon={<X className="size-4" />} onClick={() => setRejected((current) => current.filter((entry) => entry !== item))} />
            </li>
          ))}
        </ul>
      ) : null}
      {reindexError ? <p role="alert" className="m-0 text-sm text-danger">{reindexError}</p> : null}
      {uploads.length || references.length ? (
        <ul className="studio-file-list" aria-label="References" aria-live="polite">
          {uploads.map((upload) => (
            <li key={upload.id} className="studio-file border-b border-border">
              <div className="studio-file__main">
                <span className="studio-file__name cell-strong">{upload.file.name}</span>
                <span className={cn('text-xs', upload.state === 'failed' ? 'text-danger' : 'text-text-muted')}>{upload.state === 'failed' ? upload.error : `${formatBytes(upload.file.size)} · uploading`}</span>
              </div>
              <span className="studio-file__state">
                {upload.state === 'uploading' ? (
                  <Badge tone="info">
                    <span className="spinner" aria-hidden="true" />
                    Uploading
                  </Badge>
                ) : (
                  <>
                    <Badge tone="danger">Upload failed</Badge>
                    <Button size="sm" icon={<RotateCcw className="size-4" />} onClick={() => void send(upload)}>
                      Retry
                    </Button>
                    <IconButton label={`Remove ${upload.file.name}`} icon={<X className="size-4" />} onClick={() => setUploads((current) => current.filter((item) => item.id !== upload.id))} />
                  </>
                )}
              </span>
            </li>
          ))}
          {references.map((file) => (
            <FileRow key={file.id} file={file} busy={reindexing.has(file.id)} readOnly={readOnly} onReindex={() => void reindex(file)} />
          ))}
        </ul>
      ) : readOnly ? (
        <EmptyState compact title="No references" message="This project has no reference files." />
      ) : null}
    </div>
  );
}
