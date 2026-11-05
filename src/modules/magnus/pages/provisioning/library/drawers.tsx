import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { libraryFileResponseSchema } from '@contracts/magnus/browser';
import type { z } from 'zod';
import { CheckCircle2, Palette, XCircle } from 'lucide-react';
import { Button, Drawer, Field, Select, TextArea, TextInput } from '@ui';
import { cn } from '@lib/cn';
import { idempotencyKey, magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { HaloDot } from '../../../effects';
import { NodeChecklist } from '../shared/nodes';
import { CATEGORY_COLORS, DEFAULT_CATEGORY_COLOR, displayNameOf, imageSource, isCategoryColor, isEditableText, mimeLabel, mimeOptionsFor, readsAsText, splitTags, uploadMimeType } from './logic';
import { categoryResponseSchema, libraryDeployResponseSchema, type DeployResult, type LibraryCategory } from './schemas';

export type LibraryFile = z.output<typeof libraryFileResponseSchema>['data'];

function FormError({ message }: { message: string }) {
  return message ? <p role="alert" className="m-0 rounded-control border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{message}</p> : null;
}

export function readUpload(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} could not be read`));
    if (readsAsText(file.name, file.type)) {
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(file);
    } else {
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.readAsDataURL(file);
    }
  });
}

export function CategoryDrawer({ open, category, onClose, onSaved }: { open: boolean; category: LibraryCategory | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<string>(DEFAULT_CATEGORY_COLOR);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? '');
    setDescription(category?.description ?? '');
    setColor(category?.color ?? DEFAULT_CATEGORY_COLOR);
    setError('');
  }, [open, category]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = { name: name.trim(), description: description.trim(), color };
      if (category) await magnus.patch(`/library/categories/${segment(category.id)}`, categoryResponseSchema, { body });
      else await magnus.post('/library/categories', categoryResponseSchema, { body });
      onSaved();
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, 'The category could not be saved'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Drawer open={open} title={category ? 'Edit category' : 'Create category'} eyebrow="Library" onClose={onClose}>
      <form className="grid gap-4" onSubmit={(event) => void save(event)}>
        <Field label="Name"><TextInput value={name} onChange={setName} placeholder="Personality, templates, config…" required /></Field>
        <Field label="Description"><TextArea value={description} onChange={setDescription} rows={2} placeholder="What kind of files belong here?" /></Field>
        <div className="field">
          <span className="field-label">Color</span>
          <div className="flex flex-wrap items-center gap-2">
            {CATEGORY_COLORS.map((choice) => (
              <button key={choice} type="button" aria-label={`Use color ${choice}`} aria-pressed={color === choice} onClick={() => setColor(choice)} className={cn('size-7 cursor-pointer rounded-full border-2', color === choice ? 'border-text-strong' : 'border-transparent')} style={{ backgroundColor: choice }} />
            ))}
            <span className="ml-1 flex items-center gap-1.5">
              <Palette className="size-4 text-text-muted" />
              <TextInput aria-label="Custom color" value={color} onChange={setColor} className="w-24 font-mono" />
            </span>
          </div>
          {!isCategoryColor(color) ? <span className="field-hint text-danger">Use a hex color such as #3b82f6.</span> : null}
        </div>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!name.trim() || !isCategoryColor(color)}>{category ? 'Save changes' : 'Create category'}</Button>
        </div>
      </form>
    </Drawer>
  );
}

export function FileDrawer({ open, file, categories, initialCategoryId, onClose, onSaved }: { open: boolean; file: LibraryFile | null; categories: readonly LibraryCategory[]; initialCategoryId: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [fileName, setFileName] = useState('');
  const [mimeType, setMimeType] = useState('text/markdown');
  const [content, setContent] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setName(file?.name ?? '');
    setFileName(file?.fileName ?? '');
    setMimeType(file?.mimeType ?? 'text/markdown');
    setContent(file?.content ?? '');
    setCategoryId(file ? (file.categoryId ?? '') : initialCategoryId);
    setTags(file?.tags.join(', ') ?? '');
    setError('');
  }, [open, file, initialCategoryId]);
  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    if (!picked) return;
    try {
      setContent(await readUpload(picked));
      setFileName(picked.name);
      setName((current) => current || displayNameOf(picked.name));
      setMimeType(uploadMimeType(picked.name, picked.type));
    } catch (caught) {
      setError(errorMessage(caught, 'The file could not be read'));
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const common = { name: name.trim(), fileName: fileName.trim(), mimeType, categoryId: categoryId || null, tags: splitTags(tags) };
    try {
      // A binary file's content is not on this form, so an edit does not send it back.
      if (file) await magnus.patch(`/library/files/${segment(file.id)}`, libraryFileResponseSchema, { body: isEditableText(mimeType) ? { ...common, content } : common });
      else await magnus.post('/library/files', libraryFileResponseSchema, { body: { ...common, content } });
      onSaved();
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, 'The file could not be saved'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Drawer open={open} title={file ? 'Edit file' : 'Upload file'} eyebrow={file ? file.fileName : 'Library'} onClose={onClose}>
      <form className="grid gap-4" onSubmit={(event) => void save(event)}>
        {!file ? (
          <Field label="Upload file" hint="Or fill in the fields below by hand.">
            <input type="file" onChange={(event) => void pick(event)} accept=".md,.txt,.json,.yaml,.yml,.pdf,.png,.jpg,.jpeg,.gif,.svg,.webp" />
          </Field>
        ) : null}
        <div className="field-grid">
          <Field label="Display name"><TextInput value={name} onChange={setName} placeholder="SOUL" required /></Field>
          <Field label="File name"><TextInput value={fileName} onChange={setFileName} placeholder="SOUL.md" required /></Field>
          <Field label="Category"><Select value={categoryId} onChange={setCategoryId} options={[{ value: '', label: 'Uncategorized' }, ...categories.map((category) => ({ value: category.id, label: category.name }))]} /></Field>
          <Field label="Type"><Select value={mimeType} onChange={setMimeType} options={mimeOptionsFor(mimeType)} /></Field>
        </div>
        <Field label="Tags" hint="Comma-separated"><TextInput value={tags} onChange={setTags} placeholder="personality, config, template" /></Field>
        {isEditableText(mimeType) ? <Field label="Content"><TextArea value={content} onChange={setContent} rows={10} placeholder="File content…" className="font-mono text-xs" /></Field> : null}
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!name.trim() || !fileName.trim()}>{file ? 'Save changes' : 'Upload file'}</Button>
        </div>
      </form>
    </Drawer>
  );
}

export function FileViewerDrawer({ file, onClose }: { file: LibraryFile | null; onClose: () => void }) {
  const mimeType = file?.mimeType ?? '';
  const isMarkdown = mimeType === 'text/markdown' || !!file?.fileName.endsWith('.md');
  const isText = isEditableText(mimeType) || isMarkdown || mimeType === 'application/x-magnus-skill' || mimeType === 'application/x-magnus-cronjob';
  return (
    <Drawer open={!!file} title={file?.name ?? 'File'} {...(file ? { eyebrow: file.fileName } : {})} onClose={onClose}>
      {!file ? null : isText ? (
        <pre className="code-block m-0 whitespace-pre-wrap">{file.content || '(empty)'}</pre>
      ) : mimeType.startsWith('image/') ? (
        <img src={imageSource(file.content, mimeType)} alt={file.name} className="max-w-full rounded-control" />
      ) : (
        <p className="m-0 p-6 text-center text-sm text-text-muted">{mimeType === 'application/pdf' ? 'PDF preview is not available. Download the file instead.' : `Preview is not available for ${mimeLabel(mimeType)} files.`}</p>
      )}
    </Drawer>
  );
}

export function DeployDrawer({ file, onClose }: { file: { id: string; name: string; mimeType: string } | null; onClose: () => void }) {
  const [nodeIds, setNodeIds] = useState<string[]>([]);
  const [deploying, setDeploying] = useState(false);
  const [results, setResults] = useState<DeployResult[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setNodeIds([]);
    setResults(null);
    setError('');
  }, [file]);
  async function deploy() {
    if (!file) return;
    setDeploying(true);
    setError('');
    try {
      setResults((await magnus.post('/library/deploy', libraryDeployResponseSchema, { body: { fileId: file.id, nodeIds, overwrite: true }, idempotencyKey: idempotencyKey() })).data);
    } catch (caught) {
      setError(errorMessage(caught, 'The deployment could not start'));
    } finally {
      setDeploying(false);
    }
  }
  return (
    <Drawer open={!!file} title={`Deploy ${file ? mimeLabel(file.mimeType).toLowerCase() : 'item'}`} {...(file ? { eyebrow: file.name } : {})} onClose={onClose}>
      {results ? (
        <div className="grid gap-4">
          <ul className="m-0 grid list-none gap-2 p-0" role="status">
            {results.map((result) => (
              <li key={result.nodeId} className="scan-sweep flex items-center gap-3 rounded-control border border-border px-3 py-2 text-sm">
                {result.status === 'success' ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <XCircle className="size-4 shrink-0 text-danger" />}
                <span className="font-semibold">{result.nodeName}</span>
                {result.error ? <span className="min-w-0 break-words text-xs text-danger">{result.error}</span> : null}
              </li>
            ))}
          </ul>
          <div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>
        </div>
      ) : (
        <div className="grid gap-4">
          {file ? <NodeChecklist selected={nodeIds} onChange={setNodeIds} status="ONLINE" empty="No online nodes are available." /> : null}
          <FormError message={error} />
          <div className="flex items-center justify-end gap-2">
            {deploying ? <span className="flex items-center gap-2 text-sm text-text-muted"><HaloDot tone="accent" />Writing to nodes…</span> : null}
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={deploying} disabled={nodeIds.length === 0} onClick={() => void deploy()}>Deploy to {nodeIds.length} node{nodeIds.length === 1 ? '' : 's'}</Button>
          </div>
        </div>
      )}
    </Drawer>
  );
}
