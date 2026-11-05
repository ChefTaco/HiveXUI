import { useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { libraryFileResponseSchema, libraryFilesListResponseSchema } from '@contracts/magnus/browser';
import type { z } from 'zod';
import { Check, Clock, Copy, Download, Eye, File, FileJson, FileText, FileUp, Filter, FolderOpen, FolderPlus, GripVertical, Image, LayoutGrid, Library, List, Package, Pencil, RefreshCw, Rocket, Search, Trash2, X } from 'lucide-react';
import { Badge, Button, ConfirmDialog, EmptyState, IconButton, PageHeader, Select, TextInput } from '@ui';
import { relativeTime } from '@lib/format';
import { cn } from '@lib/cn';
import { useToast } from '../../../../../components/toast';
import { magnus, segment } from '../../../api/client';
import { errorMessage } from '../../../api/errors';
import { useMagnusResource } from '../../../api/use-resource';
import { FxPanel, PageItem } from '../../../effects';
import { ADMIN_ONLY, useMagnusSession, WRITE_ROLES } from '../../../session';
import { LoadingRows, ResourceError } from '../../../ui/resource-state';
import { CategoryDrawer, DeployDrawer, FileDrawer, FileViewerDrawer, readUpload, type LibraryFile } from './drawers';
import { CRONJOB_MIME, displayNameOf, fileBlob, formatBytes, isCategoryColor, isDeployable, mimeLabel, saveBlob, SKILL_MIME, uploadMimeType } from './logic';
import { categoryListResponseSchema, libraryDeletedResponseSchema, libraryMovedResponseSchema, type LibraryCategory } from './schemas';

type FileRow = z.output<typeof libraryFilesListResponseSchema>['data'][number];
const PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 300;
const UNCATEGORIZED = 'uncategorized';
const TYPE_FILTERS = [
  { value: '', label: 'All types' },
  { value: 'text/markdown', label: 'Markdown' },
  { value: 'text/plain', label: 'Text' },
  { value: 'application/json', label: 'JSON' },
  { value: 'application/pdf', label: 'PDF' },
  { value: 'image/', label: 'Images' },
  { value: SKILL_MIME, label: 'Skills' },
  { value: CRONJOB_MIME, label: 'Cron jobs' },
];

function fileIcon(mimeType: string): ReactNode {
  if (mimeType === SKILL_MIME) return <Package className="size-4" />;
  if (mimeType === CRONJOB_MIME) return <Clock className="size-4" />;
  if (mimeType.startsWith('image/')) return <Image className="size-4" />;
  if (mimeType === 'application/json') return <FileJson className="size-4" />;
  if (mimeType === 'text/markdown' || mimeType === 'text/plain') return <FileText className="size-4" />;
  return <File className="size-4" />;
}

/** The operator's chosen color, on a dot. Text stays in theme colors, so it stays readable. */
const CategoryDot = ({ color, className }: { color: string; className?: string }) => <span aria-hidden="true" className={cn('inline-block rounded-full', className ?? 'size-2')} style={{ backgroundColor: isCategoryColor(color) ? color : 'var(--text-muted)' }} />;
const CategoryChip = ({ category }: { category: NonNullable<FileRow['category']> }) => <span className="inline-flex items-center gap-1.5 rounded-pill border border-border px-2 py-0.5 text-xs text-text-muted"><CategoryDot color={category.color} />{category.name}</span>;

export default function LibraryPage() {
  const toast = useToast();
  const { can } = useMagnusSession();
  const canWrite = can(WRITE_ROLES);
  const canDelete = can(ADMIN_ONLY);

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [mimeFilter, setMimeFilter] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [limit, setLimit] = useState(PAGE_SIZE);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => setLimit(PAGE_SIZE), [query, selected, mimeFilter]);

  const categories = useMagnusResource((signal) => magnus.get('/library/categories', categoryListResponseSchema, { signal }));
  const files = useMagnusResource((signal) => magnus.get('/library/files', libraryFilesListResponseSchema, { query: { pageSize: limit, query: query || undefined, categoryId: selected ?? undefined, mimeType: mimeFilter || undefined }, signal }), [limit, query, selected, mimeFilter]);
  // A filtered list's total says nothing about the library, so the sidebar counts come from here.
  const totals = useMagnusResource((signal) => magnus.get('/library/files', libraryFilesListResponseSchema, { query: { pageSize: 1 }, signal }));
  const categoryList = categories.data?.data ?? [];
  const total = totals.data?.meta.total;
  const uncategorized = total === undefined || !categories.data ? undefined : Math.max(0, total - categoryList.reduce((sum, category) => sum + (category.fileCount ?? 0), 0));
  const refreshAll = () => void Promise.all([categories.refresh(), files.refresh(), totals.refresh()]);

  const [categoryDrawer, setCategoryDrawer] = useState<{ category: LibraryCategory | null } | null>(null);
  const [fileDrawer, setFileDrawer] = useState<{ file: LibraryFile | null } | null>(null);
  const [viewer, setViewer] = useState<LibraryFile | null>(null);
  const [deploying, setDeploying] = useState<FileRow | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<LibraryCategory | null>(null);
  const [deletingFile, setDeletingFile] = useState<FileRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [draggedFileId, setDraggedFileId] = useState<string | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
  const [draggingExternal, setDraggingExternal] = useState(false);
  const [uploading, setUploading] = useState(false);

  const readFile = async (file: FileRow) => (await magnus.get(`/library/files/${segment(file.id)}`, libraryFileResponseSchema)).data;
  async function withContent(file: FileRow, action: (full: LibraryFile) => void | Promise<void>) {
    try {
      await action(await readFile(file));
    } catch (caught) {
      toast.error(`${file.name} could not be read`, errorMessage(caught));
    }
  }
  const openFile = (file: FileRow) => {
    if (canWrite) void withContent(file, (full) => setFileDrawer({ file: full }));
    else void withContent(file, setViewer);
  };
  const copyFile = (file: FileRow) => void withContent(file, async (full) => {
    try {
      await navigator.clipboard.writeText(full.content);
      setCopiedId(file.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error('The browser did not allow copying');
    }
  });
  const downloadFile = (file: FileRow) => void withContent(file, (full) => saveBlob(fileBlob(full.content, full.mimeType), full.fileName));

  async function confirmDeleteCategory() {
    if (!deletingCategory) return;
    setDeleteBusy(true);
    try {
      await magnus.delete(`/library/categories/${segment(deletingCategory.id)}`, libraryDeletedResponseSchema);
      if (selected === deletingCategory.id) setSelected(null);
      toast.success(`${deletingCategory.name} deleted`);
      setDeletingCategory(null);
      refreshAll();
    } catch (caught) {
      toast.error('The category could not be deleted', errorMessage(caught));
    } finally {
      setDeleteBusy(false);
    }
  }
  async function confirmDeleteFile() {
    if (!deletingFile) return;
    setDeleteBusy(true);
    try {
      await magnus.delete(`/library/files/${segment(deletingFile.id)}`, libraryDeletedResponseSchema);
      toast.success(`${deletingFile.name} deleted`);
      setDeletingFile(null);
      refreshAll();
    } catch (caught) {
      toast.error('The file could not be deleted', errorMessage(caught));
    } finally {
      setDeleteBusy(false);
    }
  }

  const fileDragOver = (event: DragEvent, categoryId: string | null) => {
    if (!canWrite || !draggedFileId) return;
    event.preventDefault();
    setDragOverCategory(categoryId ?? 'all');
  };
  async function dropOnCategory(event: DragEvent, categoryId: string | null) {
    event.preventDefault();
    setDragOverCategory(null);
    const fileId = draggedFileId;
    setDraggedFileId(null);
    if (!fileId) return;
    try {
      await magnus.post('/library/files/move', libraryMovedResponseSchema, { body: { fileIds: [fileId], categoryId } });
      refreshAll();
    } catch (caught) {
      toast.error('The file could not be moved', errorMessage(caught));
    }
  }
  async function uploadDropped(event: DragEvent) {
    event.preventDefault();
    setDraggingExternal(false);
    const dropped = Array.from(event.dataTransfer.files);
    if (!canWrite || dropped.length === 0) return;
    setUploading(true);
    for (const file of dropped) {
      try {
        await magnus.post('/library/files', libraryFileResponseSchema, {
          body: { name: displayNameOf(file.name), fileName: file.name, mimeType: uploadMimeType(file.name, file.type), content: await readUpload(file), categoryId: selected === UNCATEGORIZED ? null : selected },
        });
      } catch (caught) {
        toast.error(`${file.name} was not uploaded`, errorMessage(caught));
      }
    }
    setUploading(false);
    refreshAll();
  }

  const list = files.data?.data ?? [];
  const filtering = !!(query || mimeFilter || selected);
  const categoryRow = (active: boolean, over: boolean) => cn('group flex w-full cursor-pointer items-center gap-2 rounded-control border px-3 py-2 text-left text-sm', over && 'glow-accent', active ? 'border-accent bg-accent-soft text-accent' : 'border-transparent text-text-muted hover:bg-surface-hover hover:text-text');
  const rowActions = (file: FileRow) => (
    <>
      <IconButton label={`Preview ${file.name}`} icon={<Eye className="size-4" />} onClick={(event) => { event.stopPropagation(); void withContent(file, setViewer); }} />
      <IconButton label={`Copy ${file.name}`} icon={copiedId === file.id ? <Check className="size-4 text-success" /> : <Copy className="size-4" />} onClick={(event) => { event.stopPropagation(); copyFile(file); }} />
      <IconButton label={`Download ${file.name}`} icon={<Download className="size-4" />} onClick={(event) => { event.stopPropagation(); downloadFile(file); }} />
      {canWrite ? <IconButton label={`Edit ${file.name}`} icon={<Pencil className="size-4" />} onClick={(event) => { event.stopPropagation(); void withContent(file, (full) => setFileDrawer({ file: full })); }} /> : null}
      {canDelete ? <IconButton label={`Delete ${file.name}`} variant="danger" icon={<Trash2 className="size-4" />} onClick={(event) => { event.stopPropagation(); setDeletingFile(file); }} /> : null}
      {canWrite && isDeployable(file.mimeType) ? <IconButton label={`Deploy ${file.name}`} icon={<Rocket className="size-4 text-accent" />} onClick={(event) => { event.stopPropagation(); setDeploying(file); }} /> : null}
    </>
  );
  // Hover reveals the actions where there is a pointer. A touch screen has no hover, so they stay visible.
  const revealed = 'flex flex-wrap gap-0.5 opacity-100 lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100';

  return (
    <div className="page-stack">
      <PageItem>
        <PageHeader
          eyebrow="Provisioning"
          title="Library"
          description="Browse, manage, and share Markdown, PDF, and image files, skills and cron jobs"
          actions={
            <>
              <Button size="sm" icon={<RefreshCw className="size-4" />} loading={files.refreshing} onClick={refreshAll}>Refresh</Button>
              {canWrite ? <Button size="sm" icon={<FolderPlus className="size-4" />} onClick={() => setCategoryDrawer({ category: null })}>Category</Button> : null}
              {canWrite ? <Button size="sm" variant="primary" icon={<FileUp className="size-4" />} onClick={() => setFileDrawer({ file: null })}>Upload</Button> : null}
            </>
          }
        />
      </PageItem>
      <PageItem>
        <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <nav aria-label="Library categories" className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-1">
            <p className="m-0 mb-2 text-sm font-semibold text-text-muted">Categories</p>
            <button type="button" aria-pressed={selected === null} onClick={() => setSelected(null)} onDragOver={(event) => fileDragOver(event, null)} onDragLeave={() => setDragOverCategory(null)} onDrop={(event) => void dropOnCategory(event, null)} className={categoryRow(selected === null, dragOverCategory === 'all')}>
              <Library className="size-4 shrink-0" />
              <span className="flex-1">All files</span>
              <span className="num text-xs">{total ?? ''}</span>
            </button>
            <button type="button" aria-pressed={selected === UNCATEGORIZED} onClick={() => setSelected(UNCATEGORIZED)} onDragOver={(event) => fileDragOver(event, UNCATEGORIZED)} onDragLeave={() => setDragOverCategory(null)} onDrop={(event) => void dropOnCategory(event, null)} className={categoryRow(selected === UNCATEGORIZED, dragOverCategory === UNCATEGORIZED)}>
              <FolderOpen className="size-4 shrink-0" />
              <span className="flex-1">Uncategorized</span>
              <span className="num text-xs">{uncategorized ?? ''}</span>
            </button>
            {categoryList.map((category) => (
              <div key={category.id} onDragOver={(event) => fileDragOver(event, category.id)} onDragLeave={() => setDragOverCategory(null)} onDrop={(event) => void dropOnCategory(event, category.id)} className={cn(categoryRow(selected === category.id, dragOverCategory === category.id), 'cursor-default p-0 pr-1')}>
                <button type="button" aria-pressed={selected === category.id} title={category.description || undefined} onClick={() => setSelected(category.id)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-2 text-left">
                  <CategoryDot color={category.color} className="size-3 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{category.name}</span>
                  <span className="num text-xs">{category.fileCount ?? 0}</span>
                </button>
                {canWrite ? (
                  <span className={revealed}>
                    <IconButton label={`Edit ${category.name}`} icon={<Pencil className="size-3" />} onClick={() => setCategoryDrawer({ category })} />
                    {canDelete ? <IconButton label={`Delete ${category.name}`} variant="danger" icon={<Trash2 className="size-3" />} onClick={() => setDeletingCategory(category)} /> : null}
                  </span>
                ) : null}
              </div>
            ))}
            {!categories.data && categories.error ? <p role="alert" className="m-0 text-sm text-warning">Categories could not be loaded: {errorMessage(categories.error)}</p> : null}
          </nav>
          <div className="grid min-w-0 content-start gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-48 flex-1">
                <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                <TextInput aria-label="Search files by name" value={search} onChange={setSearch} placeholder="Search files by name…" className="w-full pl-9 pr-9" />
                {search ? <span className="absolute right-1 top-1/2 -translate-y-1/2"><IconButton label="Clear search" icon={<X className="size-4" />} onClick={() => setSearch('')} /></span> : null}
              </div>
              <span className="flex items-center gap-1.5">
                <Filter aria-hidden="true" className="size-4 text-text-muted" />
                <Select aria-label="Filter by type" value={mimeFilter} onChange={setMimeFilter} options={TYPE_FILTERS} />
              </span>
              <span className="segmented-tabs" role="group" aria-label="View">
                <button type="button" aria-label="Grid view" aria-pressed={viewMode === 'grid'} onClick={() => setViewMode('grid')} className={cn('tab-button', viewMode === 'grid' && 'tab-button--active')}><LayoutGrid className="size-4" /></button>
                <button type="button" aria-label="List view" aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')} className={cn('tab-button', viewMode === 'list' && 'tab-button--active')}><List className="size-4" /></button>
              </span>
            </div>
            <div
              onDragOver={(event) => {
                if (!canWrite || !event.dataTransfer.types.includes('Files')) return;
                event.preventDefault();
                setDraggingExternal(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setDraggingExternal(false);
              }}
              onDrop={(event) => void uploadDropped(event)}
              className={cn('min-h-96 rounded-panel border-2 border-dashed p-0.5', draggingExternal || uploading ? 'glow-accent border-accent bg-accent-soft' : 'border-transparent')}
            >
              {uploading ? <p role="status" className="m-0 p-3 text-sm text-accent">Uploading…<span className="fx-cursor" aria-hidden="true" /></p> : null}
              {!files.data ? (
                <FxPanel interactive={false}>{files.loading ? <LoadingRows rows={6} /> : <ResourceError error={files.error} title="The library could not be loaded" onRetry={() => void files.refresh()} />}</FxPanel>
              ) : list.length === 0 ? (
                <FxPanel interactive={false}>
                  <EmptyState
                    icon={<Library className="size-6" />}
                    title={filtering ? 'No files match your filters' : 'Your library is empty'}
                    {...(canWrite ? { message: 'Upload files or drag and drop them here.', action: <Button size="sm" variant="primary" icon={<FileUp className="size-4" />} onClick={() => setFileDrawer({ file: null })}>Upload file</Button> } : {})}
                  />
                </FxPanel>
              ) : viewMode === 'grid' ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map((file) => (
                    <article key={file.id} draggable={canWrite} onDragStart={() => setDraggedFileId(file.id)} onDragEnd={() => setDraggedFileId(null)} onClick={() => openFile(file)} className="glow-hover group relative flex min-w-0 cursor-pointer flex-col gap-3 rounded-panel border border-border bg-surface p-4 hover:border-accent">
                      {canWrite ? <GripVertical aria-hidden="true" className="absolute left-0.5 top-6 size-4 text-text-muted opacity-0 group-hover:opacity-100" /> : null}
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent">{fileIcon(file.mimeType)}</span>
                        <div className="min-w-0">
                          <h4 className="m-0 truncate text-sm font-semibold">{file.name}</h4>
                          <p className="m-0 truncate text-xs text-text-muted">{file.fileName}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge>{mimeLabel(file.mimeType)}</Badge>
                        <span className="num text-xs text-text-muted">{formatBytes(file.sizeBytes)}</span>
                        {file.category ? <CategoryChip category={file.category} /> : null}
                      </div>
                      {file.tags.length > 0 ? <div className="flex flex-wrap gap-1">{file.tags.map((tag) => <span key={tag} className="rounded-pill bg-surface-sunken px-2 py-0.5 text-xs text-text-muted">{tag}</span>)}</div> : null}
                      <div className="mt-auto flex flex-wrap items-center justify-between gap-1 text-xs text-text-muted">
                        <span title={file.updatedAt}>{relativeTime(file.updatedAt)}</span>
                        <div className={revealed}>{rowActions(file)}</div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="grid divide-y divide-border rounded-panel border border-border bg-surface">
                  {list.map((file) => (
                    <div key={file.id} draggable={canWrite} onDragStart={() => setDraggedFileId(file.id)} onDragEnd={() => setDraggedFileId(null)} onClick={() => openFile(file)} className="fx-rail group flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 hover:bg-surface-hover">
                      {canWrite ? <GripVertical aria-hidden="true" className="hidden size-4 shrink-0 text-text-muted opacity-0 group-hover:opacity-100 lg:block" /> : null}
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent">{fileIcon(file.mimeType)}</span>
                      <div className="min-w-0 flex-1 basis-48">
                        <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{file.name}</span><span className="text-xs text-text-muted">{file.fileName}</span></div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2">
                          <Badge>{mimeLabel(file.mimeType)}</Badge>
                          <span className="num text-xs text-text-muted">{formatBytes(file.sizeBytes)}</span>
                          {file.category ? <CategoryChip category={file.category} /> : null}
                          {file.tags.map((tag) => <span key={tag} className="text-xs text-text-muted">#{tag}</span>)}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-text-muted" title={file.updatedAt}>{relativeTime(file.updatedAt)}</span>
                      <div className={cn('shrink-0', revealed)}>{rowActions(file)}</div>
                    </div>
                  ))}
                </div>
              )}
              {files.data?.meta.hasMore ? <div className="mt-3 flex items-center justify-center gap-3"><span className="text-sm text-text-muted">Showing {list.length} of {files.data.meta.total}</span><Button size="sm" loading={files.refreshing} onClick={() => setLimit((value) => value + PAGE_SIZE)}>Show more</Button></div> : null}
            </div>
          </div>
        </div>
      </PageItem>
      <CategoryDrawer open={!!categoryDrawer} category={categoryDrawer?.category ?? null} onClose={() => setCategoryDrawer(null)} onSaved={refreshAll} />
      <FileDrawer open={!!fileDrawer} file={fileDrawer?.file ?? null} categories={categoryList} initialCategoryId={selected && selected !== UNCATEGORIZED ? selected : ''} onClose={() => setFileDrawer(null)} onSaved={refreshAll} />
      <FileViewerDrawer file={viewer} onClose={() => setViewer(null)} />
      <DeployDrawer file={deploying} onClose={() => setDeploying(null)} />
      <ConfirmDialog open={!!deletingCategory} title="Delete category" message={deletingCategory ? `Delete category "${deletingCategory.name}"? Its files become uncategorized.` : ''} loading={deleteBusy} onConfirm={() => void confirmDeleteCategory()} onCancel={() => setDeletingCategory(null)} />
      <ConfirmDialog open={!!deletingFile} title="Delete file" message={deletingFile ? `Delete "${deletingFile.name}" (${deletingFile.fileName})?` : ''} loading={deleteBusy} onConfirm={() => void confirmDeleteFile()} onCancel={() => setDeletingFile(null)} />
    </div>
  );
}
