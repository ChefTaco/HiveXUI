import { useEffect, useState, type FormEvent } from 'react';
import { FileText, Search } from 'lucide-react';
import { libraryFileResponseSchema, libraryFilesListResponseSchema } from '@contracts/magnus/browser';
import { Badge, Button, Drawer, Field, TextInput, LoadingRows, ResourceError } from '@ui';
import { formatTime } from '@lib/format';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { formatBytes, FormError } from '../shared/parts';
import { libraryDisplayName, libraryMimeType, mimeLabel } from './files-model';

export interface LoadedLibraryFile {
  id: string;
  name: string;
  fileName: string;
  content: string;
}

const SEARCH_DELAY_MS = 300;

export function LibraryPicker({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (file: LoadedLibraryFile) => void }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);
  const files = useMagnusResource((signal) => magnus.get('/library/files', libraryFilesListResponseSchema, { query: { pageSize: 100, query: query || undefined }, signal }), [query, open], { enabled: open });
  async function choose(id: string) {
    setError('');
    try {
      const { data } = await magnus.get(`/library/files/${segment(id)}`, libraryFileResponseSchema);
      onSelect({ id: data.id, name: data.name, fileName: data.fileName, content: data.content });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, 'The library file could not be loaded'));
    }
  }
  const list = files.data?.data;
  return (
    <Drawer open={open} title="Load from Library" eyebrow="Select a file to load into the editor" onClose={onClose}>
      <div className="grid gap-3">
        <label className="relative block">
          <span className="sr-only">Search library files</span>
          <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <TextInput className="w-full pl-9" value={search} onChange={setSearch} placeholder="Search library files…" />
        </label>
        <FormError message={error} />
        {!list ? (
          files.error ? <ResourceError error={files.error} title="The library could not be loaded" onRetry={() => void files.refresh()} /> : <LoadingRows />
        ) : list.length === 0 ? (
          <p className="m-0 py-8 text-center text-sm text-text-muted">{query ? 'No files match your search' : 'No library files yet'}</p>
        ) : (
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {list.map((file) => (
              <li key={file.id}>
                <button type="button" onClick={() => void choose(file.id)} className="glow-hover flex w-full cursor-pointer items-center gap-3 rounded-control border border-border bg-surface-raised px-3 py-2.5 text-left hover:border-accent">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent"><FileText aria-hidden="true" className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-2"><span className="truncate text-sm font-semibold">{file.name}</span><span className="truncate text-xs text-text-muted">{file.fileName}</span></span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-2">
                      <Badge>{mimeLabel(file.mimeType)}</Badge>
                      <span className="num text-xs text-text-muted">{formatBytes(file.sizeBytes)}</span>
                      {file.category ? <Badge>{file.category.name}</Badge> : null}
                    </span>
                  </span>
                  <span className="num hidden shrink-0 text-xs text-text-muted sm:block">{formatTime(file.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}

export function SaveToLibrary({ open, fileName, content, onClose, onSaved }: { open: boolean; fileName: string; content: string; onClose: () => void; onSaved: (file: { id: string; name: string }) => void }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setName(libraryDisplayName(fileName));
    setError('');
  }, [open, fileName]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await magnus.post('/library/files', libraryFileResponseSchema, { body: { name: name.trim(), fileName: fileName || `${name.trim()}.md`, mimeType: libraryMimeType(fileName), content } });
      onSaved({ id: data.id, name: data.name });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, 'The file could not be saved to the library'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Drawer open={open} title="Save to Library" eyebrow="Save the editor content as a library file" onClose={onClose}>
      <form className="grid gap-4" onSubmit={(event) => void save(event)}>
        <Field label="Display name"><TextInput value={name} onChange={setName} placeholder="e.g. SOUL" required /></Field>
        <Field label="File name"><TextInput value={fileName} onChange={() => {}} disabled /></Field>
        <p className="num m-0 text-sm text-text-muted">Content size: {formatBytes(new TextEncoder().encode(content).length)}</p>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!name.trim()}>Save to Library</Button>
        </div>
      </form>
    </Drawer>
  );
}
