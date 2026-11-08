// The room composer: who answers (Team, the coordinator or a role), @mentions with autocomplete, a
// thread or reply target, and attachments uploaded to the project or picked from its files. Each send
// carries one idempotency key, kept through retries of the same message, so a retry never posts twice.
import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useReducer, useRef, useState, type KeyboardEvent } from 'react';
import { FileText, Paperclip, Send, Upload, X } from 'lucide-react';
import { Button } from '@ui';
import { cn } from '@lib/cn';
import { attachmentDrafts, ChatAttachmentUploads, clipboardAttachments, completeMention, MAX_CHAT_ATTACHMENTS, mentionAtCaret } from '@lib/chat-compose';
import { errorMessage } from '../../magnus/api/errors';
import { idempotencyKey } from '../api/client';
import { createConversation, postMessage, uploadFile, type Conversation, type Message, type StudioFile } from '../api/endpoints';
import { uploadMime } from '../projects/logic';
import type { ProjectStore } from '../state/project-store';
import { addressing, mentionChoices, postBody, recipientOptions, type RecipientChoice, type Role } from './addressing';
import { authorOf, quote } from './transcript';

export interface ReplyTarget {
  message: Message;
  /** Reply in the message's thread, rather than a plain reply that quotes it. */
  thread: boolean;
}

export interface ComposerHandle {
  focus: () => void;
  /** Starts a draft that mentions a role, as Message directly does in a team conversation. */
  address: (choice: RecipientChoice) => void;
}

export interface ComposerProps {
  store: ProjectStore;
  conversation: Conversation | null;
  roles: readonly Role[];
  files: readonly StudioFile[];
  archived: boolean;
  reply: ReplyTarget | null;
  onClearReply: () => void;
  /** The team conversation was created by this send. */
  onConversation: (conversation: Conversation) => void;
  onSent: (message: Message) => void;
}

const uploads = new ChatAttachmentUploads();
const NO_FILES: readonly File[] = [];

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({ store, conversation, roles, files, archived, reply, onClearReply, onConversation, onSent }, ref) {
  const draftKey = conversation?.id ?? 'team';
  const [body, setBody] = useState('');
  const [choice, setChoice] = useState<RecipientChoice>('team');
  const [drafts, dispatch] = useReducer(attachmentDrafts, {});
  const [picked, setPicked] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [activeMention, setActiveMention] = useState(0);
  const sendKey = useRef<string | null>(null);
  const teamKey = useRef<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const ids = { text: useId(), to: useId(), list: useId(), hint: useId(), pick: useId() };
  const draftFiles = drafts[draftKey]?.files;
  const local = draftFiles ?? NO_FILES;
  const references = files.filter((file) => file.purpose !== 'avatar');
  const bound = roles.filter((role) => role.agent_ref);
  const choices = mention ? mentionChoices(roles, mention.query) : [];
  const route = useMemo(() => addressing(conversation, choice, body, roles), [conversation, choice, body, roles]);
  const total = local.length + picked.length;

  useImperativeHandle(ref, () => ({
    focus: () => textarea.current?.focus(),
    address: (next) => {
      setChoice(next);
      textarea.current?.focus();
    },
  }));
  // A new draft or target is a new message: it gets a new key when sent.
  useEffect(() => {
    sendKey.current = null;
  }, [body, choice, draftFiles, picked, reply, draftKey]);
  useEffect(() => {
    setPicked([]);
    setError(null);
  }, [draftKey]);
  useEffect(() => {
    if (reply) textarea.current?.focus();
  }, [reply]);

  const fileError = drafts[draftKey]?.error;
  function addFiles(list: readonly File[]) {
    const accepted = list.filter((file) => uploadMime(file));
    if (accepted.length < list.length) setError('Some files were not added: attach Markdown, text, CSV, JSON, DOCX, PDF or images.');
    else setError(null);
    if (accepted.length + picked.length + local.length > MAX_CHAT_ATTACHMENTS) {
      setError(`You can attach up to ${MAX_CHAT_ATTACHMENTS} files. Remove a file before adding more.`);
      return;
    }
    dispatch({ type: 'append', key: draftKey, files: accepted, blocked: busy });
  }

  function updateMention(value: string, caret: number) {
    const found = mentionAtCaret(value, caret);
    setMention(found);
    setActiveMention(0);
  }

  function chooseMention(role: Role) {
    if (!mention || !textarea.current) return;
    const caret = textarea.current.selectionStart ?? body.length;
    const next = completeMention(body, caret, mention.start, role.key);
    setBody(next.draft);
    setMention(null);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(next.caret, next.caret);
    });
  }

  async function send() {
    if (busy || archived) return;
    if (!body.trim()) {
      setError('Write a message first.');
      return;
    }
    if (route.problem) {
      setError(route.problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let target = conversation;
      if (!target) {
        teamKey.current ??= idempotencyKey();
        target = await createConversation(store.projectId, { kind: 'team' }, teamKey.current);
        teamKey.current = null;
        store.upsertRecord('conversations', target);
        onConversation(target);
      }
      const uploaded = await uploads.resolve(`${store.projectId}:${draftKey}`, local, async (file) => {
        const created = await uploadFile(store.projectId, file, file.name, uploadMime(file)!, idempotencyKey(), 'attachment');
        store.upsertFile(created);
        return created.id;
      });
      sendKey.current ??= idempotencyKey();
      const result = await postMessage(
        target.id,
        postBody({ body, choice, replyTo: reply?.message.id ?? null, threadRoot: reply?.thread ? (reply.message.thread_root ?? reply.message.id) : null, attachments: [...picked, ...uploaded] }),
        sendKey.current,
      );
      sendKey.current = null;
      uploads.clear(`${store.projectId}:${draftKey}`);
      for (const task of result.tasks) store.upsertRecord('tasks', task);
      setBody('');
      setPicked([]);
      dispatch({ type: 'clear', key: draftKey });
      onClearReply();
      onSent(result.message);
    } catch (failure) {
      setError(errorMessage(failure, 'The message could not be sent. Try again: it will not be posted twice.'));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (choices.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveMention((index) => (index + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        chooseMention(choices[activeMention] ?? choices[0]!);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMention(null);
        return;
      }
    }
    if (event.key === 'Escape' && reply) {
      event.preventDefault();
      onClearReply();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  if (archived) return <p className="room-composer room-composer--closed m-0 text-sm text-text-muted">This project is archived. Reopen it to write in the room.</p>;
  if (conversation?.stopped_at) return <p className="room-composer room-composer--closed m-0 text-sm text-text-muted">This conversation was stopped. Its transcript stays here to read.</p>;

  const fixed = conversation?.kind === 'direct' || conversation?.kind === 'discussion';
  const replyAuthor = reply ? authorOf(reply.message, roles).name : '';
  return (
    <form
      className="room-composer"
      aria-label="Write a message"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div className="room-composer__bar">
        {fixed ? (
          <span className="text-xs text-text-muted">{conversation?.kind === 'direct' ? `To ${roles.find((role) => role.key === conversation.role_key)?.name ?? conversation.role_key}` : 'Note to the discussion'}</span>
        ) : (
          <label className="room-composer__to text-xs text-text-muted" htmlFor={ids.to}>
            To
            <select id={ids.to} className="room-select" value={choice} onChange={(event) => setChoice(event.target.value as RecipientChoice)}>
              {recipientOptions(bound.length ? bound : roles).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <span id={ids.hint} className={cn('room-composer__route text-xs', route.problem ? 'text-warning' : 'text-text-muted')}>
          {route.problem ?? route.summary}
          <span className="sr-only"> Enter sends, Shift+Enter starts a new line.</span>
        </span>
      </div>
      {reply ? (
        <div className="room-composer__reply rounded-control border border-border bg-surface text-xs text-text-muted">
          <span>{`${reply.thread ? 'In thread with' : 'Replying to'} ${replyAuthor}: ${quote(reply.message.body_md, 60)}`}</span>
          <button type="button" className="room-action text-text-muted hover:text-text" aria-label="Cancel reply" onClick={onClearReply}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <div className="room-composer__field">
        <label className="sr-only" htmlFor={ids.text}>
          Message
        </label>
        <textarea
          ref={textarea}
          id={ids.text}
          className="room-composer__input"
          rows={2}
          value={body}
          placeholder={fixed ? 'Write a message' : 'Write to the team. Type @ to mention a role.'}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={choices.length > 0}
          aria-controls={choices.length ? ids.list : undefined}
          aria-activedescendant={choices.length ? `${ids.list}-${activeMention}` : undefined}
          aria-describedby={ids.hint}
          onChange={(event) => {
            setBody(event.target.value);
            updateMention(event.target.value, event.target.selectionStart ?? event.target.value.length);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setMention(null)}
          onPaste={(event) => {
            const pasted = clipboardAttachments(event.clipboardData);
            if (!pasted.length) return;
            event.preventDefault();
            addFiles(pasted);
          }}
        />
        {choices.length ? (
          <ul id={ids.list} role="listbox" aria-label="Roles to mention" className="room-mentions rounded-control border border-border-strong bg-surface-raised">
            {choices.map((role, index) => (
              <li
                key={role.key}
                id={`${ids.list}-${index}`}
                role="option"
                aria-selected={index === activeMention}
                className={cn('room-mentions__item rounded-control text-sm', index === activeMention ? 'bg-accent-soft text-accent' : 'text-text')}
                onMouseDown={(event) => {
                  event.preventDefault();
                  chooseMention(role);
                }}
              >
                <span>{`@${role.key}`}</span>
                <span className="text-xs text-text-muted">{role.name}{role.agent_ref ? '' : ' · no agent'}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {total ? (
        <ul className="room-attachments" aria-label="Attached files">
          {local.map((file) => (
            <li key={`${file.name}-${file.lastModified}-${file.size}`} className="room-chip rounded-chip border border-border bg-surface text-xs text-text">
              <Upload className="size-3" aria-hidden="true" />
              {file.name}
              <button type="button" className="room-action text-text-muted hover:text-text" aria-label={`Remove ${file.name}`} onClick={() => dispatch({ type: 'remove', key: draftKey, file, blocked: busy })}>
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
          {picked.map((id) => {
            const file = references.find((item) => item.id === id);
            return (
              <li key={id} className="room-chip rounded-chip border border-border bg-surface text-xs text-text">
                <FileText className="size-3" aria-hidden="true" />
                {file?.name ?? 'Project file'}
                <button type="button" className="room-action text-text-muted hover:text-text" aria-label={`Remove ${file?.name ?? 'file'}`} onClick={() => setPicked((list) => list.filter((item) => item !== id))}>
                  <X className="size-3" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {picking ? (
        <fieldset id={ids.pick} className="room-picker rounded-control border border-border bg-surface">
          <legend className="text-xs text-text-muted">Project files</legend>
          {references.length ? (
            references.map((file) => (
              <label key={file.id} className="check-field text-sm">
                <input
                  type="checkbox"
                  checked={picked.includes(file.id)}
                  disabled={!picked.includes(file.id) && total >= MAX_CHAT_ATTACHMENTS}
                  onChange={(event) => setPicked((list) => (event.target.checked ? [...list, file.id] : list.filter((item) => item !== file.id)))}
                />
                {file.name}
              </label>
            ))
          ) : (
            <p className="m-0 text-sm text-text-muted">This project has no files yet. Upload one instead.</p>
          )}
        </fieldset>
      ) : null}
      {error || fileError ? (
        <p className="m-0 text-sm text-danger" role="alert">
          {error ?? fileError}
        </p>
      ) : null}
      <div className="room-composer__actions">
        <input
          ref={fileInput}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            addFiles([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
        <Button type="button" size="sm" variant="ghost" icon={<Paperclip className="btn-ico" aria-hidden="true" />} onClick={() => fileInput.current?.click()} disabled={busy}>
          Upload
        </Button>
        <Button type="button" size="sm" variant="ghost" icon={<FileText className="btn-ico" aria-hidden="true" />} aria-expanded={picking} aria-controls={picking ? ids.pick : undefined} onClick={() => setPicking((value) => !value)}>
          Project files
        </Button>
        <span className="room-composer__count text-xs text-text-muted">{total ? `${total} of ${MAX_CHAT_ATTACHMENTS} files` : null}</span>
        <Button type="submit" size="sm" variant="primary" loading={busy} icon={<Send className="btn-ico" aria-hidden="true" />}>
          Send
        </Button>
      </div>
    </form>
  );
});
