import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Field, Select, TextArea, TextInput, Toggle, statusTone } from '@ui';
import { randomId } from '../../../../api/client';
import { errorMessage } from '../../../../api/errors';
import { FxPanel } from '../../../../effects';
import { ardentAction, readResource } from '../api';
import { parseIdList } from '../logic';
import {
  anyActionSchema,
  configValidationSchema,
  identityHistorySchema,
  memoryResultsSchema,
  peerValidationSchema,
  revisionedTextSchema,
  revisionSchema,
  taskAcceptedSchema,
  type ArdentSkill,
  type MemoryStatus,
  type RevisionedText,
} from '../schemas';
import { readYamlValue, setYamlValue, YamlSettingsError } from '../yaml-settings';

export interface ProfileRef {
  nodeId: string;
  profileId: string;
}

export function Outcome({ feedback, error }: { feedback?: string | undefined; error?: string | undefined }) {
  return (
    <>
      {feedback ? <p role="status" className="m-0 mt-3 text-sm text-success">{feedback}</p> : null}
      {error ? <p role="alert" className="m-0 mt-3 text-sm text-danger">{error}</p> : null}
    </>
  );
}

const Revision = ({ value, label = 'Revision' }: { value: string; label?: string }) => <span className="font-mono text-xs text-text-muted">{label} {value.slice(0, 12)}</span>;

/** Runs one action on the node and reports its result beneath itself. */
export function ActionButton({ nodeId, profileId, action, target, body, label, disabled, onSuccess }: ProfileRef & { action: string; target?: string; body?: unknown; label: string; disabled?: boolean; onSuccess?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  async function run() {
    setBusy(true);
    setFeedback('');
    setError('');
    try {
      const data = await ardentAction(nodeId, profileId, action, anyActionSchema, { body, target });
      onSuccess?.();
      const detail = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      setFeedback(action === 'provider-test' ? `Probe completed: ${String(detail.auth_mode ?? detail.backend ?? 'ready')}` : 'Operation completed.');
    } catch (caught) {
      setError(errorMessage(caught, 'The Ardent operation failed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3">
      <Button size="sm" loading={busy} disabled={disabled} onClick={() => void run()}>{busy ? 'Checking…' : label}</Button>
      <Outcome feedback={feedback} error={error} />
    </div>
  );
}

export function ConfigEditor({ nodeId, profileId, entry }: ProfileRef & { entry: RevisionedText }) {
  const [draft, setDraft] = useState(entry.text);
  const [saved, setSaved] = useState(entry);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  async function act(action: 'config-validate' | 'config-save') {
    setBusy(true);
    setFeedback('');
    setError('');
    try {
      if (action === 'config-validate') {
        const result = await ardentAction(nodeId, profileId, action, configValidationSchema, { body: { text: draft } });
        const problems = result.runtime_problems ?? [];
        setFeedback(problems.length ? `YAML valid. Runtime needs: ${problems.join('; ')}` : 'YAML valid. No runtime prerequisites reported.');
      } else {
        const result = await ardentAction(nodeId, profileId, action, revisionSchema, { body: { text: draft, revision: saved.revision } });
        setSaved({ text: draft, revision: result.revision });
        setFeedback('Saved on the node. Restart this profile to activate the new configuration.');
      }
    } catch (caught) {
      setError(errorMessage(caught, 'The configuration action failed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <FxPanel title="Profile YAML" description="Edit references and settings. The runtime validates the complete versioned document." actions={<Revision value={saved.revision} />} interactive={false}>
      <TextArea aria-label="Profile YAML" spellCheck={false} value={draft} onChange={setDraft} className="h-[56vh] min-h-80 w-full resize-y font-mono text-xs" />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void act('config-validate')}>Validate</Button>
        <Button size="sm" variant="primary" loading={busy} disabled={draft === saved.text} onClick={() => void act('config-save')}>Save revision</Button>
        <Button size="sm" variant="ghost" disabled={busy || draft === saved.text} onClick={() => setDraft(saved.text)}>Discard</Button>
      </div>
      <Outcome feedback={feedback} error={error} />
    </FxPanel>
  );
}

function IdentityFile({ nodeId, profileId, kind, entry }: ProfileRef & { kind: 'soul' | 'identity'; entry: RevisionedText }) {
  const label = kind === 'soul' ? 'SOUL.md' : 'IDENTITY.md';
  const [draft, setDraft] = useState(entry.text);
  const [saved, setSaved] = useState(entry);
  const [history, setHistory] = useState<ReadonlyArray<{ name: string; revision: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(entry.text);
    setSaved(entry);
    setFeedback('');
    setError('');
  }, [entry]);
  async function save() {
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      setSaved(await ardentAction(nodeId, profileId, 'identity-save', revisionedTextSchema, { body: { text: draft, revision: saved.revision }, target: kind }));
      setFeedback('Saved. The new persona applies to subsequent turns.');
    } catch (caught) {
      setError(errorMessage(caught, 'The identity could not be saved'));
    } finally {
      setBusy(false);
    }
  }
  async function loadHistory() {
    setError('');
    try {
      setHistory((await readResource(nodeId, profileId, `identity/${kind}/history`, identityHistorySchema)).history);
    } catch (caught) {
      setError(errorMessage(caught, 'Identity history is unavailable'));
    }
  }
  async function restore(name: string) {
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const restored = await ardentAction(nodeId, profileId, 'identity-restore', revisionedTextSchema, { body: { history_name: name, revision: saved.revision }, target: kind });
      setSaved(restored);
      setDraft(restored.text);
      setFeedback('Previous version restored.');
    } catch (caught) {
      setError(errorMessage(caught, 'The version could not be restored'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <FxPanel title={label} actions={<Revision value={saved.revision} />} interactive={false} className="min-w-0">
      <TextArea aria-label={label} value={draft} onChange={setDraft} className="h-[45vh] min-h-64 w-full resize-y font-mono text-xs" />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" loading={busy} disabled={draft === saved.text} onClick={() => void save()}>Save</Button>
        <Button size="sm" disabled={busy} onClick={() => void loadHistory()}>Previous versions</Button>
      </div>
      {history.length > 0 ? (
        <div className="mt-3 grid gap-1 border-t border-border pt-3">
          {history.map((item) => (
            <div key={item.name} className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="break-all font-mono text-text-muted">{item.name}</span>
              <Button size="sm" disabled={busy} onClick={() => void restore(item.name)}>Restore</Button>
            </div>
          ))}
        </div>
      ) : null}
      <Outcome feedback={feedback} error={error} />
    </FxPanel>
  );
}
export function IdentityEditor({ nodeId, profileId, soul, identity }: ProfileRef & { soul: RevisionedText; identity: RevisionedText }) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <IdentityFile nodeId={nodeId} profileId={profileId} kind="soul" entry={soul} />
      <IdentityFile nodeId={nodeId} profileId={profileId} kind="identity" entry={identity} />
    </div>
  );
}

const asText = (value: unknown) => (typeof value === 'string' ? value : '');
const asList = (value: unknown) => (Array.isArray(value) ? value.join(', ') : '');

/** The node's YAML through a form. A document the form cannot edit sends the operator to the raw editor. */
export function SettingsForm({ nodeId, profileId, entry, section, running }: ProfileRef & { entry: RevisionedText; section: 'providers' | 'channels'; running: boolean }) {
  const initial = useMemo(() => {
    try {
      const get = (...path: string[]) => readYamlValue(entry.text, path);
      return {
        backend: asText(get('execution', 'backend')) || 'llamacpp',
        llamaUrl: asText(get('providers', 'llamacpp', 'base_url')),
        llamaModel: asText(get('providers', 'llamacpp', 'model')),
        codexModel: asText(get('providers', 'codex', 'model')),
        telegramEnabled: get('channels', 'telegram', 'enabled') === true,
        telegramTokenEnv: asText(get('channels', 'telegram', 'token_env')),
        telegramUsers: asList(get('channels', 'telegram', 'allowed_user_ids')),
        telegramChats: asList(get('channels', 'telegram', 'allowed_chat_ids')),
      };
    } catch (caught) {
      return caught instanceof YamlSettingsError ? caught : new YamlSettingsError('This configuration could not be read.');
    }
  }, [entry.text]);
  if (initial instanceof YamlSettingsError) {
    return (
      <FxPanel tone="warning" fxTone="warning" title={section === 'providers' ? 'Provider settings' : 'Channel settings'} className="mt-3">
        <p className="m-0 text-sm text-warning">{initial.message} Edit it on the Configuration tab.</p>
      </FxPanel>
    );
  }
  return <SettingsFields nodeId={nodeId} profileId={profileId} entry={entry} section={section} running={running} initial={initial} />;
}

function SettingsFields({ nodeId, profileId, entry, section, running, initial }: ProfileRef & { entry: RevisionedText; section: 'providers' | 'channels'; running: boolean; initial: { backend: string; llamaUrl: string; llamaModel: string; codexModel: string; telegramEnabled: boolean; telegramTokenEnv: string; telegramUsers: string; telegramChats: string } }) {
  const [saved, setSaved] = useState(entry);
  const [backend, setBackend] = useState(initial.backend);
  const [llamaUrl, setLlamaUrl] = useState(initial.llamaUrl);
  const [llamaModel, setLlamaModel] = useState(initial.llamaModel);
  const [codexModel, setCodexModel] = useState(initial.codexModel);
  const [telegramEnabled, setTelegramEnabled] = useState(initial.telegramEnabled);
  const [telegramTokenEnv, setTelegramTokenEnv] = useState(initial.telegramTokenEnv);
  const [telegramUsers, setTelegramUsers] = useState(initial.telegramUsers);
  const [telegramChats, setTelegramChats] = useState(initial.telegramChats);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  async function save() {
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      let next = saved.text;
      const set = (path: string[], value: string | boolean | readonly number[]) => {
        next = setYamlValue(next, path, value);
      };
      if (section === 'providers') {
        set(['execution', 'backend'], backend);
        set(['providers', 'llamacpp', 'base_url'], llamaUrl.trim());
        set(['providers', 'llamacpp', 'model'], llamaModel.trim());
        set(['providers', 'codex', 'model'], codexModel.trim());
      } else {
        set(['channels', 'telegram', 'enabled'], telegramEnabled);
        set(['channels', 'telegram', 'token_env'], telegramTokenEnv.trim());
        set(['channels', 'telegram', 'allowed_user_ids'], parseIdList(telegramUsers));
        set(['channels', 'telegram', 'allowed_chat_ids'], parseIdList(telegramChats, true));
      }
      const validation = await ardentAction(nodeId, profileId, 'config-validate', configValidationSchema, { body: { text: next } });
      if (!validation.valid) throw new Error('The node rejected the configuration');
      const result = await ardentAction(nodeId, profileId, 'config-save', revisionSchema, { body: { text: next, revision: saved.revision } });
      setSaved({ text: next, revision: result.revision });
      setFeedback(running ? 'Saved. Restart this profile to activate the new settings.' : 'Saved. Settings activate when this profile starts.');
    } catch (caught) {
      setError(errorMessage(caught, 'The settings could not be saved'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <FxPanel title={section === 'providers' ? 'Provider settings' : 'Channel settings'} className="mt-3" interactive={false}>
      {section === 'providers' ? (
        <div className="field-grid">
          <Field label="Selected backend"><Select value={backend} onChange={setBackend} options={[{ value: 'llamacpp', label: 'llama.cpp' }, { value: 'codex', label: 'Codex App Server' }]} /></Field>
          <Field label="llama.cpp endpoint" hint="HTTP(S) endpoint or ${ENV_REFERENCE}; no embedded credentials."><TextInput value={llamaUrl} onChange={setLlamaUrl} autoComplete="off" /></Field>
          <Field label="llama.cpp model"><TextInput value={llamaModel} onChange={setLlamaModel} autoComplete="off" /></Field>
          <Field label="Codex model" hint="Uses the existing node-local ChatGPT login."><TextInput value={codexModel} onChange={setCodexModel} autoComplete="off" /></Field>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="grid gap-3">
            <Toggle checked={telegramEnabled} onChange={setTelegramEnabled} label="Enable Telegram polling" />
            <Field label="Telegram token environment variable"><TextInput value={telegramTokenEnv} onChange={setTelegramTokenEnv} autoComplete="off" /></Field>
            <Field label="Allowed Telegram user IDs" hint="Comma-separated numeric IDs."><TextInput value={telegramUsers} onChange={setTelegramUsers} autoComplete="off" /></Field>
            <Field label="Allowed chat IDs" hint="Comma-separated signed numeric IDs."><TextInput value={telegramChats} onChange={setTelegramChats} autoComplete="off" /></Field>
          </div>
          <p className="m-0 text-sm text-text-muted">Other channel adapters are configured on the Configuration tab.</p>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Validate and save'}</Button>
        <span className="text-xs text-text-muted">Credential values stay in the profile environment file.</span>
      </div>
      <Outcome feedback={feedback} error={error} />
    </FxPanel>
  );
}

export function PeerEditor({ nodeId, profileId, entry, running }: ProfileRef & { entry: RevisionedText; running: boolean }) {
  const [text, setText] = useState(entry.text);
  const [savedText, setSavedText] = useState(entry.text);
  const [revision, setRevision] = useState(entry.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  async function save() {
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const validation = await ardentAction(nodeId, profileId, 'peer-validate', peerValidationSchema, { body: { text } });
      if (!validation.valid) throw new Error('The peer configuration failed validation');
      const result = await ardentAction(nodeId, profileId, 'peer-save', revisionSchema, { body: { text, revision } });
      setRevision(result.revision);
      setSavedText(text);
      setFeedback(`${validation.peers} peer routes saved. ${running ? 'Restart this profile to activate them.' : 'They activate when this profile starts.'}`);
    } catch (caught) {
      setError(errorMessage(caught, 'The peers could not be saved'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <FxPanel title="Authorized peer configuration" description="Peer URLs and token environment variable names are explicit. Discovery does not authorize an unlisted peer." actions={<Revision value={revision} />} className="mt-3" interactive={false}>
      <TextArea aria-label="Peer YAML" spellCheck={false} value={text} onChange={setText} className="min-h-56 w-full resize-y font-mono text-xs" />
      <div className="mt-3"><Button size="sm" variant="primary" loading={busy} disabled={text === savedText} onClick={() => void save()}>{busy ? 'Saving…' : 'Validate and save'}</Button></div>
      <Outcome feedback={feedback} error={error} />
    </FxPanel>
  );
}

export function SkillList({ nodeId, profileId, initial, initialRevision }: ProfileRef & { initial: readonly ArdentSkill[]; initialRevision: string }) {
  const [skills, setSkills] = useState(initial);
  const [revision, setRevision] = useState(initialRevision);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  async function toggle(skill: ArdentSkill) {
    setBusy(skill.name);
    setError('');
    setFeedback('');
    try {
      const result = await ardentAction(nodeId, profileId, 'skill-set', revisionSchema, { body: { enabled: !skill.enabled, revision }, target: skill.name });
      setRevision(result.revision);
      setSkills((previous) => previous.map((item) => (item.name === skill.name ? { ...item, enabled: !skill.enabled } : item)));
      setFeedback(`${skill.name} ${skill.enabled ? 'disabled' : 'enabled'}. Restart the profile to activate.`);
    } catch (caught) {
      setError(errorMessage(caught, 'The skill could not be changed'));
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap justify-between gap-2 text-xs text-text-muted">
        <span>Working methods available to this profile</span>
        <Revision value={revision} label="Configuration revision" />
      </div>
      {skills.length === 0 ? <FxPanel padding="sm"><p className="m-0 text-sm text-text-muted">No skills were reported.</p></FxPanel> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {skills.map((skill) => (
            <FxPanel key={skill.name} padding="sm" className="min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="m-0 text-base font-semibold">{skill.name}</p>
                <Badge tone={skill.enabled ? 'success' : 'neutral'} dot>{skill.enabled ? 'Enabled' : 'Disabled'}</Badge>
              </div>
              <p className="m-0 mt-2 text-sm text-text-muted">{skill.description}</p>
              <p className="m-0 mt-3 font-mono text-xs text-text-muted">{skill.hash.slice(0, 16)}</p>
              <Button className="mt-3" size="sm" disabled={!!busy} loading={busy === skill.name} onClick={() => void toggle(skill)}>{skill.enabled ? 'Disable' : 'Enable'}</Button>
            </FxPanel>
          ))}
        </div>
      )}
      <Outcome feedback={feedback} error={error} />
    </div>
  );
}

export function MemoryPanel({ nodeId, profileId, status }: ProfileRef & { status: MemoryStatus }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ReadonlyArray<{ id: string; content: string; created_at?: string | undefined }>>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function search() {
    if (!query.trim()) {
      setError('Enter a memory search query.');
      return;
    }
    setBusy(true);
    setError('');
    setSearched(false);
    try {
      setResults((await ardentAction(nodeId, profileId, 'memory-search', memoryResultsSchema, { body: { query: query.trim() } })).results);
      setSearched(true);
    } catch (caught) {
      setError(errorMessage(caught, 'HiveMem did not return a search result'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <FxPanel title="HiveMem" actions={<Badge tone={status.status === 'ready' ? 'success' : statusTone(status.status)} dot>{status.status}</Badge>} className="mt-3" interactive={false}>
      <p className="m-0 text-sm text-text-muted">Agent {status.agent_id || '—'} · workspace {status.workspace_id || '—'}</p>
      {status.status === 'ready' ? <p className="m-0 mt-1 text-xs text-text-muted">Retrieval {status.retrieval ?? 'unknown'} · storage {status.storage ?? 'unknown'}</p> : <p role="alert" className="m-0 mt-2 text-sm text-warning">{status.reason ?? 'HiveMem unavailable'}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <TextInput aria-label="Search private memory" value={query} maxLength={1000} onChange={setQuery} onKeyDown={(event) => { if (event.key === 'Enter') void search(); }} className="min-w-48 flex-1" placeholder="Search this profile's private memory" />
        <Button size="sm" loading={busy} disabled={status.status !== 'ready'} onClick={() => void search()}>{busy ? 'Searching…' : 'Search memory'}</Button>
      </div>
      <Outcome error={error} />
      {searched ? (
        <div className="mt-3 grid gap-2">
          {results.length ? results.map((item) => (
            <div key={item.id} className="rounded-control border border-border bg-surface-sunken p-3">
              <p className="m-0 whitespace-pre-wrap text-sm">{item.content}</p>
              <p className="m-0 mt-2 font-mono text-xs text-text-muted">{item.id}{item.created_at ? ` · ${new Date(item.created_at).toLocaleString()}` : ''}</p>
            </div>
          )) : <p className="m-0 text-sm text-text-muted">No permitted memories matched.</p>}
        </div>
      ) : null}
    </FxPanel>
  );
}

export function TaskTest({ nodeId, profileId, onSubmitted }: ProfileRef & { onSubmitted?: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState('');
  const [error, setError] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    setAccepted('');
    try {
      const result = await ardentAction(nodeId, profileId, 'task-submit', taskAcceptedSchema, { body: { prompt: prompt.trim(), idempotency_key: randomId() } });
      setAccepted(`Task ${result.task_id.slice(0, 8)} accepted. Refresh the profile to inspect its result.`);
      setPrompt('');
      onSubmitted?.();
    } catch (caught) {
      setError(errorMessage(caught, 'The task could not be submitted'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mb-4 border-b border-border pb-4">
      <p className="m-0 text-sm font-semibold">Test research request</p>
      <p className="m-0 mt-1 text-xs text-text-muted">Submit a bounded diagnostic task. The result appears in this profile&apos;s task journal.</p>
      <TextArea aria-label="Test research prompt" maxLength={4000} value={prompt} onChange={setPrompt} className="mt-3 h-24 w-full resize-y" />
      <Button className="mt-2" size="sm" loading={busy} disabled={!prompt.trim()} onClick={() => void submit()}>Submit test</Button>
      <Outcome feedback={accepted} error={error} />
    </div>
  );
}
