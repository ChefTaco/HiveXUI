import { useState } from 'react';
import { BookOpen, Download, FileText, FolderOpen, Library, Save, ShieldCheck, X } from 'lucide-react';
import { fileReadResponseSchema, fileUpdatePreviewResponseSchema, fileUpdateTasksResponseSchema, libraryFileResponseSchema } from '@contracts/magnus/browser';
import { Badge, Button, IconButton, PageHeader, TextArea, Toggle } from '@ui';
import { useToast } from '../../../../../components/toast';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { FxPanel, PageItem } from '../../../effects';
import { ActionConfirm } from '../../../ui/action-confirm';
import { NodeSelector } from '../../../ui/node-selector';
import { postKeepingBody } from '../shared/request';
import { FileBrowser } from './file-browser';
import { libraryFileName, pushMessage, pushProblem } from './files-model';
import { LibraryPicker, SaveToLibrary, type LoadedLibraryFile } from './library-drawers';

type Preview = { policy: string; targetCount: number; backupPlanned: boolean; contentBytes: number };

export default function FilesPage() {
  const toast = useToast();
  const [nodeId, setNodeId] = useState('');
  const [nodeName, setNodeName] = useState('');
  const [confirmingPush, setConfirmingPush] = useState(false);
  const [filePath, setFilePath] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState<'pull' | 'push' | 'preview' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [librarySaving, setLibrarySaving] = useState(false);
  const [libraryFileId, setLibraryFileId] = useState<string | null>(null);
  const [backup, setBackup] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const loading = busy !== null;

  async function pull(pathOverride?: string) {
    const path = pathOverride ?? filePath;
    if (!nodeId || !path) return;
    setBusy('pull');
    setError(null);
    try {
      const { data } = await magnus.get('/files/read', fileReadResponseSchema, { query: { nodeId, filePath: path } });
      setContent(data.content);
    } catch (caught) {
      setError(`Read failed: ${errorMessage(caught, 'The file could not be read from the node')}`);
      setContent('');
    } finally {
      setBusy(null);
    }
  }

  async function push() {
    setConfirmingPush(false);
    if (!nodeId || !filePath) return;
    setBusy('push');
    setError(null);
    try {
      // Read through the failure: when every task fails, the 502 holds each task's reason.
      const { data } = await postKeepingBody('/files/update', fileUpdateTasksResponseSchema, { nodeIds: [nodeId], filePath, content, createIfMissing: true, backup });
      const problem = pushProblem(data);
      if (problem) setError(problem);
      else toast.success('File pushed', filePath);
    } catch (caught) {
      setError(`Push failed: ${errorMessage(caught, 'The file could not be pushed to the node')}`);
    } finally {
      setBusy(null);
    }
  }

  async function runPreview() {
    if (!nodeId || !filePath) return;
    setBusy('preview');
    setError(null);
    setPreview(null);
    try {
      const { data } = await magnus.post('/files/update', fileUpdatePreviewResponseSchema, { body: { nodeIds: [nodeId], filePath, content, createIfMissing: true, backup, previewOnly: true } });
      setPreview(data);
    } catch (caught) {
      setError(`Preview failed: ${errorMessage(caught, 'The file update could not be previewed')}`);
    } finally {
      setBusy(null);
    }
  }

  function loadLibraryFile(file: LoadedLibraryFile) {
    setContent(file.content);
    setLibraryFileId(file.id);
    if (!filePath) setFilePath(file.fileName);
  }

  async function saveToLibrary() {
    if (!libraryFileId || !content) {
      setSaveOpen(true);
      return;
    }
    setLibrarySaving(true);
    try {
      await magnus.patch(`/library/files/${segment(libraryFileId)}`, libraryFileResponseSchema, { body: { content } });
      toast.success('Library file saved');
    } catch (caught) {
      // As before: if the file cannot be updated, offer to save it as a new one.
      toast.error('The library file could not be updated', errorMessage(caught));
      setSaveOpen(true);
    } finally {
      setLibrarySaving(false);
    }
  }

  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader title="File Manager" eyebrow="Operations" icon={<FileText className="size-5" />} description="Read and update Magnus workspace files across nodes" />
      </PageItem>
      <PageItem>
        <FxPanel title="Target" interactive={false}>
          <div className="grid gap-4">
            <div className="grid items-end gap-4 sm:grid-cols-[1fr_2fr_auto]">
              <NodeSelector label="Node" value={nodeId} onChange={(id, name) => { setNodeId(id); setNodeName(name); }} />
              <div className="field min-w-0">
                <span className="field-label">File path</span>
                <button
                  type="button"
                  disabled={!nodeId}
                  title={nodeId ? 'Browse files on the node' : 'Select a node first'}
                  onClick={() => setBrowserOpen(true)}
                  className="glow-hover flex min-w-0 cursor-pointer items-center gap-2 rounded-control border border-border bg-surface-sunken px-3 py-2 text-left text-sm hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FolderOpen aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
                  <span className={filePath ? 'truncate font-mono' : 'truncate text-text-muted'}>{filePath || 'Browse to select a file…'}</span>
                </button>
              </div>
              <Button icon={<Download className="size-4" />} loading={busy === 'pull'} disabled={loading || !nodeId || !filePath} onClick={() => void pull()}>Pull</Button>
            </div>
            <Toggle checked={backup} onChange={setBackup} label="Create remote backup before write" />
          </div>
        </FxPanel>
      </PageItem>
      {error ? (
        <PageItem>
          <div role="alert" className="glow-danger flex items-start justify-between gap-3 rounded-control border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">
            <span className="min-w-0 break-words">{error}</span>
            <IconButton label="Dismiss" icon={<X className="size-4" />} onClick={() => setError(null)} />
          </div>
        </PageItem>
      ) : null}
      {preview ? (
        <PageItem>
          <div className="scan-sweep flex flex-wrap items-center gap-x-4 gap-y-1 rounded-control border border-accent bg-accent-soft px-4 py-3 text-sm">
            <span>Policy: <Badge tone={preview.policy === 'sensitive-system-path' ? 'warning' : 'success'}>{preview.policy}</Badge></span>
            <span className="num">Targets: {preview.targetCount}</span>
            <span>Backup: {preview.backupPlanned ? 'planned' : 'off'}</span>
            <span className="num">Bytes: {preview.contentBytes}</span>
          </div>
        </PageItem>
      ) : null}
      <PageItem>
        <FxPanel
          title="File editor"
          interactive={false}
          actions={
            <>
              <Button size="sm" icon={<BookOpen className="size-4" />} onClick={() => setPickerOpen(true)}>Load from Library</Button>
              <Button size="sm" icon={<Library className="size-4" />} loading={librarySaving} disabled={!content} onClick={() => void saveToLibrary()}>{libraryFileId ? 'Save to Library' : 'Save as Library file'}</Button>
              <Button size="sm" icon={<ShieldCheck className="size-4" />} loading={busy === 'preview'} disabled={loading || !nodeId || !filePath} onClick={() => void runPreview()}>Preview</Button>
              <Button size="sm" variant="primary" icon={<Save className="size-4" />} loading={busy === 'push'} disabled={loading || !nodeId || !filePath} onClick={() => setConfirmingPush(true)}>Push to Node</Button>
            </>
          }
        >
          <p className="m-0 mb-3 flex items-center gap-2 border-b border-border pb-3 text-sm">
            <FileText aria-hidden="true" className="size-4 shrink-0 text-accent" />
            <span className="min-w-0 truncate font-mono text-accent">{filePath || 'No file selected'}</span>
          </p>
          <TextArea aria-label="File content" value={content} onChange={setContent} placeholder="File content will appear here after pulling from a node…" rows={20} className="w-full font-mono transition-shadow duration-[var(--duration-base)] focus:shadow-[0_0_12px_var(--glow-accent)]" />
        </FxPanel>
      </PageItem>
      <ActionConfirm
        open={confirmingPush}
        title="Push this file?"
        message={pushMessage({ filePath, nodeName, content, backup })}
        confirmLabel="Push to node"
        onConfirm={() => void push()}
        onCancel={() => setConfirmingPush(false)}
      />
      <FileBrowser
        open={browserOpen}
        nodeId={nodeId}
        onClose={() => setBrowserOpen(false)}
        onSelect={(path) => {
          setFilePath(path);
          void pull(path);
        }}
      />
      <LibraryPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={loadLibraryFile} />
      <SaveToLibrary
        open={saveOpen}
        fileName={libraryFileName(filePath)}
        content={content}
        onClose={() => setSaveOpen(false)}
        onSaved={(file) => {
          setLibraryFileId(file.id);
          toast.success('Saved to the library', file.name);
        }}
      />
    </div>
  );
}
