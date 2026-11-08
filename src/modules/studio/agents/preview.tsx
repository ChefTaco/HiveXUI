import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, MessageSquarePlus, Send, Square } from 'lucide-react';
import { Badge, Button, ConfirmDialog, Field, Panel, TextArea, TextInput, Toggle } from '@ui';
import { adminApi } from '@lib/api';
import { cn } from '@lib/cn';
import { productInstalled } from '../../../lib/runtime';
import { errorMessage } from '../../magnus/api/errors';
import { useMagnusResource } from '../../magnus/api/use-resource';
import { readResource } from '../../magnus/pages/agents/ardent/api';
import { profileHref, taskIsFinal } from '../../magnus/pages/agents/ardent/logic';
import { identityFileName } from '../../magnus/pages/agents/ardent/profile/editors';
import { revisionedTextSchema, skillsSchema, taskListSchema } from '../../magnus/pages/agents/ardent/schemas';
import { idempotencyKey } from '../api/client';
import { StudioLink } from '../link';
import { applyDraft, discardDraft, getDraft, putDraft, type AgentDraft, type ApplyResponse } from './api';
import {
  APPLY_CODE_TEXT,
  applySummary,
  baseFor,
  bodyFrom,
  busyNotice,
  draftIsEmpty,
  draftParts,
  fieldsFrom,
  needsRebase,
  PART_LABEL,
  RESULT_TEXT,
  sameBody,
  type AgentNow,
  type DraftFields,
} from './logic';
import type { AgentContext } from './page';
import { previewFinished, previewText, runPreview, startPreview, type PreviewRun } from './preview-stream';
import { Loaded } from './shared';

interface AgentState extends AgentNow {
  draft: AgentDraft | null;
}

async function readAgent(context: AgentContext, signal?: AbortSignal): Promise<AgentState> {
  const { nodeId, profileId, agentRef } = context;
  const [soul, identity, skills, config, draft] = await Promise.all([
    readResource(nodeId, profileId, 'identity/soul', revisionedTextSchema, signal),
    readResource(nodeId, profileId, 'identity/identity', revisionedTextSchema, signal),
    readResource(nodeId, profileId, 'skills', skillsSchema, signal),
    readResource(nodeId, profileId, 'config', revisionedTextSchema, signal),
    getDraft(agentRef, signal),
  ]);
  return { soul, identity, skills: skills.skills, configRevision: config.revision, draft };
}

/** The per-part outcome of Apply, as the service reports it, including refusals and restarts. */
export function ApplyResults({ response, fleetHref, onRebase, rebasing }: { response: ApplyResponse; fleetHref: string; onRebase?: (() => void) | undefined; rebasing?: boolean }) {
  const summary = applySummary(response.results);
  return (
    <div className="agent-apply grid gap-2 rounded-control border border-border bg-surface-sunken p-3" role="status" aria-label="Apply results">
      <p className={cn('m-0 text-sm font-semibold', summary.tone === 'danger' ? 'text-danger' : summary.tone === 'warning' ? 'text-warning' : summary.tone === 'success' ? 'text-success' : 'text-text')}>{summary.text}</p>
      <ul className="agent-list">
        {response.results.map((result) => {
          const status = RESULT_TEXT[result.status];
          const plain = result.code ? APPLY_CODE_TEXT[result.code] : undefined;
          return (
            <li key={result.part} className="agent-apply__row text-sm">
              <span className="font-medium">{PART_LABEL[result.part]}</span>
              <Badge tone={status.tone}>{status.label}</Badge>
              {result.status === 'applied' && result.activation_required ? <Badge tone="warning">Needs a restart</Badge> : null}
              {result.revision ? <span className="font-mono text-xs text-text-muted">rev {result.revision.slice(0, 8)}</span> : null}
              {plain || result.error ? (
                <span className="agent-apply__error text-xs">
                  {plain ? <span className="block text-text">{plain}</span> : null}
                  {result.error ? (
                    <span className="block text-text-muted">
                      {result.error}
                      {result.code ? <span className="font-mono"> ({result.code})</span> : null}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {onRebase && needsRebase(response.results) ? (
        <Button size="sm" className="justify-self-start" loading={rebasing} onClick={onRebase}>
          Reload the agent as the draft&apos;s base
        </Button>
      ) : null}
      {response.activation_required ? (
        <div className="warning-banner grid gap-1 text-sm">
          <p className="m-0 font-semibold">Restart the profile from the Magnus console to activate the new skills or model.</p>
          {response.restart.reason ? <p className="m-0 text-xs">{response.restart.reason}</p> : null}
          <StudioLink href={fleetHref} className="justify-self-start text-sm">
            Open the profile in Fleet details
            <ArrowUpRight className="ml-1 inline size-3" aria-hidden="true" />
          </StudioLink>
        </div>
      ) : null}
      {response.active_tasks > 0 ? <p className="m-0 text-xs text-text-muted">{busyNotice(response.active_tasks)}</p> : null}
      {response.note ? <p className="m-0 text-xs text-text-muted">{response.note}</p> : null}
    </div>
  );
}

function ModelField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const listId = useId();
  const enabled = productInstalled('emberpath');
  const aliases = useMagnusResource(async () => (await adminApi.aliases()).data, [], { enabled });
  return (
    <Field label="Model" hint="An Emberpath alias or a model name. Previews use it at once; Apply sets it as the agent's model, which takes effect after the profile restarts. Empty keeps the agent's own model.">
      <TextInput value={value} onChange={onChange} maxLength={200} spellCheck={false} autoComplete="off" placeholder="Agent's own model" list={aliases.data?.length ? listId : undefined} />
      {aliases.data?.length ? (
        <datalist id={listId}>
          {aliases.data.filter((alias) => alias.enabled).map((alias) => (
            <option key={alias.id} value={alias.alias} />
          ))}
        </datalist>
      ) : null}
    </Field>
  );
}

/** The draft: SOUL, IDENTITY, skills and model, saved per person on the Studio service. */
function DraftEditor({ context, initial, running, onDraft }: { context: AgentContext; initial: AgentState; running: number; onDraft: (saved: boolean) => void }) {
  const [now, setNow] = useState<AgentNow>(initial);
  const [saved, setSaved] = useState<AgentDraft | null>(initial.draft);
  const [fields, setFields] = useState<DraftFields>(() => fieldsFrom(initial.draft?.draft, initial));
  const [busy, setBusy] = useState<'save' | 'apply' | 'discard' | 'rebase' | null>(null);
  const [confirm, setConfirm] = useState<'apply' | 'discard' | null>(null);
  const [applied, setApplied] = useState<ApplyResponse | null>(null);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const body = bodyFrom(fields, now);
  const savedBody = saved?.draft ?? {};
  const dirty = !sameBody(body, savedBody);
  const parts = draftParts(dirty ? body : savedBody);
  const skillNames = [...new Set([...now.skills.map((skill) => skill.name), ...fields.skills])].sort();
  useEffect(() => onDraft(Boolean(saved) && !dirty), [saved, dirty, onDraft]);

  const set = (next: Partial<DraftFields>) => {
    setFields((current) => ({ ...current, ...next }));
    setFeedback('');
  };

  /** Saves the editor as the draft, or removes the draft when nothing differs. */
  async function persist(): Promise<AgentDraft | null> {
    if (draftIsEmpty(body)) {
      if (saved) await discardDraft(context.agentRef, idempotencyKey());
      setSaved(null);
      return null;
    }
    const next = await putDraft(context.agentRef, { base: baseFor(body, now, saved), draft: body }, idempotencyKey());
    setSaved(next);
    return next;
  }

  async function save() {
    setBusy('save');
    setError('');
    setFeedback('');
    try {
      const next = await persist();
      setFeedback(next ? 'Draft saved. Nothing on the agent has changed.' : 'The draft matched the agent, so it was removed.');
    } catch (caught) {
      setError(errorMessage(caught, 'The draft could not be saved'));
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    setConfirm(null);
    setBusy('apply');
    setError('');
    setFeedback('');
    try {
      const draft = dirty ? await persist() : saved;
      if (!draft) {
        setFeedback('Nothing differs from the agent, so there is nothing to apply.');
        return;
      }
      const response = await applyDraft(context.agentRef, draftParts(draft.draft), idempotencyKey());
      setApplied(response);
      setSaved(response.draft);
      // Read the agent again so the editor shows what it now has, plus whatever stayed in the draft.
      const fresh = await readAgent(context).catch(() => null);
      if (fresh) {
        setNow(fresh);
        setFields(fieldsFrom(response.draft?.draft, fresh));
      }
    } catch (caught) {
      setError(errorMessage(caught, 'The draft could not be applied'));
    } finally {
      setBusy(null);
    }
  }

  /** After a conflict: the same draft, based on the agent as it is now. Apply then overwrites that version. */
  async function rebase() {
    if (!saved) return;
    setBusy('rebase');
    setError('');
    setFeedback('');
    try {
      const fresh = await readAgent(context);
      const next = await putDraft(context.agentRef, { base: baseFor(saved.draft, fresh, null), draft: saved.draft }, idempotencyKey());
      setNow(fresh);
      setSaved(next);
      setApplied(null);
      setFeedback('The draft now builds on the agent as it is. Check the draft against it, then apply again.');
    } catch (caught) {
      setError(errorMessage(caught, 'The agent could not be reloaded'));
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    setConfirm(null);
    setBusy('discard');
    setError('');
    setFeedback('');
    try {
      if (saved) await discardDraft(context.agentRef, idempotencyKey());
      setSaved(null);
      setFields(fieldsFrom(null, now));
      setApplied(null);
      setFeedback('Draft discarded.');
    } catch (caught) {
      setError(errorMessage(caught, 'The draft could not be discarded'));
    } finally {
      setBusy(null);
    }
  }

  const state = saved ? (dirty ? 'Unsaved changes' : 'Draft saved') : dirty ? 'Unsaved changes' : 'No draft';
  return (
    <Panel
      title="Draft"
      description="Edit freely: previews use the saved draft, and the agent changes only when you apply it."
      actions={<Badge tone={dirty ? 'warning' : saved ? 'info' : 'neutral'}>{state}</Badge>}
      className="agent-draft min-w-0"
    >
      <div className="grid gap-4">
        {(['soul', 'identity'] as const).map((kind) => (
          <Field key={kind} label={identityFileName(kind)} hint={fields[kind] === now[kind].text ? 'Same as the agent.' : 'Changed in this draft.'}>
            <TextArea value={fields[kind]} onChange={(value) => set({ [kind]: value })} spellCheck={false} className="agent-draft__text font-mono text-xs" />
          </Field>
        ))}
        <fieldset className="agent-skills">
          <legend className="field-label">Skills</legend>
          {skillNames.length ? (
            <div className="agent-skills__list">
              {skillNames.map((name) => (
                <Toggle
                  key={name}
                  label={name}
                  checked={fields.skills.includes(name)}
                  onChange={(on) => set({ skills: on ? [...fields.skills, name] : fields.skills.filter((item) => item !== name) })}
                />
              ))}
            </div>
          ) : (
            <p className="m-0 text-sm text-text-muted">The agent reports no local skills.</p>
          )}
        </fieldset>
        <ModelField value={fields.model} onChange={(model) => set({ model })} />
      </div>
      {running > 0 ? (
        <p className="info-banner m-0 mt-4 text-sm" role="status">
          {busyNotice(running)}
        </p>
      ) : null}
      <div className="agent-draft__actions mt-4">
        <Button size="sm" loading={busy === 'save'} disabled={!!busy || !dirty} onClick={() => void save()}>
          Save draft
        </Button>
        <Button size="sm" variant="primary" loading={busy === 'apply'} disabled={!!busy || parts.length === 0} onClick={() => setConfirm('apply')}>
          Apply
        </Button>
        <Button size="sm" variant="ghost" loading={busy === 'discard'} disabled={!!busy || (!saved && !dirty)} onClick={() => setConfirm('discard')}>
          Discard
        </Button>
      </div>
      {feedback ? <p role="status" className="m-0 mt-3 text-sm text-success">{feedback}</p> : null}
      {error ? <p role="alert" className="m-0 mt-3 text-sm text-danger">{error}</p> : null}
      {applied ? (
        <div className="mt-3">
          <ApplyResults response={applied} fleetHref={'/fleet' + profileHref(context.nodeId, context.profileId)} onRebase={saved ? () => void rebase() : undefined} rebasing={busy === 'rebase'} />
        </div>
      ) : null}
      <ConfirmDialog
        open={confirm === 'apply'}
        title={`Apply ${parts.map((part) => PART_LABEL[part]).join(', ')}?`}
        message={`The agent's ${parts.map((part) => PART_LABEL[part]).join(', ')} change in every project, through Magnus. Identity history keeps the previous version.${parts.some((part) => part === 'skills' || part === 'model') ? ' Skills and the model take effect after the profile restarts.' : ''}${running > 0 ? ' ' + busyNotice(running) : ''}`}
        confirmLabel="Apply"
        tone="primary"
        onCancel={() => setConfirm(null)}
        onConfirm={() => void apply()}
      />
      <ConfirmDialog
        open={confirm === 'discard'}
        title="Discard this draft?"
        message="Your unapplied changes are removed. The agent stays as it is."
        confirmLabel="Discard"
        tone="warning"
        onCancel={() => setConfirm(null)}
        onConfirm={() => void discard()}
      />
    </Panel>
  );
}

interface Exchange {
  id: number;
  prompt: string;
  useDraft: boolean;
  run: PreviewRun;
}
const STATUS_TEXT: Record<PreviewRun['status'], string> = {
  connecting: 'Starting the preview…',
  running: 'Replying…',
  reconnecting: 'Connection dropped. Reconnecting…',
  done: 'Finished',
  failed: 'Did not finish',
};

function ExchangeView({ exchange }: { exchange: Exchange }) {
  const { run } = exchange;
  const text = previewText(run) || (run.status === 'done' ? run.result ?? '' : '');
  const live = !previewFinished(run);
  return (
    <li className="agent-chat__exchange">
      <div className="agent-chat__prompt rounded-control bg-accent-soft p-3 text-sm">
        <span className="stat-label">You{exchange.useDraft ? ' · with draft' : ' · saved agent'}</span>
        <p className="m-0 mt-1 whitespace-pre-wrap">{exchange.prompt}</p>
      </div>
      <div className="agent-chat__reply rounded-control border border-border bg-surface-sunken p-3 text-sm" aria-busy={live || undefined}>
        <span className="agent-chat__status stat-label">
          {STATUS_TEXT[run.status]}
          {run.events ? ` · ${run.events} journal events` : ''}
          {live && run.lastKind ? ` · ${run.lastKind.replaceAll('_', ' ')}` : ''}
        </span>
        {text ? <p className="m-0 mt-1 whitespace-pre-wrap">{text}</p> : live ? <p className="m-0 mt-1 text-text-muted">Waiting for the first words…</p> : null}
        {run.status === 'failed' && run.error ? <p className="m-0 mt-2 text-danger">{run.error}</p> : null}
        {run.status === 'done' && run.state === 'partial' ? <p className="m-0 mt-2 text-warning">The agent finished part of the request.</p> : null}
      </div>
    </li>
  );
}

/** A preview conversation with the agent. Each reply streams as the agent writes it. */
function PreviewChat({ context, draftSaved }: { context: AgentContext; draftSaved: boolean }) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [prompt, setPrompt] = useState('');
  const [useDraft, setUseDraft] = useState(true);
  const [fresh, setFresh] = useState(true);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const counter = useRef(0);
  const running = exchanges.some((exchange) => !previewFinished(exchange.run));
  const latest = exchanges.at(-1);
  useEffect(() => () => controller.current?.abort(), []);

  async function send() {
    const text = prompt.trim();
    if (!text || running) return;
    const id = (counter.current += 1);
    const withDraft = useDraft && draftSaved;
    setExchanges((list) => [...list, { id, prompt: text, useDraft: withDraft, run: startPreview() }]);
    setPrompt('');
    const current = new AbortController();
    controller.current = current;
    const update = (run: PreviewRun) => setExchanges((list) => list.map((item) => (item.id === id ? { ...item, run } : item)));
    const result = await runPreview({ agentRef: context.agentRef, prompt: text, useDraft: withDraft, newSession: fresh, signal: current.signal, onRun: update });
    if (result.code === 'PREVIEW_UNAVAILABLE') setUnavailable(result.error);
    else if (result.taskId) setFresh(false);
  }

  function restart() {
    controller.current?.abort();
    setExchanges([]);
    setFresh(true);
  }

  return (
    <Panel
      title="Preview"
      description="Talk to the agent as the draft would make it. Previews write no memory, keep no files and change nothing on the agent."
      actions={
        <Button size="sm" variant="ghost" icon={<MessageSquarePlus className="size-4" />} disabled={exchanges.length === 0} onClick={restart}>
          New conversation
        </Button>
      }
      className="agent-chat min-w-0"
    >
      {unavailable ? (
        <div className="warning-banner mb-3 grid gap-2 text-sm" role="alert">
          <p className="m-0 font-semibold">Preview isn&apos;t available for this agent yet</p>
          <p className="m-0">{unavailable}</p>
          <StudioLink href={'/fleet' + profileHref(context.nodeId, context.profileId)} className="justify-self-start text-sm">
            Fleet details
            <ArrowUpRight className="ml-1 inline size-3" aria-hidden="true" />
          </StudioLink>
        </div>
      ) : null}
      {exchanges.length ? (
        <ol className="agent-chat__log" aria-label="Preview conversation">
          {exchanges.map((exchange) => (
            <ExchangeView key={exchange.id} exchange={exchange} />
          ))}
        </ol>
      ) : (
        <p className="m-0 text-sm text-text-muted">Ask something the change should affect, then compare with the saved agent by turning the draft off.</p>
      )}
      <p className="sr-only" aria-live="polite">
        {latest ? STATUS_TEXT[latest.run.status] : ''}
      </p>
      <form
        className="agent-chat__composer mt-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <TextArea
          aria-label="Message to preview"
          value={prompt}
          onChange={setPrompt}
          maxLength={16_000}
          placeholder="Message the agent"
          className="agent-chat__input"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="agent-chat__controls">
          <Toggle checked={useDraft && draftSaved} disabled={!draftSaved} onChange={setUseDraft} label={draftSaved ? 'Use my draft' : 'Use my draft (save it first)'} />
          {running ? (
            <Button size="sm" type="button" icon={<Square className="size-4" />} onClick={() => controller.current?.abort()}>
              Stop
            </Button>
          ) : (
            <Button size="sm" variant="primary" type="submit" icon={<Send className="size-4" />} disabled={!prompt.trim()}>
              Send
            </Button>
          )}
        </div>
      </form>
    </Panel>
  );
}

export function PreviewTab({ context }: { context: AgentContext }) {
  const { nodeId, profileId, agentRef } = context;
  const data = useMagnusResource((signal) => readAgent(context, signal), [agentRef]);
  const tasks = useMagnusResource((signal) => readResource(nodeId, profileId, 'tasks', taskListSchema, signal), [agentRef], { pollMs: 15_000 });
  const running = tasks.data?.tasks.filter((task) => !taskIsFinal(task.state)).length ?? 0;
  const [draftSaved, setDraftSaved] = useState(false);
  return (
    <div className="agent-preview">
      <Loaded resource={data} title="The agent could not be read for Preview" rows={8}>
        {(initial) => <DraftEditor context={context} initial={initial} running={running} onDraft={setDraftSaved} />}
      </Loaded>
      <PreviewChat context={context} draftSaved={draftSaved} />
    </div>
  );
}
