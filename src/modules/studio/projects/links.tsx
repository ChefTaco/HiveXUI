import { useState, type FormEvent, type ReactNode } from 'react';
import { ExternalLink, Link2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { isReferenceUrl } from '@contracts/ardentstudio.generated';
import { Badge, Button, ConfirmDialog, EmptyState, Field, IconButton, TextArea, TextInput } from '@ui';
import { errorMessage } from '../../magnus/api/errors';
import { idempotencyKey, StudioApiError } from '../api/client';
import { createLink, deleteLink, reindexLink, updateLink, type ReferenceLink } from '../api/endpoints';
import type { ProjectStore } from '../state/project-store';
import { KNOWLEDGE_LABEL, KNOWLEDGE_TONE } from './logic';

const MAX_TITLE = 200;
const MAX_NOTE = 4000;

/** The URL as the service stores it (WHATWG serialization), so two spellings of one page compare equal. */
export function normalizeUrl(value: string): string {
  try {
    return new URL(value.trim()).href;
  } catch {
    return value.trim();
  }
}

/** A title from the address alone, suggested in the empty title field and used when it stays empty: host and path. */
export function titleFromUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    return (url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/+$/, '')).slice(0, MAX_TITLE);
  } catch {
    return '';
  }
}

interface LinkDraft {
  url: string;
  title: string;
  note: string;
}
const emptyDraft = (): LinkDraft => ({ url: '', title: '', note: '' });

/** Problems that stop a link from being sent, by field. */
export function linkErrors(draft: LinkDraft): Partial<Record<'url' | 'title', string>> {
  const errors: Partial<Record<'url' | 'title', string>> = {};
  if (!draft.url.trim()) errors.url = 'Enter the address.';
  else if (draft.url.trim().length > 2048 || !isReferenceUrl(draft.url.trim())) errors.url = 'Use an http or https address without a user name or password.';
  if (!draft.title.trim() && !titleFromUrl(draft.url)) errors.title = 'Give the link a title.';
  return errors;
}

const isDuplicate = (error: unknown) => error instanceof StudioApiError && error.code === 'LINK_EXISTS';

function LinkForm({
  initial,
  submitLabel,
  busy,
  duplicate,
  failure,
  onSubmit,
  onCancel,
  onShowDuplicate,
}: {
  initial: LinkDraft;
  submitLabel: string;
  busy: boolean;
  /** The link this project already holds at the entered address. */
  duplicate: ReferenceLink | 'unknown' | null;
  failure: string | null;
  onSubmit: (draft: LinkDraft) => void;
  onCancel?: () => void;
  onShowDuplicate?: (link: ReferenceLink) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [touched, setTouched] = useState(false);
  const errors = linkErrors(draft);
  const set = (field: keyof LinkDraft, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) return;
    // An empty title takes the one the field suggests from the address.
    onSubmit(draft.title.trim() ? draft : { ...draft, title: titleFromUrl(draft.url) });
  };
  return (
    <form className="studio-link-form" onSubmit={submit} noValidate>
      <div className="form-grid">
        <Field label="Address">
          <TextInput
            type="url"
            inputMode="url"
            value={draft.url}
            onChange={(value) => set('url', value)}
            maxLength={2048}
            placeholder="https://example.com/source"
            aria-invalid={touched && Boolean(errors.url)}
          />
        </Field>
        <Field label="Title">
          <TextInput value={draft.title} onChange={(value) => set('title', value)} maxLength={MAX_TITLE} placeholder={titleFromUrl(draft.url) || 'What the page is'} aria-invalid={touched && Boolean(errors.title)} />
        </Field>
      </div>
      <Field label="Note" hint="Optional. Why the team should read it; indexed with the title and address.">
        <TextArea value={draft.note} onChange={(value) => set('note', value)} rows={2} maxLength={MAX_NOTE} />
      </Field>
      {touched && (errors.url || errors.title) ? (
        <p role="alert" className="m-0 text-sm text-danger">
          {[errors.url, errors.title].filter(Boolean).join(' ')}
        </p>
      ) : null}
      {duplicate ? (
        <p role="alert" className="studio-link-form__duplicate m-0 text-sm text-warning">
          <span>{duplicate === 'unknown' ? 'This project already has a link to this address.' : `This project already has this address as “${duplicate.title}”.`}</span>
          {duplicate !== 'unknown' && onShowDuplicate ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => onShowDuplicate(duplicate)}>
              Edit that link
            </Button>
          ) : null}
        </p>
      ) : null}
      {failure ? <p role="alert" className="m-0 text-sm text-danger">{failure}</p> : null}
      <div className="studio-link-form__actions">
        {onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" size="sm" variant={onCancel ? 'primary' : 'default'} loading={busy} icon={onCancel ? undefined : <Plus className="size-4" />}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function LinkRow({
  link,
  readOnly,
  busy,
  editing,
  onEdit,
  onDelete,
  onReindex,
  children,
}: {
  link: ReferenceLink;
  readOnly: boolean;
  busy: boolean;
  editing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onReindex: () => void;
  children?: ReactNode;
}) {
  const { state, error } = link.knowledge;
  const working = state === 'pending' || state === 'indexing';
  // Only an http or https address is ever rendered as a link.
  const safe = isReferenceUrl(link.url);
  return (
    <li className="studio-link border-b border-border" data-link-id={link.id}>
      <div className="studio-link__row">
        <Link2 className="size-4 flex-none text-text-muted" aria-hidden="true" />
        <div className="studio-link__main">
          {safe ? (
            <a href={link.url} target="_blank" rel="noopener noreferrer" className="studio-link__title cell-strong text-text-strong hover:text-accent">
              {link.title}
              <ExternalLink className="size-3" aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <span className="studio-link__title cell-strong">{link.title}</span>
          )}
          <span className="studio-link__url text-xs text-text-muted">{link.url}</span>
          {link.note_md ? <span className="studio-link__note text-xs">{link.note_md}</span> : null}
          {state === 'failed' && error ? <span className="text-xs text-danger">{error}</span> : null}
        </div>
        <span className="studio-file__state">
          <Badge tone={KNOWLEDGE_TONE[state]}>
            {working ? <span className="spinner" aria-hidden="true" /> : null}
            {KNOWLEDGE_LABEL[state]}
          </Badge>
          {readOnly ? null : state === 'failed' ? (
            <Button size="sm" icon={<RefreshCw className="size-4" />} loading={busy} onClick={onReindex}>
              Retry
            </Button>
          ) : (
            <IconButton label={`Index ${link.title} again`} icon={<RefreshCw className="size-4" />} disabled={busy || working} onClick={onReindex} />
          )}
          {readOnly ? null : (
            <>
              <IconButton label={`Edit ${link.title}`} icon={<Pencil className="size-4" />} aria-expanded={editing} onClick={onEdit} />
              <IconButton label={`Remove ${link.title}`} variant="danger" icon={<Trash2 className="size-4" />} onClick={onDelete} />
            </>
          )}
        </span>
      </div>
      {children}
    </li>
  );
}

/**
 * A project's link references: add, edit, remove and index again. Studio stores the title, address
 * and note and indexes them into the project's HiveMem workspace; it never fetches the page.
 */
export function LinkManager({ store, links, readOnly = false }: { store: ProjectStore; links: readonly ReferenceLink[]; readOnly?: boolean }) {
  const [adding, setAdding] = useState(false);
  const [addFailure, setAddFailure] = useState<string | null>(null);
  const [addDuplicate, setAddDuplicate] = useState<ReferenceLink | 'unknown' | null>(null);
  // The form remounts after each link is added, which also clears it.
  const [formKey, setFormKey] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editFailure, setEditFailure] = useState<string | null>(null);
  const [editDuplicate, setEditDuplicate] = useState<ReferenceLink | 'unknown' | null>(null);
  const [removing, setRemoving] = useState<ReferenceLink | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [reindexing, setReindexing] = useState<ReadonlySet<string>>(new Set());
  const existing = (url: string, except?: string) => links.find((link) => link.id !== except && normalizeUrl(link.url) === normalizeUrl(url)) ?? 'unknown';

  async function add(draft: LinkDraft) {
    setAdding(true);
    setAddFailure(null);
    setAddDuplicate(null);
    try {
      store.upsertLink(await createLink(store.projectId, { url: draft.url.trim(), title: draft.title.trim(), note_md: draft.note }, idempotencyKey()));
      setFormKey((key) => key + 1);
    } catch (error) {
      if (isDuplicate(error)) setAddDuplicate(existing(draft.url));
      else setAddFailure(errorMessage(error, 'The link could not be added'));
    } finally {
      setAdding(false);
    }
  }

  async function save(link: ReferenceLink, draft: LinkDraft) {
    const body = {
      ...(normalizeUrl(draft.url) !== link.url ? { url: draft.url.trim() } : {}),
      ...(draft.title.trim() !== link.title ? { title: draft.title.trim() } : {}),
      ...(draft.note !== link.note_md ? { note_md: draft.note } : {}),
    };
    if (!Object.keys(body).length) {
      setEditing(null);
      return;
    }
    setEditBusy(true);
    setEditFailure(null);
    setEditDuplicate(null);
    try {
      store.upsertLink(await updateLink(link.id, body, idempotencyKey()));
      setEditing(null);
    } catch (error) {
      if (isDuplicate(error)) setEditDuplicate(existing(draft.url, link.id));
      else setEditFailure(errorMessage(error, 'The link could not be saved'));
    } finally {
      setEditBusy(false);
    }
  }

  async function reindex(link: ReferenceLink) {
    setRowError(null);
    setReindexing((current) => new Set(current).add(link.id));
    try {
      store.upsertLink(await reindexLink(link.id, idempotencyKey()));
    } catch (error) {
      setRowError(`${link.title}: ${errorMessage(error, 'Indexing could not be queued again')}`);
    } finally {
      setReindexing((current) => new Set([...current].filter((id) => id !== link.id)));
    }
  }

  async function remove() {
    const link = removing;
    if (!link) return;
    setRemoveBusy(true);
    setRowError(null);
    try {
      store.upsertLink(await deleteLink(link.id, idempotencyKey()));
      if (editing === link.id) setEditing(null);
    } catch (error) {
      setRowError(`${link.title}: ${errorMessage(error, 'The link could not be removed')}`);
    } finally {
      setRemoveBusy(false);
      setRemoving(null);
    }
  }

  const startEdit = (link: ReferenceLink) => {
    setEditing((current) => (current === link.id ? null : link.id));
    setEditFailure(null);
    setEditDuplicate(null);
  };

  return (
    <div className="studio-links">
      {readOnly ? null : (
        <div className="studio-link-add rounded-panel border border-border bg-surface-sunken">
          <LinkForm
            key={formKey}
            initial={emptyDraft()}
            submitLabel="Add link"
            busy={adding}
            duplicate={addDuplicate}
            failure={addFailure}
            onSubmit={(draft) => void add(draft)}
            onShowDuplicate={(link) => {
              setAddDuplicate(null);
              startEdit(link);
            }}
          />
        </div>
      )}
      {rowError ? <p role="alert" className="m-0 text-sm text-danger">{rowError}</p> : null}
      {links.length ? (
        <ul className="studio-file-list" aria-label="Links" aria-live="polite">
          {links.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              readOnly={readOnly}
              busy={reindexing.has(link.id)}
              editing={editing === link.id}
              onEdit={() => startEdit(link)}
              onDelete={() => setRemoving(link)}
              onReindex={() => void reindex(link)}
            >
              {editing === link.id && !readOnly ? (
                <div className="studio-link__edit">
                  <LinkForm
                    initial={{ url: link.url, title: link.title, note: link.note_md }}
                    submitLabel="Save link"
                    busy={editBusy}
                    duplicate={editDuplicate}
                    failure={editFailure}
                    onSubmit={(draft) => void save(link, draft)}
                    onCancel={() => setEditing(null)}
                  />
                </div>
              ) : null}
            </LinkRow>
          ))}
        </ul>
      ) : readOnly ? (
        <EmptyState compact title="No links" message="This project has no link references." />
      ) : (
        <p className="m-0 text-sm text-text-muted">No links yet. Studio indexes each link’s title, address and note so agents can find it; it does not fetch the page.</p>
      )}
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.title ?? 'link'}?`}
        message="The link leaves the project and its entry is removed from the project's knowledge. Agents can no longer find it."
        confirmLabel="Remove link"
        loading={removeBusy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
